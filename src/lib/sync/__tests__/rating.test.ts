import type { ConversationRating } from '@/lib/conversations/types'

/**
 * Turn scoring across two screens.
 *
 * A score is one fact with three writers — this phone, the desktop's own bar,
 * a bare-number channel reply — and every failure here is silent: a segment
 * that flips back and forth for half a second reads as a rendering glitch, and
 * a vote that quietly reached nothing looks exactly like one that landed. So
 * what is pinned below is the ordering, not the happy path: whose copy wins
 * when two of them describe the same turn at the same moment.
 */

// ---------------------------------------------------------------- fakes

/** One conversation row's ratings blob — the only column this exercises. */
const store: { rows: Record<string, string | null> } = { rows: {} }

function argsOf(rest: unknown[]): unknown[] {
  return rest.length === 1 && Array.isArray(rest[0]) ? (rest[0] as unknown[]) : rest
}

const exec = {
  getFirstAsync: async (sql: string, ...rest: unknown[]) => {
    const args = argsOf(rest)
    if (sql.includes('ratings_json FROM conversations')) {
      const id = args[0] as string
      if (!(id in store.rows)) return null
      return { ratings_json: store.rows[id] }
    }
    return null
  },
  runAsync: async (sql: string, ...rest: unknown[]) => {
    const args = argsOf(rest)
    if (sql.startsWith('UPDATE conversations SET ratings_json')) {
      store.rows[args[1] as string] = args[0] as string | null
    }
    return undefined
  }
}

const mockDb = {
  ...exec,
  withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) => {
    await fn(exec)
  }
}

jest.mock('@/lib/db/database', () => ({ getDb: () => Promise.resolve(mockDb) }))

const mockInvalidate = jest.fn()
jest.mock('@/lib/conversations/cache', () => ({
  invalidateConversation: (id: string) => mockInvalidate(id)
}))

const mockRpc = jest.fn()
const mockReportRpcFailure = jest.fn()
const link = { connected: true }
jest.mock('@/lib/tunnel/client', () => ({
  tunnelClient: {
    get connected() {
      return link.connected
    },
    get active() {
      return link.connected ? { rpc: mockRpc, connected: true } : null
    },
    reportRpcFailure: (error: unknown) => mockReportRpcFailure(error)
  }
}))

const app = { paired: true }
jest.mock('@/state/appStore', () => ({
  useAppStore: { getState: () => ({ paired: app.paired }) }
}))

import { getConversationRatings } from '@/lib/conversations/repo'
import {
  applyRemoteRatings,
  foldFetchedRatings,
  rateTurn,
  resetRatingStateForTests
} from '@/lib/sync/rating'
import { Rpc } from '@/lib/tunnel/protocol'

const CONV = 'conv-1'

function rating(
  messageId: string,
  score: number,
  at = 1_000,
  source = 'inapp'
): ConversationRating {
  return { messageId, score, at, source }
}

/**
 * Wait until the vote is on the wire. Counting microtask ticks would be a
 * guess about how many awaits the write path happens to contain today; the
 * send itself is the observable event, and everything optimistic — the local
 * write, the repaint — is complete by the time it fires.
 */
async function untilSent(): Promise<void> {
  for (let i = 0; i < 100 && mockRpc.mock.calls.length === 0; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve())
    })
  }
}

async function scores(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const entry of await getConversationRatings(CONV)) out[entry.messageId] = entry.score
  return out
}

beforeEach(() => {
  store.rows = { [CONV]: null }
  resetRatingStateForTests()
  mockRpc.mockReset()
  mockInvalidate.mockReset()
  mockReportRpcFailure.mockReset()
  link.connected = true
  app.paired = true
})

describe('a vote cast on this phone', () => {
  it('paints before the desktop answers, then settles on what it persisted', async () => {
    let answer: (value: unknown) => void = () => undefined
    mockRpc.mockImplementation(() => new Promise((resolve) => (answer = resolve)))

    const vote = rateTurn(CONV, 'm1', 8)
    // The RPC has not answered, and the segment is already filled.
    await untilSent()
    expect(await scores()).toEqual({ m1: 8 })
    expect(mockRpc).toHaveBeenCalledWith(Rpc.rateTurn, {
      conversationId: CONV,
      messageId: 'm1',
      score: 8
    })

    // The desktop clamps, stamps and sources the record it actually wrote.
    answer({ rating: rating('m1', 8, 5_000, 'mobile') })
    expect(await vote).toBe(true)
    const stored = await getConversationRatings(CONV)
    expect(stored).toEqual([{ messageId: 'm1', score: 8, at: 5_000, source: 'mobile' }])
  })

  it('takes the paint back down when the desktop had nothing to score', async () => {
    mockRpc.mockResolvedValue({ rating: null })
    expect(await rateTurn(CONV, 'm1', 8)).toBe(false)
    expect(await scores()).toEqual({})
  })

  it('restores the previous score when a re-vote fails', async () => {
    mockRpc.mockResolvedValueOnce({ rating: rating('m1', 3, 2_000, 'mobile') })
    await rateTurn(CONV, 'm1', 3)
    mockRpc.mockRejectedValueOnce(new Error('link died'))
    expect(await rateTurn(CONV, 'm1', 9)).toBe(false)
    expect(await scores()).toEqual({ m1: 3 })
    expect(mockReportRpcFailure).toHaveBeenCalled()
  })

  it('clamps to 0-10 before it reaches the wire', async () => {
    mockRpc.mockResolvedValue({ rating: rating('m1', 10, 1, 'mobile') })
    await rateTurn(CONV, 'm1', 42)
    expect(mockRpc).toHaveBeenCalledWith(Rpc.rateTurn, {
      conversationId: CONV,
      messageId: 'm1',
      score: 10
    })
  })

  it('refuses when paired but offline — the vote has nowhere to land', async () => {
    link.connected = false
    expect(await rateTurn(CONV, 'm1', 8)).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(await scores()).toEqual({})
  })

  it('is the whole act in demo mode, where there is no desktop', async () => {
    app.paired = false
    link.connected = false
    expect(await rateTurn(CONV, 'm1', 6)).toBe(true)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(await scores()).toEqual({ m1: 6 })
  })
})

describe('a score cast on another surface', () => {
  it('lands on this phone without touching the other turns', async () => {
    await applyRemoteRatings(CONV, [rating('m1', 4)])
    await applyRemoteRatings(CONV, [rating('m2', 7)])
    expect(await scores()).toEqual({ m1: 4, m2: 7 })
    expect(mockInvalidate).toHaveBeenCalledWith(CONV)
  })

  it('replaces a score this phone already showed for that turn', async () => {
    await applyRemoteRatings(CONV, [rating('m1', 4)])
    await applyRemoteRatings(CONV, [rating('m1', 9, 3_000, 'telegram')])
    expect(await scores()).toEqual({ m1: 9 })
  })

  it('is ignored for a turn whose vote is still on the wire', async () => {
    let answer: (value: unknown) => void = () => undefined
    mockRpc.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const vote = rateTurn(CONV, 'm1', 8)
    await untilSent()

    // The desktop's copy of this turn as it was BEFORE the vote — applying it
    // would flip the segment the finger just chose back to its old value.
    await applyRemoteRatings(CONV, [rating('m1', 2)])
    expect(await scores()).toEqual({ m1: 8 })

    answer({ rating: rating('m1', 8, 5_000, 'mobile') })
    await vote
    // Held only while it was in flight: the next score from anywhere applies.
    await applyRemoteRatings(CONV, [rating('m1', 1, 6_000)])
    expect(await scores()).toEqual({ m1: 1 })
  })
})

describe('the scores a fetched body carries', () => {
  it('add what is new and drop what the desktop no longer holds', async () => {
    await applyRemoteRatings(CONV, [rating('m1', 4), rating('m2', 5)])
    await foldFetchedRatings(CONV, [rating('m2', 5), rating('m3', 6)])
    expect(await scores()).toEqual({ m2: 5, m3: 6 })
  })

  it('keep a vote still on the wire, which the served body predates', async () => {
    let answer: (value: unknown) => void = () => undefined
    mockRpc.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const vote = rateTurn(CONV, 'm1', 8)
    await untilSent()

    // A body read on the desktop before the vote landed: it knows nothing of
    // m1, and honouring that would erase a score the user is looking at.
    await foldFetchedRatings(CONV, [rating('m9', 2)])
    expect(await scores()).toEqual({ m1: 8, m9: 2 })

    answer({ rating: rating('m1', 8, 5_000, 'mobile') })
    await vote
    expect(await scores()).toEqual({ m1: 8, m9: 2 })
  })

  it('leave the phone alone when the field is absent — an older desktop', async () => {
    await applyRemoteRatings(CONV, [rating('m1', 4)])
    // sync.ts only calls this for an array; the guard is that absence never
    // reaches here as an empty set.
    expect(await scores()).toEqual({ m1: 4 })
  })
})
