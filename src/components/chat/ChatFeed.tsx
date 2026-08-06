import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
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
 *  2. PINS ONLY WHEN THE USER IS AT THE END. Auto-scrolling on every content
 *     size change is what let a resolving file card drag the transcript around.
 *     Growth is followed only while the viewport is within STICK_THRESHOLD of
 *     the bottom; scroll up to read history and nothing moves you.
 *
 *  3. FOLLOWS GROWTH SMOOTHLY. Once revealed, pinning animates — a streamed
 *     reply glides rather than teleports. Before reveal it is instantaneous:
 *     an animation nobody can see is only a delay.
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
  const stickRef = useRef(true)
  const readyRef = useRef(!gated)
  const [revealed, setRevealed] = useState(!gated)
  const opacity = useSharedValue(gated ? 0 : 1)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    },
    []
  )

  useImperativeHandle(
    ref,
    () => ({
      scrollToEnd: () => {
        stickRef.current = true
        scrollRef.current?.scrollToEnd({ animated: readyRef.current })
      }
    }),
    []
  )

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (stickRef.current) scrollRef.current?.scrollToEnd({ animated: readyRef.current })
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
    [hasContent, reveal]
  )

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    stickRef.current =
      contentSize.height - contentOffset.y - layoutMeasurement.height <= STICK_THRESHOLD
  }, [])

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View style={[{ flex: 1 }, fade]}>
      <ScrollView
        ref={scrollRef}
        onContentSizeChange={handleContentSizeChange}
        onScroll={handleScroll}
        // Cheap at this rate, and the stick decision has to be current by the
        // time the next content-size change lands.
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
