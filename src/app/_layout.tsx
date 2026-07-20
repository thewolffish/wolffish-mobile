if (__DEV__) {
  // Initialize Reactotron before anything else in development.
  require('../ReactotronConfig')
}

import '../global.css'
import '@/lib/i18n'

import { ToastProvider } from '@/providers/toast/ToastProvider'
import { LocaleProvider } from '@/providers/locale/LocaleProvider'
import { ThemeProvider } from '@/providers/theme/ThemeProvider'
import { useTheme, useTokens } from '@/providers/theme/useTheme'
import { asyncStoragePersister, PERSIST_MAX_AGE_MS, queryClient } from '@/lib/query/queryClient'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'

SplashScreen.preventAutoHideAsync()

function AppShell(): React.JSX.Element {
  const { isDark } = useTheme()
  const tokens = useTokens()

  useEffect(() => {
    // Providers gate rendering until theme + locale are restored, so the
    // first frame here is already correct — safe to reveal.
    void SplashScreen.hideAsync()
  }, [])

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.bg }
        }}
      />
    </>
  )
}

export default function RootLayout(): React.JSX.Element {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister, maxAge: PERSIST_MAX_AGE_MS }}
    >
      <ThemeProvider>
        <LocaleProvider>
          <ToastProvider>
            <AppShell />
          </ToastProvider>
        </LocaleProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  )
}
