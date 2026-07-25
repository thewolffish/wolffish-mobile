/**
 * Pure LRU selection for the workspace file cache — separated from the
 * expo-file-system plumbing so the release policy is unit-testable.
 */

/** Files touched this recently are never pruned (an open conversation's media). */
export const PRUNE_GRACE_MS = 5 * 60 * 1000

export type CachedFileRow = {
  rel_path: string
  size_bytes: number
  last_access_at: number
}

/**
 * Which rows to delete so the total falls back under the budget.
 * Oldest-accessed first; rows inside the grace window are spared.
 */
export function selectPrunable(
  rows: CachedFileRow[],
  budgetBytes: number,
  now: number = Date.now(),
  graceMs: number = PRUNE_GRACE_MS
): CachedFileRow[] {
  let total = rows.reduce((sum, row) => sum + row.size_bytes, 0)
  if (total <= budgetBytes) return []
  const candidates = [...rows]
    .filter((row) => now - row.last_access_at > graceMs)
    .sort((a, b) => a.last_access_at - b.last_access_at)
  const doomed: CachedFileRow[] = []
  for (const row of candidates) {
    if (total <= budgetBytes) break
    doomed.push(row)
    total -= row.size_bytes
  }
  return doomed
}
