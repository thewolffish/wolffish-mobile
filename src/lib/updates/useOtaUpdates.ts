import { isCheckDue } from '@/lib/updates/policy'
import { restartApp } from '@/lib/utils/restart'
import { useToast } from '@/providers/toast/useToast'
import * as Updates from 'expo-updates'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AppState } from 'react-native'

/**
 * Keeps the running app current with OTA updates (EAS Update).
 *
 * The native layer checks at every cold start without ever blocking launch
 * (fallbackToCacheTimeout 0), so a downloaded update applies on the next
 * cold start on its own. This hook closes the gap for long-lived sessions:
 * it re-checks when the app returns to the foreground (throttled by
 * policy.ts), downloads in the background, and announces a ready update
 * with a sticky toast — tapping it restarts into the new version. No-op in
 * development and wherever updates are disabled (local builds, web).
 */
export function useOtaUpdates(): void {
  const toast = useToast()
  const { t } = useTranslation()
  const { isUpdatePending } = Updates.useUpdates()
  const announcedRef = useRef(false)

  // Announce a downloaded update once per session, whether the native
  // launch check or a foreground check fetched it.
  useEffect(() => {
    if (!isUpdatePending || announcedRef.current) return
    announcedRef.current = true
    toast.show({
      sticky: true,
      placement: 'top',
      message: t('updates.ready'),
      onPress: () => {
        void restartApp()
      }
    })
  }, [isUpdatePending, toast, t])

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    // The native launch check just ran — start the throttle clock there.
    let lastCheckedAt = Date.now()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !isCheckDue(lastCheckedAt, Date.now())) return
      lastCheckedAt = Date.now()
      void checkAndDownload()
    })
    return () => subscription.remove()
  }, [])
}

/**
 * Check and download quietly: offline periods and update-server hiccups are
 * invisible to the user — the next foreground pass simply tries again.
 */
async function checkAndDownload(): Promise<void> {
  try {
    const check = await Updates.checkForUpdateAsync()
    if (check.isAvailable) await Updates.fetchUpdateAsync()
  } catch {
    // Deliberately swallowed — see doc comment.
  }
}
