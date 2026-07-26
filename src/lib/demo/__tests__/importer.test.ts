jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

import type { ConversationFile } from '@/lib/conversations/types'

/**
 * The demo bundle is a remote contract between scripts/demo/build-demo-bundle.mjs
 * and this importer, and it is the app's entire first-run experience: if the
 * client and the published layout disagree, the only symptom is a Demo Mode
 * button that fails on a stranger's phone. These tests pin the contract —
 * which URLs are requested, in what order, what the progress bar is allowed to
 * do, and what a bad conversation costs.
 */

const mockUpsert = jest.fn<Promise<void>, [ConversationFile]>().mockResolvedValue(undefined)
const mockWritten: string[] = []
const mockCreated = jest.fn()

jest.mock('@/lib/conversations/repo', () => ({
  upsertConversation: (file: ConversationFile) => mockUpsert(file)
}))

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///doc' },
  Directory: class {
    create = mockCreated
  },
  File: class {
    exists = false
    write = (content: string) => mockWritten.push(content)
    text = () => Promise.resolve('')
  }
}))

import { DEMO_BASE_URL, importDemoData, type DemoProgress } from '@/lib/demo/importer'

function conversation(id: string): ConversationFile {
  return {
    id,
    title: id,
    model: null,
    createdAt: 1,
    updatedAt: 2,
    messages: [{ id: `${id}-m`, role: 'user', content: 'hi', timestamp: 1 }]
  } as ConversationFile
}

const CONFIG = { capabilities: [{ name: 'cap', description: '', enabled: true, official: true }] }

const MANIFEST = {
  version: 'abc123def456',
  builtAt: '2026-07-26T00:00:00.000Z',
  conversations: 3,
  totalBytes: 300,
  config: { file: 'config-snapshot.json', bytes: 40 },
  shards: [
    { file: 'conversations-000.json', bytes: 200, conversations: 2 },
    { file: 'conversations-001.json', bytes: 100, conversations: 1 }
  ]
}

let serveBody: (url: string) => Promise<unknown>

/** Serves the bundle layout the build script emits, per-file overridable. */
function serve(overrides: Record<string, unknown> = {}): jest.Mock {
  const bodies: Record<string, unknown> = {
    'manifest.json': MANIFEST,
    'conversations-000.json': { conversations: [conversation('a'), conversation('b')] },
    'conversations-001.json': { conversations: [conversation('c')] },
    'config-snapshot.json': CONFIG,
    ...overrides
  }
  serveBody = (url: string) => {
    const body = bodies[url.slice(url.lastIndexOf('/') + 1)]
    if (body === undefined) return Promise.resolve({ ok: false, status: 404 })
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body))
    })
  }
  const mock = jest.fn((url: string) => serveBody(url))
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

describe('demo bundle import', () => {
  beforeEach(() => {
    mockUpsert.mockClear().mockResolvedValue(undefined)
    mockCreated.mockClear()
    mockWritten.length = 0
  })

  it('fetches the manifest, then every shard, then the config snapshot', async () => {
    const fetched = serve()
    const result = await importDemoData()

    expect(fetched.mock.calls.map(([url]) => url)).toEqual([
      `${DEMO_BASE_URL}/manifest.json`,
      `${DEMO_BASE_URL}/conversations-000.json`,
      `${DEMO_BASE_URL}/conversations-001.json`,
      `${DEMO_BASE_URL}/config-snapshot.json`
    ])
    expect(result).toEqual({ version: 'abc123def456', imported: 3, failed: 0, total: 3 })
    expect(mockUpsert.mock.calls.map(([file]) => file.id)).toEqual(['a', 'b', 'c'])
  })

  it('downloads the whole bundle before writing anything to the database', async () => {
    const order: string[] = []
    const fetched = serve()
    fetched.mockImplementation((url: string) => {
      order.push(`fetch:${url.slice(url.lastIndexOf('/') + 1)}`)
      return serveBody(url)
    })
    mockUpsert.mockImplementation((file) => {
      order.push(`insert:${file.id}`)
      return Promise.resolve()
    })
    await importDemoData()

    // Every fetch precedes every insert: a shard that 404s must not leave the
    // database holding a partial dataset.
    expect(order.lastIndexOf('fetch:config-snapshot.json')).toBeLessThan(order.indexOf('insert:a'))
  })

  it('saves the config snapshot so later entries work offline', async () => {
    serve()
    await importDemoData()
    expect(mockCreated).toHaveBeenCalledWith({ intermediates: true, idempotent: true })
    expect(JSON.parse(mockWritten[0] as string)).toEqual(CONFIG)
  })

  it('reports progress that only ever moves forward and ends at 1', async () => {
    serve()
    const seen: DemoProgress[] = []
    await importDemoData((progress) => seen.push(progress))

    expect(seen.length).toBeGreaterThan(1)
    for (const [index, progress] of seen.entries()) {
      expect(progress.ratio).toBeGreaterThanOrEqual(index === 0 ? 0 : seen[index - 1].ratio)
      expect(progress.ratio).toBeLessThanOrEqual(1)
      expect(progress.imported).toBeLessThanOrEqual(progress.total)
    }
    expect(seen[0]).toEqual({ phase: 'download', ratio: 0, imported: 0, total: 3 })
    expect(seen.at(-1)).toEqual({ phase: 'import', ratio: 1, imported: 3, total: 3 })
  })

  it('skips a malformed conversation instead of losing the shard', async () => {
    serve({
      'conversations-000.json': { conversations: [{ id: 'a', messages: null }, conversation('b')] }
    })
    const result = await importDemoData()
    expect(result).toMatchObject({ imported: 2, failed: 1 })
    expect(mockUpsert.mock.calls.map(([file]) => file.id)).toEqual(['b', 'c'])
  })

  it('throws on an unreachable shard without half-importing the dataset', async () => {
    serve({ 'conversations-001.json': undefined })
    await expect(importDemoData()).rejects.toThrow('404')
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockWritten).toHaveLength(0)
  })

  it('rejects a manifest with no shards rather than reporting an empty success', async () => {
    serve({ 'manifest.json': { ...MANIFEST, shards: [] } })
    await expect(importDemoData()).rejects.toThrow('no shards')
  })
})
