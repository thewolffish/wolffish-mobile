jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

/**
 * seedActiveRuns — what this phone believes is RUNNING, the moment it connects.
 *
 * Turn lifecycle arrives as pushes and nothing else, so a tunnel that comes up
 * mid-run has already missed the only `turn.status: started` that turn will
 * ever send. Everything downstream reads "running" off the live streams (see
 * conversations/rows.ts), so that gap renders a busy conversation as idle:
 * live composer and no stop, over a turn that has not finished.
 *
 * The seed closes it, and the cases below are all the ways it must not overshoot
 * — a seed that re-opens a finished turn leaves thinking words running forever,
 * and one that re-BEGINS a turn throws away the card the user came back to
 * answer.
 */

jest.mock('@/lib/sync/sync', () => ({ fetchConversationBody: jest.fn(async () => true) }))
jest.mock('@/lib/conversations/cache', () => ({
  invalidateConversation: jest.fn(),
  invalidateConversationList: jest.fn(),
  refetchConversation: jest.fn(async () => undefined),
  conversationHasMessage: () => false
}))
jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }))
jest.mock('@/lib/db/database', () => ({ getDb: () => Promise.resolve({}) }))

const mockRpc = jest.fn()
let mockConnected = true
jest.mock('@/lib/tunnel/client', () => ({
  tunnelClient: {
    get active() {
      return { rpc: mockRpc, onEvent: () => undefined }
    },
    get connected() {
      return mockConnected
    }
  }
}))

import { seedActiveRuns } from '@/lib/sync/prompt'
import { useChatRuntime } from '@/state/chatRuntime'
import { useRunStatus } from '@/state/runStatus'

const RUNNING = 'conv-running'

const approval = {
  approvalId: 'ap-1',
  toolCallId: 'call-1',
  tool: 'shell',
  args: { command: 'rm -rf build' },
  reason: 'destructive',
  level: 'destructive' as const
}

beforeEach(() => {
  mockRpc.mockReset()
  mockConnected = true
  useChatRuntime.getState().reset()
  useRunStatus.getState().reset()
})

const streams = (): Record<string, ReturnType<typeof useChatRuntime.getState>['streams'][string]> =>
  useChatRuntime.getState().streams

describe('seedActiveRuns', () => {
  it('opens a live turn for a run this phone never heard start', async () => {
    mockRpc.mockResolvedValue({ conversationIds: [RUNNING] })
    await seedActiveRuns()
    expect(streams()[RUNNING]?.status).toBe('streaming')
  })

  it('re-opens a turn a reconnect only ASSUMED had ended, keeping what it had', async () => {
    // attachTurnStream force-settles on reconnect: it cannot know whether the
    // turn ended while the phone was away. The desktop says it did not.
    useChatRuntime.getState().putStream(RUNNING, {
      message: { id: 'm1', role: 'assistant', content: 'half writ', timestamp: 1 },
      base: { id: 'm1', role: 'assistant', content: 'half writ', timestamp: 1 },
      tail: 'ten',
      user: { id: 'u1', role: 'user', content: 'do it', timestamp: 0 },
      status: 'complete',
      ended: 'assumed'
    })
    useChatRuntime.getState().putApproval(RUNNING, approval)

    mockRpc.mockResolvedValue({ conversationIds: [RUNNING] })
    await seedActiveRuns()

    const live = streams()[RUNNING]
    expect(live?.status).toBe('streaming')
    expect(live?.ended).toBeUndefined()
    // Nothing about the turn is thrown away — it is the SAME turn.
    expect(live?.message.content).toBe('half writ')
    expect(live?.tail).toBe('ten')
    expect(live?.user?.id).toBe('u1')
    // And the card the user reconnected to answer is still up. beginTurn would
    // have cleared it (a fresh turn settles the previous one's questions),
    // which is why re-opening is deliberately not beginning.
    expect(useChatRuntime.getState().cards[RUNNING]?.approvals['call-1']).toBeTruthy()
  })

  it('leaves a turn the desktop CONFIRMED finished alone', async () => {
    // A terminal turn.status landed while the answer was in flight. It is the
    // newer truth; re-opening would put thinking words over a finished turn.
    useChatRuntime.getState().putStream(RUNNING, {
      message: { id: 'm1', role: 'assistant', content: 'done', timestamp: 1 },
      status: 'complete',
      ended: 'desktop'
    })
    mockRpc.mockResolvedValue({ conversationIds: [RUNNING] })
    await seedActiveRuns()
    expect(streams()[RUNNING]?.status).toBe('complete')
    expect(streams()[RUNNING]?.ended).toBe('desktop')
  })

  it('leaves a run that ended DURING the round trip alone', async () => {
    // The nastier shape of the same race: the terminal push arrives before any
    // overlay exists, so it marks only the run store and there is no stream to
    // find. Without the timestamp check the stale answer opens one that nothing
    // will ever close.
    let release: (value: unknown) => void = () => undefined
    mockRpc.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const seeding = seedActiveRuns()
    await Promise.resolve()
    useRunStatus.getState().markRun(RUNNING, 'completed')
    release({ conversationIds: [RUNNING] })
    await seeding
    expect(streams()[RUNNING]).toBeUndefined()
  })

  it('still seeds a conversation whose LAST run ended long ago', async () => {
    // The guard above must key on "ended after we asked", not "has ever ended"
    // — a conversation that ran this morning and is running again now is the
    // ordinary case.
    useRunStatus.getState().markRun(RUNNING, 'completed', Date.now() - 60_000)
    mockRpc.mockResolvedValue({ conversationIds: [RUNNING] })
    await seedActiveRuns()
    expect(streams()[RUNNING]?.status).toBe('streaming')
  })

  it('is silent on a desktop too old to answer, and on junk', async () => {
    mockRpc.mockRejectedValue(new Error('unknown method'))
    await expect(seedActiveRuns()).resolves.toBeUndefined()
    expect(streams()).toEqual({})

    mockRpc.mockResolvedValue({ conversationIds: 'nope' })
    await seedActiveRuns()
    expect(streams()).toEqual({})

    mockRpc.mockResolvedValue({ conversationIds: [null, '', 7, RUNNING] })
    await seedActiveRuns()
    expect(Object.keys(streams())).toEqual([RUNNING])
  })

  it('does nothing while disconnected', async () => {
    mockConnected = false
    await seedActiveRuns()
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
