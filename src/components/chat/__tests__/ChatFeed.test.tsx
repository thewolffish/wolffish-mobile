/**
 * The feed's reveal gate — what decides when a conversation stops being a
 * skeleton and becomes messages.
 *
 * It opens on one signal: the layout going quiet. The bug these tests hold
 * shut is what "quiet" used to mean — an EMPTY feed lays out too, and it lays
 * out at once, so a conversation still being read out of SQLite or pulled over
 * the tunnel opened its gate on nothing: the skeleton faded out, a blank page
 * took its place, and the transcript then landed and scrolled itself in. The
 * old guard tried to catch that with `height <= 0` and never could — a
 * ScrollView reports its CONTENT BOX, and an empty one still measures the
 * container's own 32pt of padding.
 *
 * Driven through `onContentSizeChange` with the heights RN would really report,
 * because the guard is a claim about those numbers.
 */
import { ChatFeed } from '@/components/chat/ChatFeed'
import { render } from '@testing-library/react-native'
import { act } from 'react'
import { Text } from 'react-native'

// The gate is timers and a ref; the cross-fade around it needs the native
// runtime and has no say in when onReady fires.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native')
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (style: () => object) => style(),
    withTiming: (value: number) => value
  }
})

/** What an empty feed measures: `contentContainerStyle`'s paddingVertical. */
const EMPTY = 32
/** What a screenful of messages measures. Anything past the fold will do. */
const FULL = 1200
/** Past the settle timer and the cap behind it, both. */
const SETTLED_MS = 1000

let view: Awaited<ReturnType<typeof render>>
const onReady = jest.fn()

/** The scroller, as RN's own mock renders it — props and all. */
const scroller = (): Record<string, unknown> => {
  const found = view.root?.queryAll((node) => node.type === 'RCTScrollView', {
    includeSelf: true
  })
  // Guards the query itself: a renamed host type would otherwise leave every
  // assertion below reading `undefined` and passing.
  expect(found).toHaveLength(1)
  return (found ?? [])[0].props
}

/** Lay out `height` points of content, then let every timer run out. */
const layout = async (height: number): Promise<void> => {
  await act(async () => {
    ;(scroller().onContentSizeChange as (w: number, h: number) => void)(390, height)
    jest.advanceTimersByTime(SETTLED_MS)
  })
}

// RTL 14 renders through act() and publishes the result asynchronously.
const mount = async (hasContent: boolean): Promise<void> => {
  view = await render(
    <ChatFeed gated hasContent={hasContent} onReady={onReady}>
      {hasContent ? <Text>a message</Text> : []}
    </ChatFeed>
  )
}

beforeEach(() => {
  jest.useFakeTimers()
  onReady.mockClear()
})
afterEach(() => jest.useRealTimers())

describe('the chat feed reveal gate', () => {
  it('stays shut on an empty feed, however long it sits there', async () => {
    await mount(false)
    await layout(EMPTY)

    expect(onReady).not.toHaveBeenCalled()
    // Still covered: a revealed feed is a scrollable one.
    expect(scroller().scrollEnabled).toBe(false)
  })

  it('opens once the transcript arrives and its layout goes quiet', async () => {
    await mount(false)
    await layout(EMPTY)

    // The messages land.
    await view.rerender(
      <ChatFeed gated hasContent onReady={onReady}>
        <Text>a message</Text>
      </ChatFeed>
    )
    await layout(FULL)

    expect(onReady).toHaveBeenCalledTimes(1)
    expect(scroller().scrollEnabled).toBe(true)
  })

  it('reveals a feed that opens with its rows already in hand', async () => {
    await mount(true)
    await layout(FULL)

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('never gates a feed the user is already in', async () => {
    view = await render(
      <ChatFeed gated={false} hasContent onReady={onReady}>
        <Text>a message</Text>
      </ChatFeed>
    )

    // Visible from the first frame — there is nothing to hide, and hiding it
    // would itself be the flash. onReady is a cue to drop a skeleton that was
    // never raised, so it stays unfired.
    expect(scroller().scrollEnabled).toBe(true)
    expect(onReady).not.toHaveBeenCalled()
  })
})
