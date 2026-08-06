import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { router, type Href } from 'expo-router'
import { Platform } from 'react-native'
import {
  ANDROID_CHANNEL_ID,
  DEEPLINK_SCHEME,
  PUSH_WIRE_VERSION,
  isAllowedDeeplink,
  parseNotification,
  type RegisterPushFrame
} from '@/lib/tunnel/protocol'
import { toHex } from '@/lib/tunnel/pairing'
import type { Tunnel } from '@/lib/tunnel/tunnel'

/**
 * Model-initiated notifications, phone side.
 *
 * Two delivery paths land here and the user must never see the same
 * notification twice:
 *
 * - IN-BAND: the relay sends a `notification` control frame over the live
 *   tunnel; we render it locally and answer `notification_ack`. If our ack
 *   is not back at the relay within ~2 s it ALSO sends the Expo push, so…
 * - PUSH: …a remote push can arrive for a notification already rendered.
 *   The persisted `seen` LRU below is what folds the two into one: in-band
 *   renders mark the id seen, and the foreground handler refuses to show a
 *   remote push whose id it already knows. (A push arriving while the app
 *   is closed is displayed by the OS before we run — unavoidable, and only
 *   reachable when the tunnel died mid-ack, since a *live* tunnel is what
 *   makes the relay try in-band first.)
 *
 * Nothing here sends notifications. The phone registers where it can be
 * reached and renders what arrives; whether anything is sent at all is the
 * desktop model's deliberate tool call, rate-limited over there.
 */

/** Stable device id — THE phoneId push registrations are keyed by. Minted
 *  once, kept in the OS keystore, deliberately random: it must not be
 *  derivable from (or leak) the tunnel identity key the relay never sees. */
const KEY_DEVICE_ID = 'wolffish.tunnel.deviceId'

/** Persisted ids of notifications this device already rendered. */
const KEY_SEEN = 'wolffish.notifications.seen.v1'
const SEEN_LIMIT = 200

let cachedPhoneId: string | null = null

export async function getPhoneId(): Promise<string> {
  if (cachedPhoneId) return cachedPhoneId
  try {
    const stored = await SecureStore.getItemAsync(KEY_DEVICE_ID)
    if (stored && /^[a-f0-9]{32}$/.test(stored)) {
      cachedPhoneId = stored
      return stored
    }
  } catch {
    // fall through to minting — worst case we mint again next launch
  }
  const minted = toHex(crypto.getRandomValues(new Uint8Array(16)))
  cachedPhoneId = minted
  try {
    await SecureStore.setItemAsync(KEY_DEVICE_ID, minted, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    })
  } catch {
    // keystore refused — the in-memory id still keys this session consistently
  }
  return minted
}

// ------------------------------------------------------------------ dedupe

/** In-memory mirror of the persisted LRU; loaded once per launch. */
let seenOrder: string[] = []
let seenSet = new Set<string>()
let seenLoaded: Promise<void> | null = null

function loadSeen(): Promise<void> {
  if (seenLoaded) return seenLoaded
  seenLoaded = AsyncStorage.getItem(KEY_SEEN)
    .then((raw) => {
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) {
        seenOrder = parsed.filter((id): id is string => typeof id === 'string').slice(-SEEN_LIMIT)
        seenSet = new Set(seenOrder)
      }
    })
    .catch(() => undefined)
  return seenLoaded
}

async function hasSeen(notificationId: string): Promise<boolean> {
  await loadSeen()
  return seenSet.has(notificationId)
}

async function markSeen(notificationId: string): Promise<void> {
  await loadSeen()
  if (seenSet.has(notificationId)) return
  seenSet.add(notificationId)
  seenOrder.push(notificationId)
  while (seenOrder.length > SEEN_LIMIT) {
    const evicted = seenOrder.shift()
    if (evicted) seenSet.delete(evicted)
  }
  AsyncStorage.setItem(KEY_SEEN, JSON.stringify(seenOrder)).catch(() => undefined)
}

// ------------------------------------------------------- foreground display

let handlerInstalled = false

/**
 * Without a handler, notifications arriving while the app is OPEN are
 * silently swallowed. With it, they banner like they would from the lock
 * screen — except a remote push whose id we already rendered in-band, which
 * is suppressed (our own local renders carry `inband: true` and were deduped
 * before scheduling).
 */
function installForegroundHandler(): void {
  if (handlerInstalled) return
  handlerInstalled = true
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined
      const id = typeof data?.notificationId === 'string' ? data.notificationId : null
      const duplicate = data?.inband !== true && id !== null && (await hasSeen(id))
      if (id && !duplicate) void markSeen(id)
      return {
        shouldShowBanner: !duplicate,
        shouldShowList: !duplicate,
        shouldPlaySound: !duplicate,
        shouldSetBadge: false
      }
    }
  })
}

// ------------------------------------------------------------ tap handling

/** Responses already routed, by notification request identifier — the
 *  cold-start probe can replay the same response the listener already saw. */
const routedResponses = new Set<string>()

function routeResponse(response: Notifications.NotificationResponse | null): void {
  if (!response) return
  const requestId = response.notification.request.identifier
  if (routedResponses.has(requestId)) return
  routedResponses.add(requestId)
  const data = response.notification.request.content.data as Record<string, unknown> | undefined
  const url = data?.url
  // The allowlist is the whole security story here: notification payloads
  // are data, and only the app's own scheme may steer navigation.
  if (!isAllowedDeeplink(url)) return
  // Navigate IN-APP: `wolffish://chat?id=X` is the expo-router path
  // `/chat?id=X`, `wolffish://settings/model` is `/settings/model`, and so
  // on — the desktop composes deeplinks to match this app's own routes. A
  // push keeps whatever screen the user was on underneath (back returns to
  // it); an unknown path lands on the router's not-found screen, which is
  // the honest answer for a link from a newer desktop. The OS round trip
  // (Linking.openURL) stays as the fallback only for a router not ready to
  // navigate yet — a cold start racing the first mount.
  const path = `/${url.slice(DEEPLINK_SCHEME.length)}` as Href
  try {
    router.push(path)
  } catch {
    Linking.openURL(url).catch(() => undefined)
  }
}

// ----------------------------------------------------------- registration

/** The tunnel push frames ride on — whichever connection is current. */
let activeTunnel: Tunnel | null = null

let listenersInstalled = false

/**
 * One-time app-level setup: foreground display, tap routing (warm and cold
 * start), and re-registration when the platform rotates the push token.
 * Call once from the root layout; safe to call again.
 */
export function initNotifications(): void {
  installForegroundHandler()
  if (listenersInstalled) return
  listenersInstalled = true
  Notifications.addNotificationResponseReceivedListener((response) => routeResponse(response))
  // Cold start: the tap that launched the app fired before any listener
  // existed. The routed-set keeps this from double-routing a warm tap.
  Notifications.getLastNotificationResponseAsync()
    .then((response) => routeResponse(response))
    .catch(() => undefined)
  // Token rotation — rare, silent, and fatal to push delivery if missed.
  Notifications.addPushTokenListener(() => {
    void refreshPushRegistration()
  })
}

/**
 * Wire one tunnel's control frames: render in-band notifications locally and
 * ack them. Called for every tunnel the client builds (handlers are per
 * tunnel instance); also remembers the tunnel for later registrations.
 */
export function attachNotificationHandlers(tunnel: Tunnel): void {
  activeTunnel = tunnel
  tunnel.onControl('notification', (raw) => {
    void (async () => {
      const frame = parseNotification(raw)
      if (!frame) return // malformed or from-the-future — ignored, not acked
      const duplicate = await hasSeen(frame.notificationId)
      if (!duplicate) {
        await markSeen(frame.notificationId)
        await Notifications.scheduleNotificationAsync({
          content: {
            title: frame.title,
            body: frame.body,
            sound: 'default',
            data: {
              notificationId: frame.notificationId,
              runId: frame.runId,
              phase: frame.phase,
              url: frame.deeplink,
              // Marks our own local render so the foreground handler shows it
              // instead of treating it as a duplicate of itself.
              inband: true
            }
          },
          trigger: null
        }).catch(() => undefined)
      }
      // Ack even a duplicate: the relay is holding a fallback timer for this
      // id, and the ack is what tells it the phone has the notification.
      try {
        tunnel.sendControl({
          v: PUSH_WIRE_VERSION,
          type: 'notification_ack',
          notificationId: frame.notificationId
        })
      } catch {
        // Socket died between delivery and ack — the relay's fallback push
        // fires and the seen-set above is what keeps it invisible.
      }
    })()
  })
}

/**
 * Acquire the Expo push token (null when permission is denied, when this is
 * a simulator, or when anything in the chain fails — a phone that cannot be
 * pushed still registers, and delivery degrades to in-band only).
 */
async function acquireExpoPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null
    // The channel must exist BEFORE any token work on Android; HIGH matches
    // the urgency the relay sends and must keep the exact id it names.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Agent runs',
        importance: Notifications.AndroidImportance.HIGH
      })
    }
    let settings = await Notifications.getPermissionsAsync()
    if (!settings.granted && settings.canAskAgain) {
      settings = await Notifications.requestPermissionsAsync()
    }
    if (!settings.granted) return null
    const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId
    if (typeof projectId !== 'string' || !projectId) return null
    // The projectId argument is mandatory in EAS builds.
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
    return typeof data === 'string' && data ? data : null
  } catch {
    return null
  }
}

/** Serialize registrations — foreground + connect can race each other. */
let registering: Promise<void> | null = null

/**
 * Send `register_push` for this device over the current tunnel: on pairing,
 * on every foreground, and on token rotation. Always upserts the same
 * phoneId; a null token is a valid registration (permission denied). Never
 * throws — a failed registration must not disturb pairing or startup.
 */
export function refreshPushRegistration(): Promise<void> {
  if (registering) return registering
  registering = (async () => {
    try {
      const tunnel = activeTunnel
      if (!tunnel) return
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') return
      const frame: RegisterPushFrame = {
        v: PUSH_WIRE_VERSION,
        type: 'register_push',
        phoneId: await getPhoneId(),
        expoPushToken: await acquireExpoPushToken(),
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? null
      }
      // Re-read: the tunnel may have been replaced while we awaited the
      // token; register on whichever connection is current now.
      ;(activeTunnel ?? tunnel).sendControl(frame)
    } catch {
      // No socket right now — the next foreground/connect registers again.
    } finally {
      registering = null
    }
  })()
  return registering
}
