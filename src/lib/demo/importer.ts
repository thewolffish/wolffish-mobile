import { upsertConversation } from '@/lib/conversations/repo'
import type { ConversationFile } from '@/lib/conversations/types'
import { demoSourceAvailable, demoSourceConversationsDir } from '@/lib/files/fileCache'
import { useDemoConfig, type ConfigSnapshot } from '@/state/demoConfig'
import { Directory, File, Paths } from 'expo-file-system'

/**
 * Demo mode ingestion. The demo dataset (built by scripts/demo/build-demo-data.mjs
 * from three months of real desktop usage, pushed by scripts/demo/push-demo-data.sh)
 * lands in Documents/demo-source/conversations — metadata only, no media.
 * Entering demo mode ingests the conversation JSONs into SQLite; the files they
 * reference are downloaded from the published sample set on first view (see
 * lib/files/sampleFiles.ts) — the same metadata-first, content-on-demand flow
 * the real desktop sync will use.
 */

export type DemoImportResult = {
  imported: number
  failed: number
  skipped: boolean
}

/**
 * Apply the real-workspace config snapshot into the demo config store —
 * capabilities with their SKILL.md descriptions, MCP servers, connections,
 * channel settings, brain/preferences. Runs on every demo entry (cheap),
 * modeling live sync's cached-then-refresh behavior.
 */
export async function applyConfigSnapshot(): Promise<boolean> {
  try {
    const file = new File(new Directory(Paths.document, 'demo-source'), 'config-snapshot.json')
    if (!file.exists) return false
    const snapshot = JSON.parse(await file.text()) as ConfigSnapshot
    if (!Array.isArray(snapshot.capabilities)) return false
    useDemoConfig.getState().applySnapshot(snapshot)
    return true
  } catch {
    return false
  }
}

export async function importDemoData(
  onProgress?: (done: number, total: number) => void
): Promise<DemoImportResult> {
  if (!demoSourceAvailable()) return { imported: 0, failed: 0, skipped: true }

  const dir = demoSourceConversationsDir()
  if (!dir.exists) return { imported: 0, failed: 0, skipped: true }

  const entries = dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
  let imported = 0
  let failed = 0
  for (const entry of entries) {
    try {
      const raw = await entry.text()
      const file = JSON.parse(raw) as ConversationFile
      if (!file.id || !Array.isArray(file.messages)) throw new Error('malformed conversation')
      await upsertConversation(file)
      imported += 1
    } catch {
      failed += 1
    }
    onProgress?.(imported + failed, entries.length)
  }
  return { imported, failed, skipped: false }
}
