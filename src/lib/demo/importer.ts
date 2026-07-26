import { upsertConversation } from '@/lib/conversations/repo'
import type { ConversationFile } from '@/lib/conversations/types'
import { useDemoConfig, type ConfigSnapshot } from '@/state/demoConfig'
import { Directory, File, Paths } from 'expo-file-system'

/**
 * Demo mode ingestion. The demo dataset — three months of real desktop usage,
 * built by scripts/demo/build-demo-data.mjs and packed by
 * scripts/demo/build-demo-bundle.mjs — is published at cdn.wolffi.sh/demo and
 * downloaded on first entry. Nothing ships in the app and nothing is pushed to
 * a device: tapping Demo Mode on a fresh install off the App Store is the only
 * step there is.
 *
 * The 18 MB of conversation JSON arrives as ~1.5 MB shards (see the bundle
 * script for why), each downloaded, parsed, imported into SQLite and released
 * before the next one starts. Cloudflare brotli/gzips application/json in
 * transit, so the wire cost is ~4 MB and the client needs no decompression.
 *
 * The media those conversations reference is a separate, lazier layer: each
 * workspace path resolves to the published sample for its file type and is
 * fetched on first view (see lib/files/sampleFiles.ts) — the same
 * metadata-first, content-on-demand flow the real desktop sync will use.
 */

/** Where the published demo bundle lives. Peer of SAMPLE_BASE_URL. */
export const DEMO_BASE_URL = 'https://cdn.wolffi.sh/demo'

/** One packed slice of the dataset. `bytes` is the uncompressed shard size. */
export type DemoShard = { file: string; bytes: number; conversations: number }

export type DemoManifest = {
  /** Content hash of the bundle — changes only when the dataset changes. */
  version: string
  builtAt: string
  conversations: number
  totalBytes: number
  config: { file: string; bytes: number }
  shards: DemoShard[]
}

export type DemoProgress = {
  phase: 'download' | 'import'
  /** 0–1 across the whole bundle. */
  ratio: number
  imported: number
  total: number
}

export type DemoImportResult = {
  version: string
  imported: number
  failed: number
  total: number
}

/**
 * Where the bar sits when the last shard finishes downloading. Download is the
 * long pole — ~4 MB over the wire against 169 conversations of 612 messages
 * total — so it gets most of the travel. Inside each phase the bar moves in
 * proportion to real work (bytes fetched, then conversations inserted), which
 * is what keeps it from lurching.
 */
const DOWNLOAD_WEIGHT = 0.7

function demoDir(): Directory {
  return new Directory(Paths.document, 'demo')
}

function configFile(): File {
  return new File(demoDir(), 'config-snapshot.json')
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
  return await response.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T
}

/**
 * Apply the real-workspace config snapshot into the demo config store —
 * capabilities with their SKILL.md descriptions, MCP servers, connections,
 * channel settings, brain/preferences. Reads the copy saved at import time, so
 * it runs offline on every demo entry (cheap), modeling live sync's
 * cached-then-refresh behavior.
 */
export async function applyConfigSnapshot(): Promise<boolean> {
  try {
    const file = configFile()
    if (!file.exists) return false
    const snapshot = JSON.parse(await file.text()) as ConfigSnapshot
    if (!Array.isArray(snapshot.capabilities)) return false
    useDemoConfig.getState().applySnapshot(snapshot)
    return true
  } catch {
    return false
  }
}

/** Persist the snapshot beside the conversations it describes. */
function saveConfigSnapshot(raw: string): void {
  const snapshot = JSON.parse(raw) as ConfigSnapshot
  if (!Array.isArray(snapshot.capabilities)) throw new Error('malformed config snapshot')
  demoDir().create({ intermediates: true, idempotent: true })
  configFile().write(raw)
}

/**
 * Download the published bundle and ingest it into SQLite.
 *
 * Every shard is fetched before the first one is inserted, so a network
 * failure leaves the database untouched rather than half a dataset behind a
 * flag that says it imported. Shard bodies are held as strings and released as
 * each is parsed — the whole set is ~18 MB of text, and holding it is what
 * buys a download phase that can be measured instead of guessed at.
 *
 * Throws when the manifest or any shard cannot be fetched; the caller reports
 * it and leaves the version unset, so the next tap starts over. Inserts are
 * upserts keyed by conversation id, so a retry costs time, never correctness.
 */
export async function importDemoData(
  onProgress?: (progress: DemoProgress) => void
): Promise<DemoImportResult> {
  const manifest = await fetchJson<DemoManifest>(`${DEMO_BASE_URL}/manifest.json`)
  if (!Array.isArray(manifest.shards) || manifest.shards.length === 0) {
    throw new Error('demo manifest has no shards')
  }
  if (!manifest.config?.file) throw new Error('demo manifest has no config snapshot')

  const totalBytes =
    manifest.totalBytes || manifest.shards.reduce((sum, shard) => sum + shard.bytes, 0)
  const total = manifest.conversations || 0
  let imported = 0
  let failed = 0

  // Repainting on every one of 169 inserts costs more than the bar can show.
  let lastPercent = -1
  const report = (phase: DemoProgress['phase'], ratio: number): void => {
    const clamped = Math.max(0, Math.min(ratio, 1))
    const percent = Math.round(clamped * 100)
    if (percent === lastPercent && phase === 'import') return
    lastPercent = percent
    onProgress?.({ phase, ratio: clamped, imported, total })
  }

  // ---- Download --------------------------------------------------------
  const bodies: string[] = []
  let doneBytes = 0
  report('download', 0)
  for (const shard of manifest.shards) {
    bodies.push(await fetchText(`${DEMO_BASE_URL}/${shard.file}`))
    doneBytes += shard.bytes
    report('download', totalBytes > 0 ? (doneBytes / totalBytes) * DOWNLOAD_WEIGHT : 0)
  }
  const configRaw = await fetchText(`${DEMO_BASE_URL}/${manifest.config.file}`)

  // ---- Import ----------------------------------------------------------
  let processed = 0
  const expected = total || manifest.shards.reduce((sum, shard) => sum + shard.conversations, 0)
  for (const [index, shard] of manifest.shards.entries()) {
    const payload = JSON.parse(bodies[index]) as { conversations: ConversationFile[] }
    bodies[index] = '' // The parsed copy is the live one from here on.
    if (!Array.isArray(payload.conversations)) throw new Error(`malformed shard: ${shard.file}`)

    for (const conversation of payload.conversations) {
      try {
        if (!conversation?.id || !Array.isArray(conversation.messages)) {
          throw new Error('malformed conversation')
        }
        await upsertConversation(conversation)
        imported += 1
      } catch {
        // One unreadable conversation must not cost the other 168.
        failed += 1
      }
      processed += 1
      report(
        'import',
        DOWNLOAD_WEIGHT + (1 - DOWNLOAD_WEIGHT) * (expected > 0 ? processed / expected : 1)
      )
    }
  }

  // Last, and only once the conversations it describes are in: a saved
  // snapshot is what makes later entries work offline.
  saveConfigSnapshot(configRaw)
  onProgress?.({ phase: 'import', ratio: 1, imported, total })

  return { version: manifest.version, imported, failed, total }
}
