import { groupConversations } from '@/lib/conversations/grouping'
import type { ConversationMeta } from '@/lib/conversations/types'

function meta(id: string, updatedAt: number): ConversationMeta {
  return { id, title: id, updatedAt, createdAt: updatedAt, messageCount: 1 }
}

/** 2026-07-27 14:30 local — a Monday, mid-afternoon so "today" has room. */
const NOW = new Date(2026, 6, 27, 14, 30).getTime()

function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m, d, h).getTime()
}

function keysOf(metas: ConversationMeta[]): string[] {
  return groupConversations(metas, NOW).map((g) => g.key)
}

describe('groupConversations', () => {
  it('cuts at local midnight, not on a rolling 24 hours', () => {
    // 11:59pm last night is Yesterday even though it is under a day old; this
    // morning's 00:01 is Today even though it is nearly 14 hours old.
    expect(
      keysOf([meta('a', at(2026, 6, 27, 0) + 60_000), meta('b', at(2026, 6, 26, 23))])
    ).toEqual(['today', 'yesterday'])
  })

  it('walks the full ladder, newest first, dropping empty buckets', () => {
    const groups = groupConversations(
      [
        meta('today', NOW - 60_000),
        meta('yesterday', at(2026, 6, 26)),
        meta('last7', at(2026, 6, 23)),
        // No last30 conversation — its header must not appear.
        meta('last3m', at(2026, 5, 1)),
        meta('last6m', at(2026, 2, 1)),
        meta('lastYear', at(2025, 9, 1)),
        meta('older', at(2023, 0, 1))
      ],
      NOW
    )
    expect(groups.map((g) => g.key)).toEqual([
      'today',
      'yesterday',
      'last7',
      'last3m',
      'last6m',
      'lastYear',
      'older'
    ])
    expect(groups.map((g) => g.labelKey)).toEqual([
      'history.groups.today',
      'history.groups.yesterday',
      'history.groups.last7',
      'history.groups.last3m',
      'history.groups.last6m',
      'history.groups.lastYear',
      'history.groups.older'
    ])
  })

  it('numbers rows continuously across group headers', () => {
    const groups = groupConversations(
      [
        meta('t1', NOW - 1000),
        meta('t2', NOW - 2000),
        meta('y1', at(2026, 6, 26)),
        meta('o1', at(2020, 0, 1))
      ],
      NOW
    )
    expect(groups.map((g) => [g.key, g.startIndex, g.data.length])).toEqual([
      ['today', 1, 2],
      ['yesterday', 3, 1],
      ['older', 4, 1]
    ])
  })

  it('keeps every conversation and its incoming order', () => {
    const metas = [meta('a', NOW), meta('b', NOW - 1), meta('c', at(2026, 6, 26))]
    const groups = groupConversations(metas, NOW)
    expect(groups.flatMap((g) => g.data.map((m) => m.id))).toEqual(['a', 'b', 'c'])
  })

  it('clamps month steps instead of overflowing a short month', () => {
    // From Aug 31, three months back is May 31 and six is Feb 28 — a bare
    // setMonth would overflow to Mar 2/3 and mis-sort late-February rows.
    const aug31 = new Date(2026, 7, 31, 14, 0).getTime()
    expect(groupConversations([meta('feb28', at(2026, 1, 28))], aug31)[0]?.key).toBe('last6m')
    expect(groupConversations([meta('feb27', at(2026, 1, 27))], aug31)[0]?.key).toBe('lastYear')
  })

  it('returns nothing for an empty list', () => {
    expect(groupConversations([], NOW)).toEqual([])
  })
})
