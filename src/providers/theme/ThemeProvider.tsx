import { useAppStore, whenHydrated } from '@/state/appStore'
import { ThemeContext, type ThemeSource } from '@/providers/theme/useTheme'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { colorScheme as nativewindScheme, useColorScheme } from 'nativewind'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'

// Pre-store persistence key — migrated into the zustand store on first run.
const LEGACY_KEY = 'wolffish.theme'

function isThemeSource(value: unknown): value is ThemeSource {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const theme = useAppStore((s) => s.theme)
  const setThemeState = useAppStore((s) => s.setTheme)
  const [ready, setReady] = useState<boolean>(false)
  // Resolved scheme after NativeWind applies the source ('system' follows
  // the OS appearance live).
  const { colorScheme } = useColorScheme()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      await whenHydrated()
      const legacy = await AsyncStorage.getItem(LEGACY_KEY)
      if (cancelled) return
      if (isThemeSource(legacy)) {
        useAppStore.getState().setTheme(legacy)
        void AsyncStorage.removeItem(LEGACY_KEY)
      }
      nativewindScheme.set(useAppStore.getState().theme)
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const setTheme = useCallback(
    async (source: ThemeSource) => {
      nativewindScheme.set(source)
      setThemeState(source)
    },
    [setThemeState]
  )

  if (!ready) return <View className="bg-bg h-full w-full" />

  return (
    <ThemeContext.Provider value={{ theme, isDark: colorScheme === 'dark', setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
