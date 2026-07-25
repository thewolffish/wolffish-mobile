import { ConfigSelectRow, ConfigSwitchRow } from '@/components/settings/ConfigRows'
import { PanelScreen, Section, StatusDot } from '@/components/settings/SettingsUI'
import { useDemoConfig } from '@/state/demoConfig'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

/**
 * Services — every desktop service panel, controllable where the value is a
 * remote config (toggles, models, voices, capture settings) and read-only
 * where the action is desktop-bound (connect, test, OAuth, engine install,
 * extension pairing). Mirrors the desktop's per-service sections.
 */

function ConnectionHeader({
  titleKey,
  connected
}: {
  titleKey: string
  connected: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <View className="flex-row items-center gap-2">
      <StatusDot connected={connected} />
      <Text className="text-fg font-sans-semibold flex-1 text-left text-sm">
        {t(`settings.services.items.${titleKey}`)}
      </Text>
      <Text className="text-muted font-sans text-xs">
        {connected ? t('settings.services.connected') : t('settings.services.notConnected')}
      </Text>
    </View>
  )
}

export default function ServicesScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const services = useDemoConfig((state) => state.services)
  const byKey = new Map(services.map((service) => [service.key, service]))

  const connectionRows = (key: string): React.JSX.Element[] =>
    (byKey.get(key)?.connections ?? []).map((connection, index) => (
      <View key={index} className="flex-row items-center justify-between gap-3">
        <Text className="text-fg text-left font-sans text-sm">{connection.label}</Text>
        <Text numberOfLines={1} className="text-muted flex-shrink text-left font-sans text-xs">
          {connection.detail}
        </Text>
      </View>
    ))

  return (
    <PanelScreen title={t('settings.tabs.services')} subtitle={t('settings.services.subtitle')}>
      {/* Desktop-bound connections — read-only surface state. */}
      {['google', 'github', 'notion'].map((key) => (
        <Section key={key}>
          <ConnectionHeader titleKey={key} connected={byKey.get(key)?.connected ?? false} />
          {connectionRows(key)}
          <Text className="text-muted text-left font-sans text-xs leading-5">
            {t('settings.services.desktopOnly')}
          </Text>
        </Section>
      ))}

      <Section title={t('settings.services.items.brave')}>
        <ConfigSwitchRow field="braveEnabled" label={t('settings.channels.enabled')} />
      </Section>

      <Section title={t('settings.services.items.memes')}>
        <ConfigSwitchRow field="memesEnabled" label={t('settings.channels.enabled')} />
      </Section>

      <Section title={t('settings.services.items.stt')}>
        <ConfigSelectRow
          field="sttModel"
          label={t('settings.services.sttModel')}
          options={[
            { value: 'tiny', label: 'tiny' },
            { value: 'base', label: 'base' },
            { value: 'small', label: 'small' },
            { value: 'medium', label: 'medium' },
            { value: 'large', label: 'large' },
            { value: 'large-v3-turbo', label: 'large-v3-turbo' }
          ]}
        />
      </Section>

      <Section title={t('settings.services.items.tts')}>
        <ConfigSelectRow
          field="ttsVoice"
          label={t('settings.services.ttsVoice')}
          options={[
            { value: 'af_heart', label: 'af_heart' },
            { value: 'af_bella', label: 'af_bella' },
            { value: 'am_adam', label: 'am_adam' },
            { value: 'bf_emma', label: 'bf_emma' }
          ]}
        />
        <ConfigSelectRow
          field="ttsSpeed"
          label={t('settings.services.ttsSpeed')}
          options={[
            { value: '0.75', label: t('settings.services.speed.slow') },
            { value: '1.0', label: t('settings.services.speed.normal') },
            { value: '1.25', label: t('settings.services.speed.fast') },
            { value: '1.5', label: t('settings.services.speed.veryFast') }
          ]}
        />
      </Section>

      <Section title={t('settings.services.items.computerUse')}>
        <ConnectionHeader
          titleKey="computerUse"
          connected={byKey.get('computerUse')?.connected ?? false}
        />
        <ConfigSelectRow
          field="screenshotMaxWidth"
          label={t('settings.services.screenshotMaxWidth')}
          options={[
            { value: '640', label: '640' },
            { value: '960', label: '960' },
            { value: '1280', label: '1280' },
            { value: '1920', label: '1920' }
          ]}
        />
        <ConfigSelectRow
          field="screenshotFormat"
          label={t('settings.services.screenshotFormat')}
          options={[
            { value: 'jpeg', label: 'JPEG' },
            { value: 'png', label: 'PNG' }
          ]}
        />
      </Section>

      <Section>
        <ConnectionHeader
          titleKey="browserExtension"
          connected={byKey.get('browserExtension')?.connected ?? false}
        />
        {connectionRows('browserExtension')}
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.services.desktopOnly')}
        </Text>
      </Section>
    </PanelScreen>
  )
}
