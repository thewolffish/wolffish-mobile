jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('expo-device', () => ({ isDevice: true }))
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.63', extra: { eas: { projectId: 'proj' } } } }
}))
jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => 'a'.repeat(32),
  setItemAsync: async () => undefined,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlocked'
}))
jest.mock('@/lib/sync/dirty', () => ({ markConversationDirty: jest.fn() }))
jest.mock('@/lib/conversations/cache', () => ({ invalidateConversation: jest.fn() }))

let mockPresented: unknown[] = []
const mockScheduled: Record<string, unknown>[] = []
jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  addPushTokenListener: () => ({ remove: () => undefined }),
  setNotificationHandler: () => undefined,
  getLastNotificationResponse: () => null,
  clearLastNotificationResponse: () => undefined,
  setBadgeCountAsync: async () => undefined,
  dismissNotificationAsync: async () => undefined,
  getPresentedNotificationsAsync: async () => mockPresented,
  scheduleNotificationAsync: async (request: Record<string, unknown>) => {
    mockScheduled.push(request)
    return 'local-1'
  }
}))

/**
 * Where the notification LOG gets written, and the one unit conversion that
 * quietly decides whether every card on iOS is dated 1970.
 *
 * `Notification.date` is not the same quantity on the two platforms:
 * expo-notifications serializes Android's `Date.getTime()` (milliseconds) and
 * iOS's `timeIntervalSince1970` (SECONDS). Taken at face value, every iOS
 * notification the app picked up from the tray would render as "56 years ago"
 * — a whole feature that looks broken because of a factor of a thousand. The
 * fix is magnitude-based rather than platform-based, so it survives either
 * platform changing its mind, and this is what holds it.
 *
 * The other half is provenance: WHEN a notification was sent is the desktop's
 * answer, not the handset's. A phone that was off for three hours receives a
 * push three hours late, and a card dated by arrival would be three hours
 * wrong. So the desktop's `ts` rides both paths — our own in-band render
 * copies it into the local notification's data, the relay stamps it onto the
 * push payload — and it wins over the delivery date wherever it is present.
 */

import {
  attachNotificationHandlers,
  reconcilePresentedNotifications
} from '@/lib/notifications/push'
import { useBadges } from '@/state/badges'
import { useNotifications } from '@/state/notifications'

// Imported directly rather than through jest.isolateModules, unlike this
// folder's other suites: isolating push.ts re-requires the two zustand stores
// with it, so the module under test would write to a private copy of each and
// every assertion here would read an empty one. Nothing in these paths needs a
// fresh module — the state they touch is the stores, and beforeEach resets it.

const SENT = Date.UTC(2026, 8, 16, 9, 30, 0)

/** One tray entry, as the OS hands it over. `date` is in whatever unit the
 *  platform uses; `data` is the payload the relay (or our own render) set. */
function presented(
  id: string,
  date: number,
  data: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    date,
    request: {
      identifier: `req-${id}`,
      content: {
        title: 'Migration finished',
        body: 'Your migration completed without errors.',
        data: { notificationId: id, phase: 'completed', url: 'wolffish://chat?id=conv-a', ...data }
      }
    }
  }
}

function frame(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: 'notification',
    notificationId: 'n-inband',
    phoneId: 'a'.repeat(32),
    runId: 'turn_1_abc',
    phase: 'completed',
    title: 'Migration finished',
    body: 'Your migration completed without errors.',
    urgency: 'normal',
    deeplink: 'wolffish://chat?id=conv-a',
    ttl: 3600,
    ts: SENT,
    ...over
  }
}

/** Let the arrival's own awaits (the seen-LRU read, the local render) settle. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()
}

beforeEach(() => {
  mockPresented = []
  mockScheduled.length = 0
  useNotifications.setState({ items: [] })
  useBadges.setState({ counts: {}, counted: [] })
})

describe('a notification found in the tray', () => {
  it('reads an iOS seconds stamp as the millisecond date it means', async () => {
    // iOS: timeIntervalSince1970 — seconds.
    mockPresented = [presented('n1', SENT / 1000)]

    await reconcilePresentedNotifications()

    const [entry] = useNotifications.getState().items
    expect(entry.at).toBe(SENT)
    expect(new Date(entry.at).getUTCFullYear()).toBe(2026)
  })

  it('leaves an Android millisecond stamp exactly as it found it', async () => {
    mockPresented = [presented('n1', SENT)]

    await reconcilePresentedNotifications()

    expect(useNotifications.getState().items[0].at).toBe(SENT)
  })

  it('prefers the desktop’s own send time over when the handset got it', async () => {
    // Delivered three hours late — a phone that was off. The card must say
    // when the desktop SENT it.
    mockPresented = [presented('n1', SENT + 3 * 3_600_000, { ts: SENT })]

    await reconcilePresentedNotifications()

    expect(useNotifications.getState().items[0].at).toBe(SENT)
  })

  it('logs the text, the link and the badge it counted', async () => {
    mockPresented = [presented('n1', SENT)]

    await reconcilePresentedNotifications()

    expect(useNotifications.getState().items[0]).toMatchObject({
      id: 'n1',
      title: 'Migration finished',
      body: 'Your migration completed without errors.',
      conversationId: 'conv-a',
      deeplink: 'wolffish://chat?id=conv-a',
      phase: 'completed',
      read: false,
      archived: false,
      counted: true
    })
    expect(useBadges.getState().counts['conv-a'].n).toBe(1)
  })

  it('ignores a notification that is not one of ours', async () => {
    mockPresented = [{ date: SENT, request: { identifier: 'other', content: { data: {} } } }]

    await reconcilePresentedNotifications()

    expect(useNotifications.getState().items).toHaveLength(0)
  })

  it('logs a repeat sweep once — the tray keeps answering with the same entry', async () => {
    mockPresented = [presented('n1', SENT)]

    await reconcilePresentedNotifications()
    await reconcilePresentedNotifications()

    expect(useNotifications.getState().items).toHaveLength(1)
    expect(useBadges.getState().counts['conv-a'].n).toBe(1)
  })
})

describe('a notification delivered in-band', () => {
  it('carries the desktop’s send time into its own local render', async () => {
    const handlers: Record<string, (raw: Record<string, unknown>) => void> = {}
    const tunnel = {
      sendControl: jest.fn(),
      onControl: (type: string, handler: (raw: Record<string, unknown>) => void) => {
        handlers[type] = handler
      }
    }
    attachNotificationHandlers(tunnel as never)

    handlers.notification(frame())
    await settle()

    // Without this the foreground handler — which sees the local render before
    // the frame's own record() gets there — would date the card by now().
    expect(mockScheduled[0]).toMatchObject({
      content: { data: { notificationId: 'n-inband', ts: SENT, inband: true } }
    })
    expect(useNotifications.getState().items[0]).toMatchObject({
      id: 'n-inband',
      at: SENT,
      title: 'Migration finished',
      counted: true
    })
  })
})
