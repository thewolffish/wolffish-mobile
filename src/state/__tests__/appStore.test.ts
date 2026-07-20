jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAppStore, whenHydrated } from '@/state/appStore'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({ theme: 'system', locale: null })
    ;(AsyncStorage.setItem as jest.Mock).mockClear()
  })

  it('starts with system theme and no explicit locale', () => {
    expect(useAppStore.getState().theme).toBe('system')
    expect(useAppStore.getState().locale).toBeNull()
  })

  it('hydrates from storage', async () => {
    await expect(whenHydrated()).resolves.toBeUndefined()
  })

  it('updates theme synchronously', () => {
    useAppStore.getState().setTheme('dark')
    expect(useAppStore.getState().theme).toBe('dark')
  })

  it('updates locale synchronously', () => {
    useAppStore.getState().setLocale('ar')
    expect(useAppStore.getState().locale).toBe('ar')
  })

  it('persists only the data slice under the wolffish.app key', async () => {
    useAppStore.getState().setTheme('light')
    await flush()
    const calls = (AsyncStorage.setItem as jest.Mock).mock.calls.filter(
      ([key]) => key === 'wolffish.app'
    )
    expect(calls.length).toBeGreaterThan(0)
    const lastPayload = JSON.parse(calls[calls.length - 1][1] as string) as {
      state: Record<string, unknown>
    }
    expect(lastPayload.state).toEqual({ theme: 'light', locale: null })
    // Functions (setters) must never be serialized.
    expect(Object.keys(lastPayload.state)).toEqual(['theme', 'locale'])
  })
})
