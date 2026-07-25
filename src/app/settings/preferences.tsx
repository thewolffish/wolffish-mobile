import { Select, type SelectOption } from '@/components/core/Select'
import { ConfigSwitchRow } from '@/components/settings/ConfigRows'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { setConfigValue, useConfigValue } from '@/state/demoConfig'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Preferences — the desktop WolffishPanel, fully controllable from mobile:
 * launch at startup, the agent safety switches, and week start. In live mode
 * these write straight to the desktop's config over the sync link; in demo
 * mode they persist locally.
 */
export default function PreferencesScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const weekStartsOn = useConfigValue('weekStartsOn')

  const weekOptions = useMemo<readonly SelectOption<string>[]>(
    () => [
      { value: '0', label: t('settings.days.sunday') },
      { value: '1', label: t('settings.days.monday') }
    ],
    [t]
  )

  return (
    <PanelScreen
      title={t('settings.tabs.preferences')}
      subtitle={t('settings.preferences.subtitle')}
    >
      <Section title={t('settings.preferences.generalTitle')}>
        <ConfigSwitchRow
          field="launchAtStartup"
          label={t('settings.preferences.launchAtStartup')}
          description={t('settings.preferences.launchAtStartupDescription')}
        />
        <Select<string>
          label={t('settings.preferences.weekStartsOn')}
          value={`${weekStartsOn}`}
          options={weekOptions}
          onChange={(value) => setConfigValue('weekStartsOn', Number(value) as 0 | 1)}
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
