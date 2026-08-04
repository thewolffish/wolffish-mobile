import { getDb } from '@/lib/db/database'
import { fetchDesktopFileInto } from '@/lib/sync/files'
import { useAppStore } from '@/state/appStore'
import { Directory, File, Paths } from 'expo-file-system'

/**
 * Workspace file cache. Media referenced by conversations keeps the desktop's
 * workspace-relative paths ("uploads/conv-…/photo.png", "files/report.pdf").
 * Files are materialized on demand into Documents/workspace and tracked in
 * the cached_files table; when the cache grows past the budget the least
 * recently used files are deleted. A deleted file is simply re-fetched the
 * next time its conversation is opened.
 *
 * The fetch source follows the app's mode. Paired, a path's real bytes come
 * from the desktop's workspace over the tunnel — and only from there: falling
 * back to a CDN sample would cache demo bytes under a real path, which is
 * exactly the lie this branch exists to prevent. Unpaired (demo mode), each
 * path is served the published sample for its file type (see sampleFiles.ts)
 * — nothing is bundled or pushed, and that behavior is unchanged.
 */

import { selectPrunable, type CachedFileRow } from './lru'
import { sampleUrlFor } from './sampleFiles'

/** Default budget — release content beyond 10 GB, per product requirement. */
export const DEFAULT_CACHE_BUDGET_BYTES = 10 * 1024 * 1024 * 1024

export type { CachedFileRow }

/** Scratch space for in-progress downloads, outside the tracked cache. */
const DOWNLOAD_DIR = 'downloads'

function workspaceRoot(): Directory {
  return new Directory(Paths.document, 'workspace')
}

function fileAt(root: Directory, relPath: string): File {
  return new File(root, relPath)
}

function ensureParent(root: Directory, relPath: string): void {
  const parts = relPath.split('/').slice(0, -1)
  if (parts.length === 0) return
  new Directory(root, ...parts).create({ intermediates: true, idempotent: true })
}

async function touch(relPath: string): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'UPDATE cached_files SET last_access_at = ? WHERE rel_path = ?',
    Date.now(),
    relPath
  )
}

async function record(relPath: string, sizeBytes: number, conversationId?: string): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `INSERT OR REPLACE INTO cached_files (rel_path, size_bytes, last_access_at, conversation_id)
     VALUES (?, ?, ?, ?)`,
    relPath,
    sizeBytes,
    Date.now(),
    conversationId ?? null
  )
}

/** A filesystem-safe scratch name; the tail keeps the extension intact. */
function scratchFile(relPath: string): File {
  const name = relPath.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-100)
  return new File(new Directory(Paths.cache, DOWNLOAD_DIR), name)
}

/**
 * Write text content directly into the workspace at `relPath` — the demo
 * importer's path for files whose bytes ship inside the bundle (per-path
 * chart specs) instead of resolving to the per-type CDN sample. Deliberately
 * not recorded in cached_files: the LRU must never prune one (the re-fetch
 * would silently swap it for the generic sample), and purgeDemoState deletes
 * the whole workspace directory, so nothing can leak. Returns false on a
 * traversal-shaped path or a failed write.
 */
export function seedWorkspaceFile(relPath: string, content: string): boolean {
  // The bundle is our own content, but a malformed path must not escape the
  // workspace directory.
  const segments = relPath.split('/')
  if (segments.some((part) => part === '' || part === '.' || part === '..')) return false
  try {
    ensureParent(workspaceRoot(), relPath)
    const target = fileAt(workspaceRoot(), relPath)
    if (target.exists) target.delete()
    target.write(content)
    return true
  } catch {
    return false
  }
}

/** In-flight downloads, keyed by workspace-relative path. */
const inFlight = new Map<string, Promise<string | null>>()

/**
 * Download a path's bytes into the cache. The download lands in scratch space
 * first and is moved into place only once complete: on Android a failed
 * download leaves a partial file behind, and a truncated file sitting at the
 * real path would read as a valid cache hit forever after.
 */
async function fetchIntoCache(relPath: string, conversationId?: string): Promise<string | null> {
  try {
    new Directory(Paths.cache, DOWNLOAD_DIR).create({ intermediates: true, idempotent: true })
    const scratch = scratchFile(relPath)

    if (useAppStore.getState().paired) {
      // Paired: the desktop is the only honest source for this path.
      if (!(await fetchDesktopFileInto(relPath, scratch))) throw new Error('desktop fetch failed')
    } else {
      // Demo: the published sample for this path's file type.
      const url = sampleUrlFor(relPath)
      if (!url) return null
      await File.downloadFileAsync(url, scratch, { idempotent: true })
    }

    const target = fileAt(workspaceRoot(), relPath)
    ensureParent(workspaceRoot(), relPath)
    await scratch.move(target, { overwrite: true })
    await record(relPath, target.size ?? 0, conversationId)
    void enforceCacheBudget()
    return target.uri
  } catch {
    // Offline, an unpublished type, a full disk — the viewer shows its per-type
    // unavailable state and the next mount retries. A fresh handle, because
    // move() repoints the one it was given at the destination.
    try {
      const leftover = scratchFile(relPath)
      if (leftover.exists) leftover.delete()
    } catch {
      // Nothing to clean up.
    }
    return null
  }
}

/**
 * Resolve a workspace-relative path to a local file URI, fetching it into the
 * cache if needed. Returns null when the file is unavailable (renderers show
 * their per-type missing state).
 */
export async function resolveWorkspaceFile(
  relPath: string,
  conversationId?: string
): Promise<string | null> {
  try {
    const cached = fileAt(workspaceRoot(), relPath)
    if (cached.exists) {
      void touch(relPath)
      return cached.uri
    }

    // A card and its expanded sheet mount together and ask for the same path;
    // one download serves both.
    const running = inFlight.get(relPath)
    if (running) return await running

    const fetching = fetchIntoCache(relPath, conversationId).finally(() => {
      inFlight.delete(relPath)
    })
    inFlight.set(relPath, fetching)
    return await fetching
  } catch {
    return null
  }
}

/** Store a locally created file (e.g. a voice recording) into the cache. */
export async function importLocalFile(
  sourceUri: string,
  relPath: string,
  conversationId?: string
): Promise<string | null> {
  try {
    const source = new File(sourceUri)
    if (!source.exists) return null
    ensureParent(workspaceRoot(), relPath)
    const target = fileAt(workspaceRoot(), relPath)
    if (target.exists) target.delete()
    await source.move(target)
    await record(relPath, target.size ?? 0, conversationId)
    return target.uri
  } catch {
    return null
  }
}

export { selectPrunable }

export async function enforceCacheBudget(
  budgetBytes: number = DEFAULT_CACHE_BUDGET_BYTES
): Promise<number> {
  const db = await getDb()
  const rows = await db.getAllAsync<CachedFileRow>(
    'SELECT rel_path, size_bytes, last_access_at FROM cached_files'
  )
  const doomed = selectPrunable(rows, budgetBytes)
  for (const row of doomed) {
    try {
      const file = fileAt(workspaceRoot(), row.rel_path)
      if (file.exists) file.delete()
    } catch {
      // Deleting a missing file is fine — the row is what matters.
    }
    await db.runAsync('DELETE FROM cached_files WHERE rel_path = ?', row.rel_path)
  }
  return doomed.length
}

export type CacheUsage = { totalBytes: number; fileCount: number }

export async function getCacheUsage(): Promise<CacheUsage> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ total: number | null; n: number }>(
    'SELECT SUM(size_bytes) AS total, COUNT(*) AS n FROM cached_files'
  )
  return { totalBytes: row?.total ?? 0, fileCount: row?.n ?? 0 }
}
