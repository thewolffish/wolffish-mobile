import { selectPrunable, type CachedFileRow } from '@/lib/files/lru'

function row(rel: string, size: number, lastAccess: number): CachedFileRow {
  return { rel_path: rel, size_bytes: size, last_access_at: lastAccess }
}

const NOW = 1_000_000_000
const OLD = NOW - 60 * 60 * 1000 // 1h ago — outside the grace window

describe('selectPrunable', () => {
  it('returns nothing while under budget', () => {
    expect(selectPrunable([row('a', 100, OLD)], 1000, NOW)).toEqual([])
  })

  it('evicts least-recently-used first until back under budget', () => {
    const rows = [
      row('newest', 400, OLD + 3000),
      row('oldest', 400, OLD + 1000),
      row('middle', 400, OLD + 2000)
    ]
    const doomed = selectPrunable(rows, 800, NOW)
    expect(doomed.map((r) => r.rel_path)).toEqual(['oldest'])
  })

  it('keeps evicting until the budget is met', () => {
    const rows = [row('a', 500, OLD + 1), row('b', 500, OLD + 2), row('c', 500, OLD + 3)]
    const doomed = selectPrunable(rows, 500, NOW)
    expect(doomed.map((r) => r.rel_path)).toEqual(['a', 'b'])
  })

  it('spares files accessed inside the grace window even over budget', () => {
    const rows = [row('open-conversation', 2000, NOW - 1000), row('stale', 500, OLD)]
    const doomed = selectPrunable(rows, 1000, NOW)
    expect(doomed.map((r) => r.rel_path)).toEqual(['stale'])
  })

  it('a zero budget clears everything outside the grace window', () => {
    const rows = [row('a', 1, OLD), row('b', 1, NOW)]
    expect(selectPrunable(rows, 0, NOW).map((r) => r.rel_path)).toEqual(['a'])
  })
})
