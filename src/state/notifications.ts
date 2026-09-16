import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { NotifyPhase } from '@/lib/tunnel/protocol'
import { useBadges } from '@/state/badges'

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
 * TWO INDEPENDENT FLAGS, deliberately:
 *
 *  - `read` is about this list. It starts false for everything except a
 *    tapped notification (the tap IS the answer to it), and the user turns it
 *    true from the notifications page or by opening the conversation.
 *  - `archived` is about the inbox. Archiving also reads, never the reverse,
 *    so an archived notification is always read and the archive tab is a
 *    finished pile rather than a second inbox.
 *
 * `counted` is neither: it records whether THIS notification put a number in
 * a conversation's badge bucket, and it is the whole reason marking one read
 * can take that badge down by exactly one. push.ts decides it (it knows the
 * deeplink, the conversation on screen and the app state) and the badge store
 * confirms it — a notification the badge store deduped away counts nothing,
 * and discounting for it would take the badge below what is really unread.
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
  /** Still contributing one to `conversationId`'s badge bucket. */
  counted: boolean
}

/** What an arrival knows about itself. */
export type NotificationArrival = Omit<NotificationRecord, 'read' | 'archived'> & {
  /** A tap arrives already answered; everything else arrives unread. */
  read?: boolean
}

/**
 * How many records the log keeps, newest first. Each is a couple of hundred
 * bytes, so the whole store stays well under a hundred kilobytes — small
 * enough for one AsyncStorage value on both platforms, and far more history
 * than a phone notification list is ever read back through.
 */
const LIMIT = 300

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
  /**
   * The user OPENED the conversation, so everything it ever notified about is
   * answered. Reads without discounting: the caller (clearConversationBadges)
   * empties the whole bucket itself, and discounting on top of that would take
   * other conversations' numbers down with it.
   */
  markConversationRead: (conversationId: string) => void
  /** Unpairing or a demo purge — the log describes conversations that are
   *  about to stop existing. */
  clear: () => void
}

/** Newest first, and stable for equal stamps (a reconciliation sweep can hand
 *  over several notifications carrying the same tray second). */
function ordered(items: NotificationRecord[]): NotificationRecord[] {
  return [...items].sort((a, b) => b.at - a.at).slice(0, LIMIT)
}

/**
 * Flip `read` on the records a bulk action names, and hand back the badge
 * discounts that owes — one entry per record that was still counted. The
 * caller applies them, so the badge store is touched exactly once per action
 * rather than once per record.
 */
function settle(
  items: NotificationRecord[],
  matches: (record: NotificationRecord) => boolean,
  archive: boolean
): { items: NotificationRecord[]; discounts: string[] } {
  const discounts: string[] = []
  let changed = false
  const next = items.map((record) => {
    if (!matches(record)) return record
    if (record.read && record.counted === false && (!archive || record.archived)) return record
    if (record.counted && record.conversationId) discounts.push(record.conversationId)
    changed = true
    return {
      ...record,
      read: true,
      counted: false,
      archived: archive ? true : record.archived
    }
  })
  return { items: changed ? next : items, discounts }
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
          items: ordered([
            {
              ...arrival,
              read: arrival.read === true,
              archived: false,
              // A tap answers the notification, so it stops holding a badge —
              // push.ts has already told the badge store the same thing.
              counted: arrival.read === true ? false : arrival.counted
            },
            ...items
          ])
        })
      },
      markRead: (id) => {
        const { items, discounts } = settle(get().items, (record) => record.id === id, false)
        if (items === get().items) return
        set({ items })
        for (const conversationId of discounts) useBadges.getState().discount(conversationId)
      },
      archive: (id) => {
        const { items, discounts } = settle(get().items, (record) => record.id === id, true)
        if (items === get().items) return
        set({ items })
        for (const conversationId of discounts) useBadges.getState().discount(conversationId)
      },
      markAllRead: () => {
        const { items, discounts } = settle(get().items, (record) => !record.archived, false)
        if (items === get().items) return
        set({ items })
        for (const conversationId of discounts) useBadges.getState().discount(conversationId)
      },
      archiveAll: () => {
        const { items, discounts } = settle(get().items, (record) => !record.archived, true)
        if (items === get().items) return
        set({ items })
        for (const conversationId of discounts) useBadges.getState().discount(conversationId)
      },
      markConversationRead: (conversationId) => {
        const { items } = get()
        let changed = false
        const next = items.map((record) => {
          if (record.conversationId !== conversationId) return record
          if (record.read && !record.counted) return record
          changed = true
          return { ...record, read: true, counted: false }
        })
        if (!changed) return
        set({ items: next })
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

/** The number the side sheet's Notifications row carries. Archived records
 *  are read by construction, so this is the inbox's unread count. */
export function unreadNotifications(state: Pick<NotificationsState, 'items'>): number {
  let total = 0
  for (const record of state.items) if (!record.read) total += 1
  return total
}
