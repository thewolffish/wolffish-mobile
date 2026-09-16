jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

/**
 * The notification log, and the one thing about it that is not cosmetic: the
 * badge.
 *
 * Unread here and the number on the app icon are the SAME fact seen from two
 * ends, so every action on this page has to move both — by exactly one, and
 * only for a notification that actually put a one there. Two stores keep that
 * honest between them (`counted` per record, buckets per conversation), and
 * both ways of getting it wrong are silent: discount a notification that never
 * counted and the icon falls below what is really unread; forget to discount
 * one that did and the icon keeps counting something the user has read.
 *
 * The dedupe is the other invariant worth pinning. Four arrival paths can see
 * one notification — the in-band frame, the foreground push, the tray sweep,
 * the tap — and the page must list it once.
 */

import { badgeTotal, useBadges } from '@/state/badges'
import {
  useNotifications,
  unreadNotifications,
  type NotificationArrival
} from '@/state/notifications'

const NOW = Date.now()

function arrival(id: string, over: Partial<NotificationArrival> = {}): NotificationArrival {
  return {
    id,
    title: `Run ${id}`,
    body: 'Your migration completed without errors.',
    at: NOW - 60_000,
    conversationId: 'conv-a',
    deeplink: 'wolffish://chat?id=conv-a',
    phase: 'completed',
    counted: true,
    ...over
  }
}

/** Arrive a notification the way push.ts does: the badge counts it, then the
 *  log records what the badge answered. */
function deliver(id: string, over: Partial<NotificationArrival> = {}): void {
  const next = arrival(id, over)
  const counted = next.conversationId
    ? useBadges.getState().count(id, next.conversationId) && next.counted
    : false
  useNotifications.getState().record({ ...next, counted })
}

beforeEach(() => {
  useNotifications.setState({ items: [] })
  useBadges.setState({ counts: {}, counted: [] })
})

describe('the log', () => {
  it('holds one record per notification however many paths see it', () => {
    deliver('n1')
    // The same notification again — a push landing on an id the in-band frame
    // already rendered. Both stores must shrug.
    useNotifications.getState().record(arrival('n1', { title: 'Run n1 (again)' }))
    useNotifications.getState().record(arrival('n1'))

    expect(useNotifications.getState().items).toHaveLength(1)
    expect(useNotifications.getState().items[0].title).toBe('Run n1')
    expect(badgeTotal(useBadges.getState())).toBe(1)
  })

  it('keeps the newest first, whatever order the paths hand them over', () => {
    deliver('old', { at: NOW - 3 * 3_600_000 })
    deliver('new', { at: NOW - 60_000 })
    deliver('middle', { at: NOW - 3_600_000 })

    expect(useNotifications.getState().items.map((record) => record.id)).toEqual([
      'new',
      'middle',
      'old'
    ])
  })

  it('records a tapped notification as already read, holding no badge', () => {
    useNotifications.getState().record(arrival('n1', { read: true, counted: false }))

    const [record] = useNotifications.getState().items
    expect(record.read).toBe(true)
    expect(record.counted).toBe(false)
    expect(unreadNotifications(useNotifications.getState())).toBe(0)
  })
})

describe('marking one read', () => {
  it('takes exactly one off the conversation it came from', () => {
    deliver('n1')
    deliver('n2')
    expect(useBadges.getState().counts['conv-a'].n).toBe(2)

    useNotifications.getState().markRead('n1')

    expect(useBadges.getState().counts['conv-a'].n).toBe(1)
    expect(badgeTotal(useBadges.getState())).toBe(1)
    expect(unreadNotifications(useNotifications.getState())).toBe(1)
  })

  it('empties the bucket rather than leaving a zero behind', () => {
    deliver('n1')
    useNotifications.getState().markRead('n1')

    expect(useBadges.getState().counts['conv-a']).toBeUndefined()
    expect(badgeTotal(useBadges.getState())).toBe(0)
  })

  it('is idempotent — a second read cannot take a second one off', () => {
    deliver('n1')
    deliver('n2')
    useNotifications.getState().markRead('n1')
    useNotifications.getState().markRead('n1')

    expect(useBadges.getState().counts['conv-a'].n).toBe(1)
  })

  it('takes nothing off for a notification that never counted', () => {
    // Arrived while its own conversation was on screen: push.ts markHandled it
    // and nothing went into the bucket. It is still unread on the page — the
    // user may not have looked — and reading it must not move a number it
    // never added to.
    deliver('n1')
    useNotifications.getState().record(arrival('n2', { counted: false }))
    expect(useBadges.getState().counts['conv-a'].n).toBe(1)

    useNotifications.getState().markRead('n2')

    expect(useBadges.getState().counts['conv-a'].n).toBe(1)
  })

  it('leaves a general notification with no conversation to discount', () => {
    useNotifications.getState().record(
      arrival('n1', {
        conversationId: null,
        deeplink: 'wolffish://settings/model',
        counted: false
      })
    )

    useNotifications.getState().markRead('n1')

    expect(useNotifications.getState().items[0].read).toBe(true)
    expect(badgeTotal(useBadges.getState())).toBe(0)
  })
})

describe('archiving', () => {
  it('reads at the same time, and leaves the inbox', () => {
    deliver('n1')

    useNotifications.getState().archive('n1')

    const [record] = useNotifications.getState().items
    expect(record).toMatchObject({ archived: true, read: true, counted: false })
    expect(badgeTotal(useBadges.getState())).toBe(0)
  })

  it('does not double-discount one that was already read', () => {
    deliver('n1')
    deliver('n2')
    useNotifications.getState().markRead('n1')

    useNotifications.getState().archive('n1')

    expect(useBadges.getState().counts['conv-a'].n).toBe(1)
  })
})

describe('the two bulk buttons', () => {
  it('mark-all-read clears every unread, and every badge they held', () => {
    deliver('n1')
    deliver('n2', { conversationId: 'conv-b', deeplink: 'wolffish://chat?id=conv-b' })
    expect(badgeTotal(useBadges.getState())).toBe(2)

    useNotifications.getState().markAllRead()

    expect(unreadNotifications(useNotifications.getState())).toBe(0)
    expect(badgeTotal(useBadges.getState())).toBe(0)
    // Read, not filed: they stay in the inbox.
    expect(useNotifications.getState().items.every((record) => !record.archived)).toBe(true)
  })

  it('archive-all empties the inbox and reads it on the way', () => {
    deliver('n1')
    deliver('n2', { conversationId: 'conv-b', deeplink: 'wolffish://chat?id=conv-b' })

    useNotifications.getState().archiveAll()

    expect(
      useNotifications.getState().items.every((record) => record.archived && record.read)
    ).toBe(true)
    expect(badgeTotal(useBadges.getState())).toBe(0)
  })

  it('leaves the archive alone — it is finished, not a second inbox', () => {
    deliver('n1')
    useNotifications.getState().archive('n1')
    deliver('n2')

    useNotifications.getState().archiveAll()

    const archived = useNotifications.getState().items.filter((record) => record.archived)
    expect(archived).toHaveLength(2)
    expect(badgeTotal(useBadges.getState())).toBe(0)
  })
})

describe('opening the conversation itself', () => {
  it('reads its notifications without discounting anything', () => {
    deliver('n1')
    deliver('n2')
    deliver('other', { conversationId: 'conv-b', deeplink: 'wolffish://chat?id=conv-b' })

    // What clearConversationBadges does, in its order: the whole bucket goes,
    // then the log is brought into line. A per-record discount on top of that
    // would come out of conv-b.
    useBadges.getState().clearConversation('conv-a')
    useNotifications.getState().markConversationRead('conv-a')

    expect(useBadges.getState().counts['conv-a']).toBeUndefined()
    expect(useBadges.getState().counts['conv-b'].n).toBe(1)
    expect(unreadNotifications(useNotifications.getState())).toBe(1)
  })
})
