import { MapSwitchRow } from '@/components/settings/ConfigRows'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { useDemoConfig } from '@/state/demoConfig'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from 'react-native'

/**
 * MCP — enable/disable configured MCP servers. Adding servers, headers and
 * OAuth remain desktop tasks; the switches are controllable from here.
 */
export default function McpScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const names = useMemo(() => Object.keys(useDemoConfig.getState().mcpServers).sort(), [])

  return (
    <PanelScreen title={t('settings.tabs.mcp')} subtitle={t('settings.mcp.subtitle')}>
      <Section>
        {names.map((name) => (
          <MapSwitchRow key={name} mapKey="mcpServers" name={name} label={name} />
        ))}
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.mcp.desktopNote')}
        </Text>
      </Section>
    </PanelScreen>
  )
}
