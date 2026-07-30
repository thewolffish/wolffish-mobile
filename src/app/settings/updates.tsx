import { Button } from '@/components/core/Button'
import { ConfigSwitchRow } from '@/components/settings/ConfigRows'
import { InfoRow, NavRow, PanelScreen, Section, SwitchRow } from '@/components/settings/SettingsUI'
import {
  checkForUpdateNow,
  updatesAvailable,
  type UpdateCheckOutcome
} from '@/lib/updates/useOtaUpdates'
import { formatRelativeTime } from '@/lib/utils/relativeTime'
import { useLocale } from '@/providers/locale/useLocale'
import { useToast } from '@/providers/toast/useToast'
import { useAppStore } from '@/state/appStore'
import { useDesktopInfo } from '@/state/demoConfig'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import * as Updates from 'expo-updates'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

/**
 * Both ends of a long id, with the gap marked. The fingerprint runtime is 40
 * hex characters — in full it is noise inside a one-line row, and cut to a
 * bare prefix it reads as the whole value, so two different runtimes can look
 * identical. Values already short enough are left alone.
 */
function shortId(value: string): string {
  return value.length > 9 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value
}

/**
 * Updates — two apps, kept apart on purpose.
 *
 * One card per app, each shaped the same way: what it is (version, and the
 * facts identifying exactly which bundle is running) above what you can change
 * about it. THIS app's card governs OTA delivery for real — device-local
 * appStore.otaEnabled, read by lib/updates/useOtaUpdates. The DESKTOP card's
 * switch is config the desktop owns and this device only mirrors. Those two
 * were one switch until they weren't: the toggle here used to write the
 * desktop's preference under a label about this phone.
 */
export default function UpdatesScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const toast = useToast()
  const otaEnabled = useAppStore((state) => state.otaEnabled)
  const setOtaEnabled = useAppStore((state) => state.setOtaEnabled)
  const desktop = useDesktopInfo()
  const [checking, setChecking] = useState(false)

  const version = Constants.expoConfig?.version ?? '?'
  const build =
    Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '?'
  const channel = __DEV__
    ? 'dev'
    : !Updates.isEnabled || Updates.isEmbeddedLaunch || !Updates.updateId
      ? t('settings.updates.embedded')
      : t('settings.updates.ota')
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : '—'
  const runtime =
    typeof Updates.runtimeVersion === 'string' && Updates.runtimeVersion
      ? shortId(Updates.runtimeVersion)
      : '—'
  // Dates follow the app's language, not the device's regional calendar: a
  // bare toLocaleDateString() renders "13/02/1448 AH" for a phone set to Saudi
  // Arabia, inside an interface that is otherwise entirely in English.
  const publishedAt = Updates.createdAt ? Updates.createdAt.toLocaleDateString(locale) : '—'
  // How stale the mirror is, not when it was taken — "2h" answers the question
  // the row is actually asking, and a same-day sync reads as today's date.
  const syncedAtMs = desktop.syncedAt ? new Date(desktop.syncedAt).getTime() : Number.NaN
  const syncedAt = Number.isNaN(syncedAtMs) ? '—' : formatRelativeTime(syncedAtMs, t)

  const onCheck = useCallback(async () => {
    if (checking) return
    setChecking(true)
    const outcome: UpdateCheckOutcome = await checkForUpdateNow()
    setChecking(false)
    // A download announces itself: UpdateNotice watches the same pending state
    // and slides its card in over this screen. A toast here would say it twice.
    if (outcome === 'downloaded') return
    if (outcome === 'upToDate') {
      toast.show({ message: t('settings.updates.upToDate'), tone: 'success' })
    } else if (outcome === 'unavailable') {
      toast.show({ message: t('settings.updates.checkUnavailable'), tone: 'info' })
    } else {
      toast.show({ message: t('settings.updates.checkFailed'), tone: 'error' })
    }
  }, [checking, toast, t])

  return (
    <PanelScreen title={t('settings.tabs.updates')} subtitle={t('settings.updates.subtitle')}>
      <NavRow
        label={t('settings.changelog.title')}
        description={t('settings.changelog.subtitle')}
        onPress={() => router.push('/settings/changelog')}
      />

      <Section title={t('settings.updates.thisAppTitle')}>
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.updates.thisAppDescription')}
        </Text>
        <InfoRow label={t('settings.updates.version')} value={`v${version} (${build})`} code mono />
        <InfoRow label={t('settings.updates.channel')} value={channel} code />
        <InfoRow label={t('settings.updates.runtime')} value={runtime} code mono />
        <InfoRow label={t('settings.updates.updateId')} value={updateId} code mono />
        <InfoRow label={t('settings.updates.publishedAt')} value={publishedAt} />
        <SwitchRow
          label={t('settings.updates.autoLabel')}
          description={t('settings.updates.autoDescription')}
          value={otaEnabled}
          onValueChange={setOtaEnabled}
        />
        <View className="flex-row items-center gap-3">
          <View className="flex-1 flex-col gap-0.5">
            <Text className="text-fg font-sans-medium text-left text-sm">
              {t('settings.updates.checkManual')}
            </Text>
            <Text className="text-muted text-left font-sans text-xs leading-5">
              {updatesAvailable()
                ? t('settings.updates.checkManualDescription')
                : t('settings.updates.checkUnavailable')}
            </Text>
          </View>
          <Button variant="outline" size="sm" disabled={checking} onPress={() => void onCheck()}>
            {t('settings.updates.check')}
          </Button>
        </View>
      </Section>

      <Section title={t('settings.updates.desktopTitle')}>
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.updates.desktopDescription')}
        </Text>
        <InfoRow
          label={t('settings.updates.version')}
          value={desktop.version ? `v${desktop.version}` : '—'}
          code
          mono
        />
        <InfoRow label={t('settings.updates.platform')} value={desktop.platform ?? '—'} code mono />
        <InfoRow label={t('settings.updates.syncedAt')} value={syncedAt} code />
        <ConfigSwitchRow
          field="updatesEnabled"
          label={t('settings.updates.desktopAutoLabel')}
          description={t('settings.updates.desktopAutoDescription')}
        />
      </Section>
    </PanelScreen>
  )
}
