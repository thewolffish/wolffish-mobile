jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

/**
 * What the feed SHOWS, frame by frame, as a turn arrives over the tunnel.
 *
 * Every other test here checks a value. This one checks a sequence, because
 * the bug it exists to prevent was never visible in any single value: each
 * state the chat screen passed through was individually defensible, and the
 * order they came in made the reply appear, vanish, and come back. The
 * complaint was "no blanks, no come and go" — so the assertions are exactly
 * that, applied to every intermediate frame rather than the final one:
 *
 *   · once a turn is in flight the feed is never empty
 *   · a row that has appeared never disappears (until its stored copy
 *     replaces it, which is the same row, not a gap)
 *   · the assistant's text only ever grows
 *   · nothing is ever on screen twice
 *
 * Frames are rendered through the real `buildRenderBlocks`, under the real
 * clean/verbose gate, so what is asserted is what the eye gets: a thinking
 * bubble, a text bubble, a tool card — not the shape of a message object.
 *
 * The desktop half is scripted from the real one: the exact events
 * channels/mobile/channel.ts and index.ts emit, in the orders they can emit
 * them in — including the two that caused this (a bare nudge mid-turn, and
 * `turn.status: done` overtaking the disk write it announces).
 */

import type { ConversationMessage, Segment } from '@/lib/conversations/types'

// ---------------------------------------------------------------- fixtures

/** The desktop's disk for one conversation — what a body fetch would return. */
const mockDesktop: { messages: ConversationMessage[] } = { messages: [] }

/** This phone's SQLite copy, and the query cache the screen reads from. */
const mockPhone: { messages: ConversationMessage[] } = { messages: [] }
let mockCached: ConversationMessage[] | undefined

const mockBodyFetches: number[] = []

jest.mock('@/lib/sync/sync', () => ({
  // The real one DELETEs the conversation's rows and re-inserts the desktop's
  // — reconcile.test.ts covers that SQL. What matters here is the consequence:
  // whatever the desktop has NOT saved yet is gone from the phone afterwards.
  fetchConversationBody: jest.fn(async () => {
    mockBodyFetches.push(Date.now())
    mockPhone.messages = mockDesktop.messages.map((m) => ({ ...m }))
    return true
  })
}))

jest.mock('@/lib/conversations/cache', () => ({
  invalidateConversation: jest.fn(() => {
    mockCached = mockPhone.messages.map((m) => ({ ...m }))
  }),
  invalidateConversationList: jest.fn(),
  refetchConversation: jest.fn(async () => {
    mockCached = mockPhone.messages.map((m) => ({ ...m }))
  }),
  conversationHasMessage: (_id: string, messageId: string) =>
    (mockCached ?? []).some((message) => message.id === messageId)
}))

jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }))

const mockDb = {
  runAsync: jest.fn(async () => undefined),
  execAsync: jest.fn(async () => undefined),
  getFirstAsync: jest.fn(async () => ({ next: 0 })),
  getAllAsync: jest.fn(async () => []),
  withExclusiveTransactionAsync: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
    await fn(mockDb)
  })
}
jest.mock('@/lib/db/database', () => ({ getDb: () => Promise.resolve(mockDb) }))

type EventHandler = (payload: unknown) => void
const mockHandlers = new Map<string, EventHandler>()
const mockRpc = jest.fn()

jest.mock('@/lib/tunnel/client', () => ({
  tunnelClient: {
    get active() {
      return {
        rpc: mockRpc,
        onEvent: (topic: string, handler: EventHandler) => mockHandlers.set(topic, handler)
      }
    },
    connected: true
  }
}))

import { buildFeed } from '@/lib/conversations/feed'
import { buildRenderBlocks } from '@/lib/conversations/segments'
import { attachTurnStream, sendPrompt } from '@/lib/sync/prompt'
import { useChatRuntime } from '@/state/chatRuntime'

const CONVERSATION = 'conv-1'

function emit(topic: string, payload: unknown): void {
  mockHandlers.get(topic)?.(payload)
}

/** Let every promise chain the handlers kicked off run to completion. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

// ------------------------------------------------------------------ render

/**
 * One line per row, describing what that row draws — the same decisions
 * AssistantMessageView makes, so a frame here is a frame there.
 */
function describeBlock(block: ReturnType<typeof buildRenderBlocks>[number]): string {
  switch (block.type) {
    case 'text':
      return `text(${block.markdown})`
    case 'tool':
      return `tool(${block.call.name}${block.result ? ':done' : ':running'})`
    case 'file':
      return `file(${block.relPath})`
    case 'task':
      return `task(${block.snapshot.status})`
    default:
      return block.type
  }
}

function render(
  screen: { pendingUser?: ConversationMessage | null; sending?: boolean; conversationId?: string },
  verbose = false
): string[] {
  const live = screen.conversationId
    ? useChatRuntime.getState().streams[screen.conversationId]
    : undefined
  return buildFeed({
    messages: screen.conversationId ? mockCached : undefined,
    live,
    pendingUser: screen.pendingUser,
    sending: screen.sending
  }).map((item) => {
    if (item.message.role === 'user') return `user(${item.message.content})`
    const blocks = buildRenderBlocks(item.message).filter((block) =>
      block.type === 'tool' || block.type === 'model' || block.type === 'compaction'
        ? verbose
        : true
    )
    if (item.streaming && blocks.every((block) => block.type !== 'text')) return 'assistant(…)'
    return `assistant(${blocks.map(describeBlock).join(' + ')})`
  })
}

// -------------------------------------------------------------- invariants

/**
 * The four complaints, as assertions over a whole recording.
 *
 * `assistantText` is compared as a prefix chain rather than for equality: text
 * is allowed to grow and only to grow. A frame whose text is not an extension
 * of the previous frame's means something was rewritten or dropped mid-answer,
 * which is the "it went away" symptom whatever produced it.
 */
function expectSmooth(frames: string[][]): void {
  let previousText = ''
  let sawRows = false
  const faults: string[] = []
  for (const [index, rows] of frames.entries()) {
    const at = `frame ${index} ${JSON.stringify(rows)}`
    if (sawRows && rows.length === 0) faults.push(`${at} went blank`)
    if (rows.length) sawRows = true
    if (new Set(rows).size !== rows.length) faults.push(`${at} has a duplicate row`)

    const assistant = rows.find((row) => row.startsWith('assistant('))
    const text = /text\(([^)]*)\)/.exec(assistant ?? '')?.[1] ?? ''
    if (previousText && text && !text.startsWith(previousText)) {
      faults.push(`${at} rewrote "${previousText}"`)
    }
    if (text) previousText = text
  }
  expect(faults).toEqual([])
}

/** Every row present in an earlier frame is still present later. */
function expectNoRowLost(frames: string[][]): void {
  const users = frames.map((rows) => rows.filter((row) => row.startsWith('user(')))
  const faults: string[] = []
  for (let i = 1; i < users.length; i += 1) {
    for (const row of users[i - 1]) {
      if (!users[i].includes(row)) faults.push(`frame ${i} lost ${row}`)
    }
  }
  expect(faults).toEqual([])
}

/**
 * A conversation already on this phone: the desktop's copy and the query cache
 * holding the same thing, which is the state any conversation opened from
 * History is in.
 */
function seed(messages: ConversationMessage[]): void {
  mockDesktop.messages = messages.map((m) => ({ ...m }))
  mockPhone.messages = messages.map((m) => ({ ...m }))
  mockCached = messages.map((m) => ({ ...m }))
}

// ------------------------------------------------------------------- setup

function textSegment(id: string, delta: string): Segment {
  return { kind: 'text', turnId: 't1', segmentId: id, delta }
}

beforeEach(() => {
  mockDesktop.messages = []
  mockPhone.messages = []
  mockCached = undefined
  mockBodyFetches.length = 0
  mockHandlers.clear()
  mockRpc.mockReset()
  useChatRuntime.setState({ streams: {} })
  attachTurnStream()
})

describe('a turn started from this phone', () => {
  it('shows the prompt and the thinking words from the tap, through to the saved reply', async () => {
    const frames: string[][] = []
    // The chat screen's send sequence, modelled exactly: local state first, in
    // the same tick as the tap, then the round trip.
    const screen: {
      pendingUser: ConversationMessage | null
      sending: boolean
      conversationId?: string
    } = { pendingUser: null, sending: false }

    let resolveSend: (value: { conversationId: string }) => void = () => undefined
    mockRpc.mockImplementation(
      () => new Promise<{ conversationId: string }>((resolve) => (resolveSend = resolve))
    )

    screen.pendingUser = { id: 'm_1_aaaaaa', role: 'user', content: 'hello', timestamp: 1 }
    screen.sending = true
    const sent = sendPrompt({ conversationId: null, text: 'hello' })
    frames.push(render(screen)) // the tap

    // ... the desktop is still minting a conversation. Nothing has come back.
    await flush()
    frames.push(render(screen))

    resolveSend({ conversationId: CONVERSATION })
    await sent
    screen.pendingUser = null
    screen.sending = false
    screen.conversationId = CONVERSATION
    frames.push(render(screen)) // id in hand

    // The desktop persists the prompt and starts the turn.
    mockDesktop.messages.push({ id: 'm_1_aaaaaa', role: 'user', content: 'hello', timestamp: 1 })
    emit('turn.status', { conversationId: CONVERSATION, state: 'started' })
    frames.push(render(screen))

    // Text streams in as deltas.
    for (const delta of ['Hel', 'lo ', 'there']) {
      emit('message.delta', { conversationId: CONVERSATION, text: delta })
      frames.push(render(screen))
    }

    // A throttled full snapshot lands, carrying the same words plus structure.
    emit('message.appended', {
      conversationId: CONVERSATION,
      message: {
        id: 'm_2_bbbbbb',
        role: 'assistant',
        content: 'Hello there',
        timestamp: 2,
        segments: [textSegment('s1', 'Hello there')]
      }
    })
    frames.push(render(screen))

    // A bare nudge lands mid-turn — the video-task write-through sends one,
    // and every desktop before this change sent one per tool segment. Acting
    // on it fetches the transcript from BEFORE this turn.
    emit('message.appended', { conversationId: CONVERSATION })
    await flush()
    frames.push(render(screen))

    // ... and more deltas after it.
    emit('message.delta', { conversationId: CONVERSATION, text: ', friend' })
    frames.push(render(screen))

    // The turn ends: the desktop saved first, then announced.
    mockDesktop.messages.push({
      id: 'm_2_bbbbbb',
      role: 'assistant',
      content: 'Hello there, friend',
      timestamp: 2,
      segments: [textSegment('s1', 'Hello there, friend')]
    })
    emit('turn.status', { conversationId: CONVERSATION, state: 'done' })
    await flush()
    frames.push(render(screen))

    expectSmooth(frames)
    expectNoRowLost(frames)

    // The tap already shows both rows — this is the "I see nothing when I send
    // a prompt" case, and it is the first frame that has to be right.
    expect(frames[0]).toEqual(['user(hello)', 'assistant(…)'])
    expect(frames[1]).toEqual(['user(hello)', 'assistant(…)'])
    expect(frames[2]).toEqual(['user(hello)', 'assistant(…)'])
    // The assistant row, frame by frame: thinking until there are words, then
    // words that only ever grow. No gap anywhere in the column.
    expect(frames.map((rows) => rows[1])).toEqual([
      'assistant(…)', // the tap
      'assistant(…)', // waiting on the desktop
      'assistant(…)', // id in hand
      'assistant(…)', // turn started
      'assistant(text(Hel))',
      'assistant(text(Hello))',
      'assistant(text(Hello there))',
      'assistant(text(Hello there))', // the snapshot carries the same words
      'assistant(text(Hello there))', // the bare nudge changes nothing
      'assistant(text(Hello there, friend))', // ... and the deltas resume on top
      'assistant(text(Hello there, friend))' // settled, now from the stored copy
    ])
    // Settled: one user row, one assistant row, both from the stored copy.
    expect(frames.at(-1)).toEqual(['user(hello)', 'assistant(text(Hello there, friend))'])
    expect(useChatRuntime.getState().streams[CONVERSATION]).toBeUndefined()
  })

  it('holds the reply on screen when done overtakes the desktop save', async () => {
    // The real race. `turn.status: done` comes from the turn runner's lifecycle
    // listener, the save from the channel sink — two paths, no ordering between
    // them — so the first body fetch after `done` can return a transcript that
    // stops before the answer. Releasing the live row on that fetch is what
    // made the reply blink out at the very end of a turn.
    const screen = { conversationId: CONVERSATION }
    const frames: string[][] = []
    seed([{ id: 'm_1_aaaaaa', role: 'user', content: 'hi', timestamp: 1 }])

    emit('turn.status', { conversationId: CONVERSATION, state: 'started' })
    emit('message.appended', {
      conversationId: CONVERSATION,
      message: {
        id: 'm_2_bbbbbb',
        role: 'assistant',
        content: 'the answer',
        timestamp: 2,
        segments: [textSegment('s1', 'the answer')]
      }
    })
    frames.push(render(screen))

    // done, but the disk write has not landed.
    emit('turn.status', { conversationId: CONVERSATION, state: 'done' })
    await flush()
    frames.push(render(screen))
    expect(frames.at(-1)).toEqual(['user(hi)', 'assistant(text(the answer))'])

    // The save completes and the desktop nudges. Now the fetch has something.
    mockDesktop.messages.push({
      id: 'm_2_bbbbbb',
      role: 'assistant',
      content: 'the answer',
      timestamp: 2,
      segments: [textSegment('s1', 'the answer')]
    })
    emit('message.appended', { conversationId: CONVERSATION })
    await flush()
    frames.push(render(screen))

    expectSmooth(frames)
    expect(frames.at(-1)).toEqual(['user(hi)', 'assistant(text(the answer))'])
    expect(useChatRuntime.getState().streams[CONVERSATION]).toBeUndefined()
  })

  it('ignores a bare nudge mid-turn instead of refetching over the answer', async () => {
    // index.ts pushes an id-less `message.appended` from the video-task
    // write-through, and an older mockDesktop pushes one per tool segment. Acting
    // on it mid-turn fetches the pre-turn transcript — the exact wipe.
    const screen = { conversationId: CONVERSATION }
    seed([{ id: 'm_1_aaaaaa', role: 'user', content: 'hi', timestamp: 1 }])
    emit('turn.status', { conversationId: CONVERSATION, state: 'started' })
    emit('message.delta', { conversationId: CONVERSATION, text: 'half an ans' })
    const before = render(screen)

    emit('message.appended', { conversationId: CONVERSATION })
    await flush()

    expect(render(screen)).toEqual(before)
    expect(render(screen)).toContain('assistant(text(half an ans))')
    expect(mockBodyFetches).toHaveLength(0)
  })

  it('renders tool and task cards in the order the desktop wrote them', async () => {
    // Verbose on: the mockPhone draws the same cards the mockDesktop's own feed does,
    // from the snapshots, in the sequence they were produced.
    const screen = { conversationId: CONVERSATION }
    seed([{ id: 'm_1_aaaaaa', role: 'user', content: 'make a video', timestamp: 1 }])
    emit('turn.status', { conversationId: CONVERSATION, state: 'started' })

    const segments: Segment[] = [textSegment('s1', 'On it.')]
    const snapshot = (): void =>
      emit('message.appended', {
        conversationId: CONVERSATION,
        message: {
          id: 'm_2_bbbbbb',
          role: 'assistant',
          content: 'On it.',
          timestamp: 2,
          segments: [...segments]
        }
      })

    snapshot()
    expect(render(screen, true)).toEqual(['user(make a video)', 'assistant(text(On it.))'])

    segments.push({
      kind: 'tool_call',
      turnId: 't1',
      segmentId: 's2',
      toolCallId: 'c1',
      name: 'video_generate',
      args: {}
    })
    snapshot()
    expect(render(screen, true)).toEqual([
      'user(make a video)',
      'assistant(text(On it.) + tool(video_generate:running))'
    ])

    segments.push({
      kind: 'tool_result',
      turnId: 't1',
      segmentId: 's3',
      toolCallId: 'c1',
      status: 'success',
      output: 'queued'
    })
    snapshot()
    expect(render(screen, true)).toEqual([
      'user(make a video)',
      'assistant(text(On it.) + tool(video_generate:done))'
    ])
  })

  it('re-settles a turn the phone was disconnected through', async () => {
    // The phone drops mid-turn and the turn finishes without it, so the
    // terminal event is never delivered. Reconnecting re-attaches the stream,
    // and every turn still believed to be running is re-checked against the
    // desktop rather than left rotating.
    const screen = { conversationId: CONVERSATION }
    seed([{ id: 'm_1_aaaaaa', role: 'user', content: 'hi', timestamp: 1 }])
    emit('turn.status', { conversationId: CONVERSATION, state: 'started' })
    expect(render(screen)).toEqual(['user(hi)', 'assistant(…)'])

    // ... away. The desktop finishes and saves.
    mockDesktop.messages.push({
      id: 'm_2_bbbbbb',
      role: 'assistant',
      content: 'finished while you were away',
      timestamp: 2,
      segments: [textSegment('s1', 'finished while you were away')]
    })
    attachTurnStream() // what a reconnect does
    await flush()

    expect(render(screen)).toEqual([
      'user(hi)',
      'assistant(text(finished while you were away))'
    ])
    expect(useChatRuntime.getState().streams[CONVERSATION]).toBeUndefined()
  })

  it('takes the thinking words down when a turn ends without writing anything', async () => {
    // Aborted before its first segment: nothing to persist, so no stored
    // message will ever match the live row. It has to come down on the settle
    // rather than sit there rotating forever.
    const screen = { conversationId: CONVERSATION }
    seed([{ id: 'm_1_aaaaaa', role: 'user', content: 'hi', timestamp: 1 }])
    emit('turn.status', { conversationId: CONVERSATION, state: 'started' })
    expect(render(screen)).toEqual(['user(hi)', 'assistant(…)'])

    emit('turn.status', { conversationId: CONVERSATION, state: 'canceled' })
    await flush()

    expect(render(screen)).toEqual(['user(hi)'])
    expect(useChatRuntime.getState().streams[CONVERSATION]).toBeUndefined()
  })

  it('keeps the prompt visible when the desktop has not echoed it back yet', async () => {
    // A body fetch mid-flight returns the conversation WITHOUT the prompt (the
    // mockDesktop persists it a moment after answering the RPC). The optimistic row
    // is not in SQLite to be deleted — it is in the live turn, and it stays.
    mockRpc.mockResolvedValue({ conversationId: CONVERSATION })
    await sendPrompt({ conversationId: CONVERSATION, text: 'are you there' })
    mockCached = [] // an empty body landed
    expect(render({ conversationId: CONVERSATION })).toEqual([
      'user(are you there)',
      'assistant(…)'
    ])

    // Once the desktop's copy arrives — under the id the phone sent — the row
    // is replaced, not joined.
    mockCached = [{ id: sentMessageId(), role: 'user', content: 'are you there', timestamp: 9 }]
    expect(render({ conversationId: CONVERSATION })).toEqual([
      'user(are you there)',
      'assistant(…)'
    ])
  })
})

/** The id the phone minted and handed to the desktop with the prompt. */
function sentMessageId(): string {
  const id = useChatRuntime.getState().streams[CONVERSATION]?.user?.id
  expect(id).toMatch(/^m_\d+_[0-9a-f]{6}$/)
  expect(mockRpc).toHaveBeenCalledWith(
    'desktop.chat.send',
    expect.objectContaining({ messageId: id })
  )
  return id as string
}

describe('rows the renderer has to survive', () => {
  it('draws a stored message that has prose but no segments', () => {
    // Every message the DESKTOP writes carries segments, so this looks like a
    // case that cannot happen — but the phone writes its own offline reply,
    // and it has none. Rendered off segments alone it was an empty bubble with
    // a copy button under it.
    mockCached = [
      { id: 'm_9_ffffff', role: 'assistant', content: 'No desktop to answer.', timestamp: 9 }
    ]
    expect(render({ conversationId: CONVERSATION })).toEqual([
      'assistant(text(No desktop to answer.))'
    ])
  })

  it('never shows the same message twice while the overlay and the store overlap', () => {
    // The window the whole design exists to make harmless: both halves holding
    // the same message at once. The merge is by id, so this is a no-op rather
    // than a race to get right.
    const message: ConversationMessage = {
      id: 'm_2_bbbbbb',
      role: 'assistant',
      content: 'done',
      timestamp: 2,
      segments: [textSegment('s1', 'done')]
    }
    mockCached = [{ id: 'm_1_aaaaaa', role: 'user', content: 'hi', timestamp: 1 }, message]
    useChatRuntime.getState().putStream(CONVERSATION, {
      message,
      base: message,
      tail: '',
      status: 'complete',
      user: { id: 'm_1_aaaaaa', role: 'user', content: 'hi', timestamp: 1 }
    })
    expect(render({ conversationId: CONVERSATION })).toEqual(['user(hi)', 'assistant(text(done))'])
  })

  it('keeps the live row under one key as it turns from thinking into text', () => {
    // The typed thinking words are stateful; a key that changed when the
    // desktop finally named the message would remount the row and restart
    // them mid-turn.
    useChatRuntime.getState().putStream(CONVERSATION, {
      message: { role: 'assistant', content: '', timestamp: 1 },
      status: 'streaming'
    })
    const thinking = buildFeed({ live: useChatRuntime.getState().streams[CONVERSATION] })
    useChatRuntime.getState().putStream(CONVERSATION, {
      message: {
        id: 'm_2_bbbbbb',
        role: 'assistant',
        content: 'x',
        timestamp: 1,
        segments: [textSegment('s1', 'x')]
      },
      status: 'streaming'
    })
    const writing = buildFeed({ live: useChatRuntime.getState().streams[CONVERSATION] })
    expect(thinking.at(-1)?.key).toBe(writing.at(-1)?.key)
  })
})
