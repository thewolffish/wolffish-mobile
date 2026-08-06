if (__DEV__) {
  // Initialize Reactotron before anything else in development.
  require('@/ReactotronConfig')
}

// Must load before anything touches @noble: Hermes has no crypto.getRandomValues,
// and X25519 key generation calls it the moment a pairing starts.
import 'react-native-get-random-values'

import '../global.css'
import '@/lib/i18n'

import { ChartSnapshotHost } from '@/components/chat/ChartSnapshotHost'
import { ActiveOverlays } from '@/components/overlays/ActiveOverlays'
import { ConnectingOverlay } from '@/components/pairing/ConnectingOverlay'
import { SyncOverlay } from '@/components/pairing/SyncOverlay'
import { UpdateNotice } from '@/components/updates/UpdateNotice'
import { sweepStagedFiles } from '@/lib/files/fileCache'
import { useOtaUpdates } from '@/lib/updates/useOtaUpdates'
import { ToastProvider } from '@/providers/toast/ToastProvider'
import { LocaleProvider } from '@/providers/locale/LocaleProvider'
import { ThemeProvider } from '@/providers/theme/ThemeProvider'
import { useTheme, useTokens } from '@/providers/theme/useTheme'
import {
  asyncStoragePersister,
  PERSIST_MAX_AGE_MS,
  queryClient,
  shouldPersistQuery
} from '@/lib/query/queryClient'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { useConnection } from '@/lib/sync/useConnection'
import { initNotifications } from '@/lib/notifications/push'

SplashScreen.preventAutoHideAsync()

function AppShell(): React.JSX.Element {
  const { isDark } = useTheme()
  const tokens = useTokens()
  useOtaUpdates()
  // Restores a stored pairing at launch and on every foreground.
  useConnection()

  useEffect(() => {
    // Providers gate rendering until theme + locale are restored, so the
    // first frame here is already correct — safe to reveal.
    void SplashScreen.hideAsync()
    // Files staged for a message that was still uploading when the app died.
    // Nothing can legitimately be mid-send at launch, so anything left is
    // orphaned bytes — see fileCache STAGING_ROOT.
    sweepStagedFiles()
    // Foreground display, tap routing (warm + cold start) and token-rotation
    // re-registration for model-initiated notifications. Idempotent; without
    // the handler, notifications arriving while the app is open are silently
    // swallowed.
    initNotifications()
  }, [])

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.bg }
        }}
      >
        {/* Launching a paired phone straight into chat is a restoration, not
            a navigation: sliding in reads as the app going somewhere when it
            is only showing where the user already was. Silenced for that one
            arrival — the `boot` flag the entry screen's redirect carries —
            so opening a conversation from History keeps its usual push. */}
        <Stack.Screen
          name="chat"
          options={({ route }) => ({
            animation:
              (route.params as { boot?: string } | undefined)?.boot === '1' ? 'none' : 'default'
          })}
        />
      </Stack>
      <UpdateNotice />
      {/* What the desktop is busy with, over whatever screen is showing —
          app-wide because the desktop's own cards are, and because a run the
          phone did not start is news wherever the user happens to be. Above
          the screens but below the blocking overlays: a phone that has lost
          the tunnel has no live runs to report anyway (they are cleared on
          the drop), so the two never compete for the same space. */}
      <ActiveOverlays />
      {/* Above every screen: without the tunnel a paired app can only show a
          stale copy and refuse every action. */}
      <ConnectingOverlay />
      {/* Mutually exclusive with the above by construction: syncing needs a
          connection, and the connecting overlay only shows without one. */}
      <SyncOverlay />
      {/* Invisible, and null until the first chart card asks for a snapshot —
          the one ECharts runtime every inline chart in the app shares. */}
      <ChartSnapshotHost />
    </>
  )
}

export default function RootLayout(): React.JSX.Element {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        maxAge: PERSIST_MAX_AGE_MS,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery }
      }}
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
