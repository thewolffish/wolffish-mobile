import { CheckmarkCircle02Icon } from '@/components/core/icons'
import { MapSwitchRow } from '@/components/settings/ConfigRows'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { useDemoConfig } from '@/state/demoConfig'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

/**
 * Cellebrum — every capability from the real workspace's cerebellum, with
 * the name and description from its SKILL.md and the desktop's official
 * badge. Toggles are fully controllable; import/delete stay on the desktop.
 */
export default function CellebrumScreen(): React.JSX.Element {
  const { t } = useTranslation()
  // Metadata is snapshot-static; each row's TOGGLE subscribes on its own.
  const capabilityInfo = useDemoConfig((state) => state.capabilityInfo)
  const names = Object.keys(capabilityInfo).sort()

  return (
    <PanelScreen
      title={t('settings.tabs.cellebrum')}
      subtitle={t('settings.cellebrum.subtitle', { count: names.length })}
    >
      <View className="flex-col gap-3">
        {names.map((name) => {
          const info = capabilityInfo[name]
          return (
            <Section key={name} className="gap-2 p-3">
              <MapSwitchRow
                mapKey="capabilities"
                name={name}
                label={name}
                description={info.description}
                icon={
                  info.official ? (
                    <CheckmarkCircle02Icon size={16} className="text-emerald-600" />
                  ) : undefined
                }
              />
            </Section>
          )
        })}
      </View>
    </PanelScreen>
  )
}
