import { Badge } from '@/components/core/Badge'
import {
  CheckmarkBadge01Icon,
  HelpCircleIcon,
  SecurityCheckIcon,
  SquareLock02Icon
} from '@/components/core/icons'
import { Toggle } from '@/components/settings/ConfigRows'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { cn } from '@/lib/utils/cn'
import { useDemoConfig } from '@/state/demoConfig'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

/**
 * Capabilities — every capability from the real workspace's cerebellum, with
 * the name and description from its SKILL.md and the desktop's badge row:
 * active/inactive state, then core/official/unknown provenance. Toggles are
 * fully controllable except for core capabilities, which the desktop locks on
 * (LOCKED_CAPABILITIES); import/delete stay on the desktop.
 */
export default function CapabilitiesScreen(): React.JSX.Element {
  const { t } = useTranslation()
  // Metadata is snapshot-static; each row's TOGGLE subscribes on its own.
  const capabilityInfo = useDemoConfig((state) => state.capabilityInfo)
  const names = Object.keys(capabilityInfo).sort()

  return (
    <PanelScreen
      title={t('settings.tabs.capabilities')}
      subtitle={t('settings.capabilities.subtitle', { count: names.length })}
    >
      <View className="flex-col gap-3">
        {names.map((name) => (
          <CapabilityRow
            key={name}
            name={name}
            description={capabilityInfo[name].description}
            official={capabilityInfo[name].official}
            core={capabilityInfo[name].core}
          />
        ))}
      </View>
    </PanelScreen>
  )
}

/**
 * One capability card. Subscribes to its own entry in the capabilities map, so
 * flipping one toggle re-renders that card alone. The badge row mirrors the
 * desktop panel: provenance only shows while the capability is active, same as
 * `cap.enabled && isOk` there.
 */
const CapabilityRow = memo(function CapabilityRow({
  name,
  description,
  official,
  core
}: {
  name: string
  description: string
  official: boolean
  core: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const setMapEntry = useDemoConfig((state) => state.setMapEntry)
  const stored = useDemoConfig((state) => state.capabilities[name] ?? false)
  const enabled = core || stored

  return (
    <Section className={cn('gap-2 p-3', !enabled && 'opacity-50')}>
      <View className="flex-row items-center gap-3">
        <Text className="text-fg font-sans-medium flex-1 text-left text-sm">{name}</Text>
        {core ? (
          <View
            accessibilityLabel={t('settings.capabilities.alwaysOn')}
            accessibilityHint={t('settings.capabilities.lockedHint')}
            className="border-border bg-bg flex-row items-center gap-1.5 rounded-lg border px-3 py-1.5"
          >
            <SquareLock02Icon size={12} className="text-muted" />
            <Text className="text-muted font-sans-medium text-xs">
              {t('settings.capabilities.alwaysOn')}
            </Text>
          </View>
        ) : (
          <Toggle
            value={enabled}
            onValueChange={(next) => setMapEntry('capabilities', name, next)}
            accessibilityLabel={name}
          />
        )}
      </View>

      <View className="flex-row flex-wrap items-center gap-1.5">
        {enabled ? (
          <Badge
            label={t('settings.capabilities.active')}
            icon={CheckmarkBadge01Icon}
            variant="success"
          />
        ) : (
          <Badge label={t('settings.capabilities.inactive')} />
        )}
        {enabled &&
          (core ? (
            <Badge
              label={t('settings.capabilities.core')}
              icon={SquareLock02Icon}
              variant="primary"
            />
          ) : official ? (
            <Badge
              label={t('settings.capabilities.official')}
              icon={SecurityCheckIcon}
              variant="primary"
            />
          ) : (
            <Badge label={t('settings.capabilities.unknown')} icon={HelpCircleIcon} />
          ))}
      </View>

      {description ? (
        <Text className="text-muted text-left font-sans text-xs leading-5">{description}</Text>
      ) : null}
    </Section>
  )
})
