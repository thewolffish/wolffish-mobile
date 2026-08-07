jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

const mockRouterPush = jest.fn()
jest.mock('expo-router', () => ({ router: { push: mockRouterPush } }))

let mockLastResponse: unknown = null
const mockListeners: ((response: unknown) => void)[] = []
jest.mock('expo-notifications', () => ({
  getLastNotificationResponse: () => mockLastResponse,
  clearLastNotificationResponse: () => {
    mockLastResponse = null
  },
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    mockListeners.push(listener)
    return { remove: () => undefined }
  },
  addPushTokenListener: () => ({ remove: () => undefined }),
  setNotificationHandler: () => undefined
}))

/**
 * Where a notification tap takes the app.
 *
 * The split these pin is the whole fix: a tap on a RUNNING app navigates on
 * the spot, while the tap that STARTED the app is read by the entry screen and
 * becomes its boot destination — because that screen redirects a paired phone
 * into the app on mount, and a destination arriving a tick later used to race
 * (and lose to) that redirect. The two must never both fire for one tap.
 */
type Push = typeof import('@/lib/notifications/push')

function loadPush(): Push {
  let module!: Push
  jest.isolateModules(() => {
    module = require('@/lib/notifications/push')
  })
  return module
}

function tap(identifier: string, url: unknown): Record<string, unknown> {
  return {
    notification: { request: { identifier, content: { data: { url } } } },
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT'
  }
}

beforeEach(() => {
  mockRouterPush.mockClear()
  mockListeners.length = 0
  mockLastResponse = null
})

describe('the tap that launched the app', () => {
  it('is readable synchronously, and only once', () => {
    mockLastResponse = tap('n1', 'wolffish://chat?id=2026-08-05_10-00-00')
    const push = loadPush()

    expect(push.launchDeeplink()).toEqual({
      pathname: '/chat',
      params: { id: '2026-08-05_10-00-00' }
    })
    // Latched: a re-render of the entry screen must not get a different answer.
    expect(push.launchDeeplink()).toEqual({
      pathname: '/chat',
      params: { id: '2026-08-05_10-00-00' }
    })
    // …and nothing navigated. The entry screen redirects; this file does not.
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('does not also navigate when the listener replays it', () => {
    mockLastResponse = tap('n1', 'wolffish://chat?id=2026-08-05_10-00-00')
    const push = loadPush()
    push.launchDeeplink()

    push.initNotifications()
    mockListeners.forEach((listener) =>
      listener(tap('n1', 'wolffish://chat?id=2026-08-05_10-00-00'))
    )

    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  // The launch that never went through the entry screen — nothing has taken
  // the tap, so init routes it rather than dropping it.
  it('is still routed by init when nobody took it', () => {
    mockLastResponse = tap('n1', 'wolffish://settings/automations')
    const push = loadPush()

    push.initNotifications()

    expect(mockRouterPush).toHaveBeenCalledWith('/settings/automations')
  })

  it('is forgotten once the entry screen has had it', () => {
    mockLastResponse = tap('n1', 'wolffish://history')
    const push = loadPush()
    push.launchDeeplink()

    push.forgetLaunchDeeplink()

    expect(push.launchDeeplink()).toBeNull()
    // Cleared natively too, or the same minutes-old tap answers all session.
    expect(mockLastResponse).toBeNull()
  })
})

describe('a tap while the app is running', () => {
  it('navigates on the spot, keeping the current screen underneath', () => {
    const push = loadPush()
    push.initNotifications()

    mockListeners.forEach((listener) => listener(tap('n2', 'wolffish://settings/usage')))

    expect(mockRouterPush).toHaveBeenCalledWith('/settings/usage')
  })

  it('goes nowhere when the link names a screen this build does not have', () => {
    const push = loadPush()
    push.initNotifications()

    mockListeners.forEach((listener) => listener(tap('n3', 'wolffish://runs/1')))
    mockListeners.forEach((listener) => listener(tap('n4', 'https://evil.example/x')))
    mockListeners.forEach((listener) => listener(tap('n5', undefined)))

    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('moves the app once per tap, however many times it is delivered', () => {
    const push = loadPush()
    push.initNotifications()

    mockListeners.forEach((listener) => listener(tap('n6', 'wolffish://history')))
    mockListeners.forEach((listener) => listener(tap('n6', 'wolffish://history')))

    expect(mockRouterPush).toHaveBeenCalledTimes(1)
  })
})
