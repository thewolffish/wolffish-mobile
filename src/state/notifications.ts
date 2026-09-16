import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { NotifyPhase } from '@/lib/tunnel/protocol'

/**
 * The notification log — every model-initiated notification this phone has
 * rendered, kept so the user can read them again on their own screen instead
 * of only in the split second the OS banner is up.
 *
 * WHY THE PHONE HAS TO KEEP THIS ITSELF. Nothing upstream holds a history to
 * fetch: the desktop mints a notification and fires it, the relay routes it
 * and remembers only an idempotency marker, and the OS tray forgets whatever
 * the user swipes away. So the log is written at ARRIVAL, by every path in
 * lib/notifications/push.ts that renders one — the in-band frame, the
 * foreground push, the tray reconciliation that catches what landed while the
 * app was dead, and the tap that opens the app. Records are keyed by
 * notificationId and the first write wins, which is what lets all four paths
 * see the same notification without it appearing four times.
 *
 * The one thing it CANNOT recover is a push that arrived while the app was
 * dead and was dismissed from the tray before the app next opened: nothing of
 * ours ran, and nothing anywhere else kept it.
 *
 * THIS LOG IS ALSO THE BADGES. Every unread count in the app is derived from
 * the records below — the number on a conversation row, the total on the app
 * icon, the count the relay stamps onto pushes, and the one on the sheet's
 * Notifications row. It did not used to be: a separate store kept a counter
 * per conversation, incremented at arrival and decremented on read, and two
 * counters for one fact drift the moment any arrival path treats them
 * differently. A notification that reached the log without incrementing the
 * counter — one that arrived while its own conversation was on screen — left
 * the page saying two unread and the conversation row saying one. Derived,
 * that disagreement cannot be expressed.
 *
 * THREE FLAGS, and they are not the same question:
 *
 *  - `read` is about attention. It starts false except on a tap (the tap IS
 *    the answer) and on a notification that arrives for the conversation the
 *    user is already looking at — which is the same answer, a beat earlier.
 *  - `archived` is about the inbox. One-way, and archiving reads at the same
 *    time, so an archived notification is always read and the archive tab is
 *    a finished pile rather than a second inbox.
 *  - `counted` is about the badge, and it is a STANDING property of the
 *    notification rather than a record of something that already happened: is
 *    this one the sort that puts a number on its conversation? True for every
 *    real arrival that names a conversation. False only for the demo's seeded
 *    log, which must show its count on the sheet's Notifications row without
 *    marking conversation rows or the app icon — a demo has no relay, and a
 *    badge it minted would be a number the tour cannot honestly clear.
 */

export type NotificationRecord = {
  /** The desktop-minted ULID. Unique per notification, across both paths. */
  id: string
  title: string
  body: string
  /** When the DESKTOP sent it where that is known (the frame's `ts`, and the
   *  same value echoed in the push payload), else when this phone rendered
   *  it. Both are stamped at arrival; neither moves afterwards. */
  at: number
  /** The conversation the deeplink names, or null for a general one. */
  conversationId: string | null
  /** Exactly the link the desktop sent, so a tap here goes where the tap on
   *  the banner would have gone — including the settings routes. */
  deeplink: string | null
  phase: NotifyPhase
  read: boolean
  archived: boolean
  /** Whether this one badges its conversation while unread. See the header. */
  counted: boolean
}

/** What an arrival knows about itself. */
export type NotificationArrival = Omit<NotificationRecord, 'read' | 'archived'> & {
  /** A tap, or a notification for the conversation already on screen: both
   *  arrive answered. Everything else arrives unread. */
  read?: boolean
}

/**
 * How many records the log keeps, newest first. Each is a couple of hundred
 * bytes, so the whole store stays well under a hundred kilobytes — small
 * enough for one AsyncStorage value on both platforms, and far more history
 * than a phone notification list is ever read back through.
 */
const LIMIT = 300

/** A conversation's badge can never grow past this; the relay clamps to the
 *  same ceiling, so the two ends agree about what "a lot" looks like. */
const BADGE_MAX = 999

export type NotificationsState = {
  /** Newest first. */
  items: NotificationRecord[]
  /** Record an arrival. Idempotent by id — a repeat only ever marks read. */
  record: (arrival: NotificationArrival) => void
  /** The user answered one notification: read, and its badge goes with it. */
  markRead: (id: string) => void
  /** Archive one. Reads it at the same time — archived is always read. */
  archive: (id: string) => void
  /** The inbox button: every unarchived notification read at once. */
  markAllRead: () => void
  /** The inbox button: every unarchived notification archived (and read). */
  archiveAll: () => void
  /** The user OPENED (or deleted) the conversation, so everything it ever
   *  notified about is answered. */
  markConversationRead: (conversationId: string) => void
  /**
   * Read the notifications of conversations the desktop no longer has.
   * `liveIds` is the full id list from a completed index sync and `before` is
   * when that sync STARTED — a notification that arrived after the list was
   * taken is spared, because its conversation may simply be newer than the
   * list. Read rather than deleted: the text is still worth having, it just
   * stops badging a row that no longer exists.
   */
  prune: (liveIds: readonly string[], before: number) => void
  /** Unpairing or a demo purge — the log describes conversations that are
   *  about to stop existing. */
  clear: () => void
}

/** Newest first, and capped. */
function ordered(items: NotificationRecord[]): NotificationRecord[] {
  return [...items].sort((a, b) => b.at - a.at).slice(0, LIMIT)
}

/**
 * Flip `read` — and optionally `archived` — on the records an action names.
 * Returns the same array reference when nothing changed, which is what lets
 * every caller no-op without comparing contents.
 */
function settle(
  items: NotificationRecord[],
  matches: (record: NotificationRecord) => boolean,
  archive: boolean
): NotificationRecord[] {
  let changed = false
  const next = items.map((record) => {
    if (!matches(record)) return record
    if (record.read && (!archive || record.archived)) return record
    changed = true
    return { ...record, read: true, archived: archive ? true : record.archived }
  })
  return changed ? next : items
}

export const useNotifications = create<NotificationsState>()(
  persist(
    (set, get) => ({
      items: [],
      record: (arrival) => {
        const { items } = get()
        const existing = items.find((record) => record.id === arrival.id)
        if (existing) {
          // A second sighting of a notification already logged. The only thing
          // it can still tell us is that the user has now answered it — a tap
          // on a banner whose notification the in-band path logged minutes
          // ago. Content never changes; re-reading it would resurrect a record
          // the user has since read or archived.
          if (arrival.read && !existing.read) get().markRead(arrival.id)
          return
        }
        set({
          items: ordered([{ ...arrival, read: arrival.read === true, archived: false }, ...items])
        })
      },
      markRead: (id) => {
        const items = settle(get().items, (record) => record.id === id, false)
        if (items === get().items) return
        set({ items })
      },
      archive: (id) => {
        const items = settle(get().items, (record) => record.id === id, true)
        if (items === get().items) return
        set({ items })
      },
      markAllRead: () => {
        const items = settle(get().items, (record) => !record.archived, false)
        if (items === get().items) return
        set({ items })
      },
      archiveAll: () => {
        const items = settle(get().items, (record) => !record.archived, true)
        if (items === get().items) return
        set({ items })
      },
      markConversationRead: (conversationId) => {
        const items = settle(
          get().items,
          (record) => record.conversationId === conversationId,
          false
        )
        if (items === get().items) return
        set({ items })
      },
      prune: (liveIds, before) => {
        const live = new Set(liveIds)
        const items = settle(
          get().items,
          (record) =>
            record.conversationId !== null &&
            !live.has(record.conversationId) &&
            record.at < before,
          false
        )
        if (items === get().items) return
        set({ items })
      },
      clear: () => {
        if (get().items.length === 0) return
        set({ items: [] })
      }
    }),
    {
      name: 'wolffish.notifications',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state) => ({ items: state.items })
    }
  )
)

/** Unread notifications for one conversation — the number its row wears. */
export function unreadFor(
  state: Pick<NotificationsState, 'items'>,
  conversationId: string
): number {
  let total = 0
  for (const record of state.items) {
    if (record.read || !record.counted) continue
    if (record.conversationId === conversationId) total += 1
  }
  return Math.min(BADGE_MAX, total)
}

/**
 * The number the app icon and the relay carry. Conversation-linked only, as
 * it has always been: a general notification — one that deep-links to a
 * settings page or nowhere — is cleared by the app opening, and the icon is
 * only ever read while the app is away. It still shows on the notifications
 * page and in the count below, which is where it can actually be answered.
 */
export function badgeTotal(state: Pick<NotificationsState, 'items'>): number {
  let total = 0
  for (const record of state.items) {
    if (record.read || !record.counted || record.conversationId === null) continue
    total += 1
  }
  return Math.min(BADGE_MAX, total)
}

/** The number the side sheet's Notifications row carries: everything unread,
 *  general notifications included — the page can answer those. Archived
 *  records are read by construction, so they never reach this. */
export function unreadNotifications(state: Pick<NotificationsState, 'items'>): number {
  let total = 0
  for (const record of state.items) if (!record.read) total += 1
  return total
}

/** Resolves once the persisted log is restored — counting before that would
 *  be overwritten by the rehydrate. */
export function whenNotificationsHydrated(): Promise<void> {
  if (useNotifications.persist.hasHydrated()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsub = useNotifications.persist.onFinishHydration(() => {
      unsub()
      resolve()
    })
  })
}
