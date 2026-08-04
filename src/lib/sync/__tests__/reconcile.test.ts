jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

/**
 * Reconciliation is the half of sync nobody sees working.
 *
 * Pushes cover the phone while it is awake; this covers everything it slept
 * through, and every miss here is silent by nature — a conversation deleted
 * on the desktop that lingers on the phone looks exactly like a real one, and
 * a body that stopped growing looks exactly like a finished answer. So the
 * cases pinned here are the ones with no visible symptom: deletions the
 * incremental pull cannot express, and staleness that emptiness cannot detect.
 */

type Row = { id: string; updated_at: number; body_synced_at: number | null }

const mockState: { rows: Row[]; messages: Record<string, number> } = { rows: [], messages: {} }
const mockRunCalls: Array<{ sql: string; args: unknown[] }> = []

const mockRunAsync = jest.fn(async (sql: string, args: unknown[] = []) => {
  mockRunCalls.push({ sql, args })
  if (sql.startsWith('DELETE FROM conversations')) {
    mockState.rows = mockState.rows.filter((r) => r.id !== args[0])
  }
  if (sql.startsWith('DELETE FROM messages')) delete mockState.messages[args[0] as string]
  if (sql.startsWith('UPDATE conversations SET body_synced_at')) {
    const row = mockState.rows.find((r) => r.id === args[1])
    if (row) row.body_synced_at = args[0] as number
  }
  return undefined
})

const mockDb = {
  runAsync: mockRunAsync,
  execAsync: jest.fn(async () => undefined),
  getFirstAsync: jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM sync_meta')) return { value: '100' }
    if (sql.includes('COUNT(*) AS count FROM messages')) {
      return { count: mockState.messages[args[0] as string] ?? 0 }
    }
    if (sql.includes('body_synced_at FROM conversations')) {
      return mockState.rows.find((r) => r.id === args[0]) ?? null
    }
    // The pre-read fetchConversationBody does before asking for a body.
    // Checked after the two-column query above, which also mentions updated_at.
    if (sql.includes('updated_at FROM conversations')) {
      return mockState.rows.find((r) => r.id === args[0]) ?? null
    }
    return null
  }),
  getAllAsync: jest.fn(async (sql: string, args: unknown[] = []) => {
    // Mirrors `SELECT id FROM conversations [WHERE id NOT IN (...)]`.
    if (!sql.includes('NOT IN')) return mockState.rows.map((r) => ({ id: r.id }))
    const keep = new Set(args as string[])
    return mockState.rows.filter((r) => !keep.has(r.id)).map((r) => ({ id: r.id }))
  }),
  withExclusiveTransactionAsync: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
    await fn({ runAsync: mockRunAsync, execAsync: mockDb.execAsync })
  })
}

jest.mock('@/lib/db/database', () => ({ getDb: () => Promise.resolve(mockDb) }))

const mockRpc = jest.fn()
jest.mock('@/lib/tunnel/client', () => ({
  tunnelClient: {
    get active() {
      return { rpc: mockRpc }
    },
    connected: true
  }
}))

jest.mock('@/lib/conversations/cache', () => ({
  invalidateConversation: jest.fn(),
  invalidateConversationList: jest.fn()
}))

jest.mock('@/state/demoConfig', () => ({
  useDemoConfig: { getState: () => ({ applySnapshot: jest.fn() }) },
  // The config half of reconcile delegates here (outbox-aware wrapper); the
  // mock keeps the old observable behavior — one snapshot RPC that can fail
  // independently — so the assertions below stay about reconcile's contract.
  refreshConfigSnapshot: async () => {
    await mockRpc('desktop.config.snapshot')
  }
}))

import { fetchConversationBody, isBodyStale, refreshSync, reconcile } from '@/lib/sync/sync'

beforeEach(() => {
  mockState.rows = []
  mockState.messages = {}
  mockRunCalls.length = 0
  mockRpc.mockReset()
})

describe('refreshSync deletion reconciliation', () => {
  it('drops local conversations the desktop no longer lists', async () => {
    mockState.rows = [
      { id: 'kept', updated_at: 1, body_synced_at: 1 },
      { id: 'deleted-while-asleep', updated_at: 1, body_synced_at: 1 }
    ]
    mockState.messages['deleted-while-asleep'] = 3
    mockRpc.mockResolvedValue({ rows: [], at: 200, ids: ['kept'] })

    const result = await refreshSync(true)

    expect(result.removed).toBe(1)
    expect(mockState.rows.map((r) => r.id)).toEqual(['kept'])
    // Its messages go too — a body with no conversation is unreachable bytes.
    expect(mockState.messages['deleted-while-asleep']).toBeUndefined()
  })

  it('prunes everything when the desktop reports an empty workspace', async () => {
    mockState.rows = [{ id: 'a', updated_at: 1, body_synced_at: null }]
    mockRpc.mockResolvedValue({ rows: [], at: 200, ids: [] })

    expect((await refreshSync(true)).removed).toBe(1)
    expect(mockState.rows).toEqual([])
  })

  // The dangerous direction: a response without ids must never be read as
  // "the desktop has nothing", or one odd reply wipes the phone.
  it('never prunes when the desktop did not send an id list', async () => {
    mockState.rows = [{ id: 'a', updated_at: 1, body_synced_at: null }]
    mockRpc.mockResolvedValue({ rows: [], at: 200 })

    expect((await refreshSync(false)).removed).toBe(0)
    expect(mockState.rows.map((r) => r.id)).toEqual(['a'])
  })

  it('asks for ids only when reconciling', async () => {
    mockRpc.mockResolvedValue({ rows: [], at: 1 })
    await refreshSync(false)
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ withIds: false })
    await refreshSync(true)
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ withIds: true })
  })
})

describe('body staleness', () => {
  it('is stale when the desktop changed it after the last body pull', async () => {
    mockState.rows = [{ id: 'c', updated_at: 500, body_synced_at: 400 }]
    expect(await isBodyStale('c')).toBe(true)
  })

  it('is stale when the body was never pulled', async () => {
    mockState.rows = [{ id: 'c', updated_at: 500, body_synced_at: null }]
    expect(await isBodyStale('c')).toBe(true)
  })

  it('is current when the body pull is at least as new as the change', async () => {
    mockState.rows = [{ id: 'c', updated_at: 400, body_synced_at: 400 }]
    expect(await isBodyStale('c')).toBe(false)
  })

  it('stamps body_synced_at so the next open trusts the cache', async () => {
    mockState.rows = [{ id: 'c', updated_at: 400, body_synced_at: null }]
    mockRpc.mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }]
    })

    await fetchConversationBody('c')

    expect(await isBodyStale('c')).toBe(false)
  })

  it('leaves the stamp unset when the write fails, so the copy is retried', async () => {
    mockState.rows = [{ id: 'c', updated_at: 400, body_synced_at: null }]
    mockRpc.mockResolvedValue({ messages: [] })
    mockDb.withExclusiveTransactionAsync.mockRejectedValueOnce(new Error('disk full'))

    await expect(fetchConversationBody('c')).rejects.toThrow()
    expect(await isBodyStale('c')).toBe(true)
  })
})

describe('reconcile', () => {
  it('brings config and conversations level in one pass', async () => {
    mockRpc.mockImplementation(async (method: string) => {
      if (method === 'desktop.config.snapshot') return {}
      return { rows: [], at: 1, ids: [] }
    })

    await reconcile()

    const methods = mockRpc.mock.calls.map((c) => c[0])
    expect(methods).toEqual(
      expect.arrayContaining(['desktop.config.snapshot', 'desktop.conversations.index'])
    )
  })

  // Half a reconcile is better than none: a desktop that cannot answer for
  // settings must still be able to correct the conversation list.
  it('still syncs conversations when the config pull fails', async () => {
    mockState.rows = [{ id: 'gone', updated_at: 1, body_synced_at: null }]
    mockRpc.mockImplementation(async (method: string) => {
      if (method === 'desktop.config.snapshot') throw new Error('no config')
      return { rows: [], at: 1, ids: [] }
    })

    await expect(reconcile()).resolves.toBeUndefined()
    expect(mockState.rows).toEqual([])
  })
})

describe('fetchConversationBody', () => {
  it('stamps the desktop clock, not this phone clock', async () => {
    // The silent bug: body_synced_at taken from Date.now() is compared
    // against a timestamp the *desktop* wrote. A phone running ahead makes
    // every conversation look current and it never refreshes again.
    mockState.rows = [{ id: 'c', updated_at: 1_000, body_synced_at: null }]
    mockRpc.mockResolvedValue({ messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 1 }] })

    await fetchConversationBody('c')

    expect(mockState.rows[0].body_synced_at).toBe(1_000)
    expect(await isBodyStale('c')).toBe(false)
  })

  it('records the version it actually fetched, so a mid-fetch change refetches', async () => {
    mockState.rows = [{ id: 'c', updated_at: 1_000, body_synced_at: null }]
    mockRpc.mockImplementation(async () => {
      // The desktop edits the conversation while the body is in flight; the
      // push lands before the write completes.
      mockState.rows[0].updated_at = 2_000
      return { messages: [{ id: 'm', role: 'user', content: 'x', timestamp: 1 }] }
    })

    await fetchConversationBody('c')

    // Stamped with what was asked for, not what arrived after — so the copy
    // in hand is correctly seen as behind.
    expect(mockState.rows[0].body_synced_at).toBe(1_000)
    expect(await isBodyStale('c')).toBe(true)
  })

  it('never wipes a good transcript when the answer is malformed', async () => {
    mockState.rows = [{ id: 'c', updated_at: 1_000, body_synced_at: 1_000 }]
    mockState.messages['c'] = 12
    for (const bad of [{}, { messages: null }, { messages: 'nope' }, undefined]) {
      mockRpc.mockResolvedValue(bad)
      expect(await fetchConversationBody('c')).toBe(false)
      expect(mockState.messages['c']).toBe(12)
    }
  })

  it('honours a genuinely emptied conversation', async () => {
    mockState.rows = [{ id: 'c', updated_at: 1_000, body_synced_at: null }]
    mockState.messages['c'] = 3
    mockRpc.mockResolvedValue({ messages: [] })

    expect(await fetchConversationBody('c')).toBe(true)
    expect(mockState.messages['c']).toBeUndefined()
  })
})
