import { ConfigStatusRow } from '@/components/settings/ConfigRows'
import { InfoRow, PanelScreen, Section } from '@/components/settings/SettingsUI'
import { useConfigValue } from '@/state/demoConfig'
import { useTranslation } from 'react-i18next'

/**
 * Preferences — the desktop WolffishPanel, mirrored read-only. Launch at
 * startup, the local-model RAM guard, the agent safety switches, and week
 * start all drive behavior on the desktop machine (its login items, its RAM,
 * its approval prompts), so this device reports what the desktop has
 * configured and never pretends to flip it.
 */
export default function PreferencesScreen(): React.JSX.Element {
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
        <ConfigStatusRow
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
        <ConfigStatusRow
          field="bypassPermissions"
          label={t('settings.preferences.bypassPermissions')}
          description={t('settings.preferences.bypassPermissionsDescription')}
        />
        <ConfigStatusRow
          field="blockCredentials"
          label={t('settings.preferences.blockCredentials')}
          description={t('settings.preferences.blockCredentialsDescription')}
        />
      </Section>
    </PanelScreen>
  )
}
