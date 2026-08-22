import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

/**
 * The chat transcript's scroller, and the one place its scroll position is
 * decided. The desktop gets this for free from CSS — its feed is
 * `flex flex-col-reverse overflow-y-auto`, so the scroll origin IS the bottom:
 * a conversation opens at its newest message on the first painted frame, stays
 * pinned while async children (file viewers, images, highlighting) settle, and
 * never yanks a user who has scrolled up. React Native has no column-reverse
 * scroller, so the same three guarantees are rebuilt here:
 *
 *  1. OPENS AT THE END, NEVER AT THE TOP. A ScrollView paints at offset 0 and
 *     can only be moved once its content has been measured, so the first frames
 *     of a long conversation show its FIRST message before snapping to the last
 *     — the flash this component exists to remove. The feed is therefore laid
 *     out invisibly and revealed (`onReady`) only once it has been pinned and
 *     its height has stopped changing. The caller holds the skeleton up for
 *     exactly that window, so what the eye sees is: skeleton, then the
 *     conversation, already at its end.
 *
 *  2. PINS EXACTLY WHILE THE USER MEANS TO BE AT THE END. Being pinned is an
 *     intent, and only the user's own scrolling — a drag, and the coast it
 *     releases into — may change it. It is NOT re-derived from every scroll
 *     event: the follow animation passes through the same "near the end?"
 *     test on its way down, and reading its early frames as "the user scrolled
 *     away" is what used to park the feed mid-transcript, unpinned, while new
 *     messages piled up below the fold. Scroll up to read history and nothing
 *     moves you; return to the end and the feed is yours again.
 *
 *  3. FOLLOWS GROWTH ALL THE WAY, IN TWO GAITS. Streamed lines arrive small
 *     and often, and are glued instantly — the same motion column-reverse
 *     gives the desktop, growth and scroll in the same frame. A whole message
 *     mounting is a jump worth easing, so it glides. But a glide's target is
 *     computed WHEN IT STARTS (iOS `setContentOffset:animated:`, Android's
 *     fixed-duration OverScroller), so anything that grows during its ~300ms
 *     lands it short — and nothing native ever says so: Android reports no
 *     completion for programmatic scrolls at all, and on iOS a
 *     maintainVisibleContentPosition adjustment can cancel the animation
 *     without a callback. So every glide is settled by hand: on iOS's
 *     completion event, and always by a watchdog timer, whichever speaks
 *     first — and if the feed is still short of the end, it is re-aimed until
 *     it truly lands. Before the reveal all of this is moot: pins are
 *     instantaneous, because an animation nobody can see is only a delay.
 *
 * The end must also survive the VIEWPORT changing under a fixed transcript:
 * the keyboard rising and the composer growing both shrink this scroller
 * without a single content event, which is how the newest message used to sit
 * hidden behind the composer while the feed believed itself pinned. A layout
 * change while pinned re-pins instantly.
 *
 * `maintainVisibleContentPosition` covers what sized placeholders cannot:
 * anything that still changes height ABOVE the viewport (a video's real aspect
 * ratio, a text card shorter than its reserved clamp) is absorbed natively
 * rather than shoving the reader's content down. Armed only after the reveal,
 * so it can never fight the initial pin.
 */

/** Within this many points of the end still counts as "reading the newest". */
const STICK_THRESHOLD = 64
/** No content-size change for this long ⇒ the layout has settled. */
const SETTLE_MS = 90
/** Reveal regardless after this long — a streaming feed never goes quiet. */
const SETTLE_CAP_MS = 500
/** Cross-fade duration for the reveal; the skeleton fades out over the same. */
export const FEED_FADE_MS = 180
/** Growth in one layout pass above this is a mounted message, not streamed
 *  lines: the first glides, the second is glued instantly. */
const GLIDE_MIN_DELTA = 80
/** Both platforms animate scrollToEnd over a fixed ~250–300ms. This long after
 *  a glide began it is over — finished, cancelled, or never reported. */
const GLIDE_SETTLE_MS = 500
/** Within this many points of the end, a glide has landed: the final offset is
 *  subpixel-snapped, so exactness cannot be asked of it. */
const LANDED_EPSILON = 1

export type ChatFeedHandle = {
  /** Re-pin and scroll to the newest message — for sends, which always follow. */
  scrollToEnd: () => void
}

export type ChatFeedProps = {
  children: React.ReactNode
  /**
   * True while the caller is covering this feed with the skeleton. The feed
   * stays invisible and unscrollable until it reports back through `onReady`.
   * False for a feed the user is already in (a fresh chat, a sent message):
   * there is nothing to hide, and hiding it would itself be a flash.
   */
  gated: boolean
  /**
   * Whether there are rows to lay out yet. The gate may only open on a feed
   * pinned to REAL content, and an empty one lays out all the same — so this
   * is what separates "settled" from "still nothing here", not the measured
   * height (see handleContentSizeChange).
   */
  hasContent: boolean
  onReady: () => void
  /**
   * Extra space above the first message. The screen has no top bar — its two
   * controls float over this scroller — so the transcript starts below them and
   * passes UNDER them on the way up, which is only possible if the clearance is
   * padding inside the content rather than a bar outside it.
   */
  topInset?: number
}

export const ChatFeed = forwardRef<ChatFeedHandle, ChatFeedProps>(function ChatFeed(
  { children, gated, hasContent, onReady, topInset = 0 },
  ref
) {
  const scrollRef = useRef<ScrollView>(null)
  const readyRef = useRef(!gated)
  const [revealed, setRevealed] = useState(!gated)
  const opacity = useSharedValue(gated ? 0 : 1)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Guarantees 2 and 3, as one closure. Everything in here is plain mutable
   * state read and written between native events — none of it renders — and
   * the two halves are inseparable: whether growth is followed is decided by
   * what the user last did, and what the user last did can only be told apart
   * from the follow's own motion by who is holding which flag.
   */
  const scroller = useMemo(() => {
    /** The user means to be at the end. Follow growth while true. */
    let stuck = true
    /** The finger is on the feed right now. */
    let dragging = false
    /** Coasting out of a released drag — still the user's own motion. */
    let coasting = false
    /** An animated follow is in flight, its settle not yet run. */
    let gliding = false
    let glideTimer: ReturnType<typeof setTimeout> | null = null
    /**
     * The freshest geometry each event reported. Kept so the settle can ask
     * "did we actually land?" without waiting for another event to tell it —
     * after a glide dies silently, no event is ever coming.
     */
    const metrics = { content: 0, layout: 0, offset: 0 }

    const distanceFromEnd = (): number => metrics.content - metrics.offset - metrics.layout

    const clearGlideTimer = (): void => {
      if (glideTimer) clearTimeout(glideTimer)
      glideTimer = null
    }

    /** Land now. Instant, exact, and terminal — no settle to wait for. */
    const pinNow = (): void => {
      gliding = false
      clearGlideTimer()
      scrollRef.current?.scrollToEnd({ animated: false })
    }

    function glide(): void {
      // Nothing to travel. An animation over zero distance never starts, so
      // nothing would ever report it finished — land exactly instead.
      if (distanceFromEnd() <= LANDED_EPSILON) {
        pinNow()
        return
      }
      gliding = true
      coasting = false
      scrollRef.current?.scrollToEnd({ animated: true })
      clearGlideTimer()
      glideTimer = setTimeout(settleGlide, GLIDE_SETTLE_MS)
    }

    /**
     * The glide is over — iOS said so, or the watchdog did. It aimed at where
     * the end WAS when it started, and everything that grew during its flight
     * left it short of where the end IS: re-aim until it truly lands. A glide
     * that did land asks for nothing more, which is what makes the chase
     * terminate.
     */
    function settleGlide(): void {
      clearGlideTimer()
      if (!gliding) return
      gliding = false
      if (stuck && distanceFromEnd() > LANDED_EPSILON) glide()
    }

    const measure = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      metrics.offset = contentOffset.y
      metrics.content = contentSize.height
      metrics.layout = layoutMeasurement.height
    }

    /** The user's own position states their intent; nothing else may. */
    const readStick = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      stuck = contentSize.height - contentOffset.y - layoutMeasurement.height <= STICK_THRESHOLD
    }

    return {
      /** The transcript grew or shrank. Follow it, in the gait it calls for. */
      contentChanged(height: number): void {
        const grewBy = height - metrics.content
        metrics.content = height
        // Mid-glide growth is not skipped, it is deferred: the settle re-aims
        // at the real end. Restarting the animation per event is the stutter
        // this component used to have.
        if (!stuck || gliding) return
        if (!readyRef.current) {
          scrollRef.current?.scrollToEnd({ animated: false })
          return
        }
        if (grewBy > GLIDE_MIN_DELTA) glide()
        else pinNow()
      },
      /**
       * The viewport changed size — the keyboard rose, the composer grew, the
       * device rotated. The content did not, so no content event is coming,
       * and without this the newest message ends up behind the composer while
       * the feed still believes itself pinned. Mid-glide it defers like
       * growth does: an instant jump would be stomped by Android's running
       * animator, and the settle lands on the true end anyway.
       */
      layoutChanged(event: LayoutChangeEvent): void {
        metrics.layout = event.nativeEvent.layout.height
        if (!stuck || gliding) return
        scrollRef.current?.scrollToEnd({ animated: false })
      },
      scrolled(event: NativeSyntheticEvent<NativeScrollEvent>): void {
        measure(event)
        // Only the user's own motion may re-decide the pin — the follow
        // animation passes through the same threshold on its way down, and
        // believing it was what parked the feed mid-transcript for good.
        if (dragging || coasting) readStick(event)
      },
      dragBegan(): void {
        dragging = true
        coasting = false
        // The touch owns the feed now; on iOS it has already cancelled any
        // running animation. The settle must not fire behind the finger.
        gliding = false
        clearGlideTimer()
      },
      dragEnded(event: NativeSyntheticEvent<NativeScrollEvent>): void {
        dragging = false
        // Momentum may follow; its motion is still the user's. If none does,
        // the flag dies with the next momentum-end or follow — and until then
        // it only ever re-reads a position the pins put at the end anyway.
        coasting = true
        measure(event)
        readStick(event)
      },
      momentumEnded(event: NativeSyntheticEvent<NativeScrollEvent>): void {
        measure(event)
        if (coasting) {
          // The user's coast ran out; where it stopped is what they meant.
          coasting = false
          readStick(event)
          return
        }
        // iOS reports a finished programmatic scroll here; Android never
        // does — there, the watchdog inside the glide stands in for this.
        settleGlide()
      },
      /** A send: the reply belongs on screen, wherever the reader was. */
      toEnd(): void {
        stuck = true
        if (!readyRef.current) {
          scrollRef.current?.scrollToEnd({ animated: false })
          return
        }
        glide()
      },
      dispose(): void {
        clearGlideTimer()
      }
    }
  }, [])

  const reveal = useCallback(() => {
    if (readyRef.current) return
    readyRef.current = true
    setRevealed(true)
    // One last pin on the frame the feed becomes visible: anything that
    // settled during the reveal must not leave it a few points short.
    scrollRef.current?.scrollToEnd({ animated: false })
    opacity.value = withTiming(1, { duration: FEED_FADE_MS })
    onReady()
  }, [onReady, opacity])

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current)
      if (capTimer.current) clearTimeout(capTimer.current)
      scroller.dispose()
    },
    [scroller]
  )

  useImperativeHandle(ref, () => ({ scrollToEnd: scroller.toEnd }), [scroller])

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      scroller.contentChanged(height)
      if (readyRef.current) return
      // An empty feed — a conversation still being read out of SQLite or
      // downloaded — has nothing to pin to, and settling on it opens the gate
      // on a blank page: the skeleton goes, nothing takes its place, and the
      // transcript then lands and scrolls itself in. Which is what the height
      // test below it used to allow: a ScrollView measures its CONTENT BOX,
      // and an empty one is still the container's own 32pt of padding, never
      // the zero this was watching for. So the question is asked of the rows,
      // and the timers start at the arrival of the first of them — including
      // the cap, whose whole point is to bound a feed that never goes quiet.
      if (!hasContent || height <= 0) return
      if (settleTimer.current) clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(reveal, SETTLE_MS)
      capTimer.current ??= setTimeout(reveal, SETTLE_CAP_MS)
    },
    [hasContent, reveal, scroller]
  )

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View style={[{ flex: 1 }, fade]}>
      <ScrollView
        ref={scrollRef}
        onContentSizeChange={handleContentSizeChange}
        onLayout={scroller.layoutChanged}
        onScroll={scroller.scrolled}
        onScrollBeginDrag={scroller.dragBegan}
        onScrollEndDrag={scroller.dragEnded}
        onMomentumScrollEnd={scroller.momentumEnded}
        // Cheap at this rate, and the geometry the settle reads has to be
        // current by the time it runs.
        scrollEventThrottle={16}
        // Nothing to grab while it is invisible — a drag would only fight the
        // pin and leave the user parked mid-conversation.
        scrollEnabled={revealed}
        maintainVisibleContentPosition={revealed ? { minIndexForVisible: 0 } : null}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16 + topInset,
          paddingBottom: 16,
          gap: 16
        }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {/* Swallows taps aimed at the skeleton on top of the hidden transcript. */}
      {!revealed && <View className="absolute inset-0" />}
    </Animated.View>
  )
})
