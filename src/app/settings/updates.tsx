import { InfoRow, PanelScreen, Section } from '@/components/settings/SettingsUI'
import { ConfigSwitchRow } from '@/components/settings/ConfigRows'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useTranslation } from 'react-i18next'

/**
 * Updates — the mobile app's own delivery state (store binary vs OTA),
 * following the desktop UpdatesPanel layout: auto-update toggle + a facts
 * card. Facts come from expo-updates/expo-constants at runtime.
 */
export default function UpdatesScreen(): React.JSX.Element {
  const { t } = useTranslation()
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
      ? Updates.runtimeVersion
      : '—'
  const publishedAt = Updates.createdAt ? Updates.createdAt.toLocaleDateString() : '—'

  return (
    <PanelScreen title={t('settings.tabs.updates')} subtitle={t('settings.updates.subtitle')}>
      <Section>
        <ConfigSwitchRow
          field="updatesEnabled"
          label={t('settings.updates.autoLabel')}
          description={t('settings.updates.autoDescription')}
        />
      </Section>
      <Section title={t('settings.updates.aboutTitle')}>
        <InfoRow label={t('settings.updates.version')} value={`v${version} (${build})`} />
        <InfoRow label={t('settings.updates.channel')} value={channel} />
        <InfoRow label={t('settings.updates.runtime')} value={runtime} mono />
        <InfoRow label={t('settings.updates.updateId')} value={updateId} mono />
        <InfoRow label={t('settings.updates.publishedAt')} value={publishedAt} />
      </Section>
    </PanelScreen>
  )
}
