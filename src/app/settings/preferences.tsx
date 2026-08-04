import { useFreshConfig } from '@/lib/sync/useFreshConfig'
import { ConfigStatusRow, ConfigSwitchRow } from '@/components/settings/ConfigRows'
import { InfoRow, PanelScreen, Section } from '@/components/settings/SettingsUI'
import { useConfigValue } from '@/state/demoConfig'
import { useTranslation } from 'react-i18next'

/**
 * Preferences — the desktop WolffishPanel, mirrored. The RAM guard and the
 * two agent safety switches are editable here: setConfigValue routes them
 * through the outbox to the desktop, which persists them exactly as its own
 * panel would and announces the change back. Launch at startup stays
 * display-only — it registers a login item with that machine's OS, an act
 * only the desktop can perform on itself — and week start is likewise the
 * desktop's own display choice, reported here.
 */
export default function PreferencesScreen(): React.JSX.Element {
  // Desktop-owned values: pull the current ones when this screen opens.
  useFreshConfig()
  const { t } = useTranslation()
  const weekStartsOn = useConfigValue('weekStartsOn')

  return (
    <PanelScreen
      title={t('settings.tabs.preferences')}
      subtitle={t('settings.preferences.subtitle')}
    >
      <Section title={t('settings.preferences.generalTitle')}>
        <ConfigStatusRow
          field="launchAtStartup"
          label={t('settings.preferences.launchAtStartup')}
          description={t('settings.preferences.launchAtStartupDescription')}
        />
        <ConfigSwitchRow
          field="restrictPowerfulModels"
          label={t('settings.preferences.restrictPowerfulModels')}
          description={t('settings.preferences.restrictPowerfulModelsDescription')}
        />
        <InfoRow
          label={t('settings.preferences.weekStartsOn')}
          value={weekStartsOn === 1 ? t('settings.days.monday') : t('settings.days.sunday')}
        />
      </Section>
      <Section title={t('settings.preferences.safetyTitle')}>
        <ConfigSwitchRow
          field="bypassPermissions"
          label={t('settings.preferences.bypassPermissions')}
          description={t('settings.preferences.bypassPermissionsDescription')}
        />
        <ConfigSwitchRow
          field="blockCredentials"
          label={t('settings.preferences.blockCredentials')}
          description={t('settings.preferences.blockCredentialsDescription')}
        />
      </Section>
    </PanelScreen>
  )
}
