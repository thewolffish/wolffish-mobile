import { Button } from '@/components/core/Button'
import { Input } from '@/components/core/Input'
import { CheckmarkCircle02Icon } from '@/components/core/icons'
import { PROVIDER_LABELS, PROVIDER_LOGOS } from '@/components/core/providerLogos'
import { ModeAndThinkingControls } from '@/components/chat/ChatControls'
import { ModelSelector, ModelSwitch } from '@/components/chat/ModelSwitch'
import { ConfigSwitchRow } from '@/components/settings/ConfigRows'
import { PanelScreen, Section } from '@/components/settings/SettingsUI'
import { useToast } from '@/providers/toast/useToast'
import { useDemoConfig, type DemoProvider } from '@/state/demoConfig'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

/**
 * Model — the Brain, desktop UX: the Local/Cloud ModelSwitch up top, the
 * active side's picker, behavior controls, then a card per cloud provider
 * (logo, key state, masked key, test). In live mode key changes and tests
 * are commands the desktop executes; demo mode mocks the happy path.
 */

const ProviderCard = memo(function ProviderCard({
  provider
}: {
  provider: DemoProvider
}): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  const Logo = PROVIDER_LOGOS[provider.id]

  const test = (): void => {
    setTesting(true)
    // Demo happy path: the desktop would run the real verification.
    setTimeout(() => {
      setTesting(false)
      toast.show({
        tone: 'success',
        message: `${PROVIDER_LABELS[provider.id] ?? provider.id} — ${t('settings.model.testSuccess')}`
      })
    }, 900)
  }

  return (
    <Section className="gap-3">
      <View className="flex-row items-center gap-2.5">
        {Logo ? <Logo size={18} className="text-fg" /> : null}
        <Text className="text-fg font-sans-semibold flex-1 text-left text-sm">
          {PROVIDER_LABELS[provider.id] ?? provider.id}
        </Text>
        {provider.hasKey ? (
          <View className="flex-row items-center gap-1">
            <CheckmarkCircle02Icon size={14} className="text-emerald-600" />
            <Text className="font-sans text-xs text-emerald-600">{t('settings.model.keySet')}</Text>
          </View>
        ) : (
          <Text className="text-muted font-sans text-xs">{t('settings.model.noKey')}</Text>
        )}
      </View>
      {provider.model ? (
        <Text
          numberOfLines={1}
          className="text-fg text-left font-mono text-xs"
          style={{ writingDirection: 'ltr' }}
        >
          {provider.model}{' '}
          <Text className="text-muted font-sans">
            · {t('settings.model.modelsCount', { count: provider.models.length })}
          </Text>
        </Text>
      ) : null}
      <Input
        label={t('settings.model.apiKey')}
        defaultValue={provider.hasKey ? '••••••••••••' : ''}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button variant="outline" size="sm" disabled={testing} onPress={test}>
        {testing ? t('common.loading') : t('settings.model.testConnection')}
      </Button>
    </Section>
  )
})

export default function ModelScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const providers = useDemoConfig((state) => state.providers)

  return (
    <PanelScreen title={t('settings.tabs.model')} subtitle={t('settings.model.subtitle')}>
      <Section title={t('settings.model.brainTitle')}>
        <ModelSwitch />
        <ModelSelector />
        <ConfigSwitchRow
          field="restrictPowerfulModels"
          label={t('settings.model.restrictPowerful')}
          description={t('settings.model.restrictPowerfulDescription')}
        />
        <ConfigSwitchRow
          field="contextOptimization"
          label={t('settings.model.contextOptimization')}
          description={t('settings.model.contextOptimizationDescription')}
        />
      </Section>

      <Section title={t('settings.model.behaviorTitle')}>
        <ModeAndThinkingControls />
      </Section>

      <View className="flex-col gap-1.5">
        <Text className="text-fg font-sans-semibold text-left text-base">
          {t('settings.model.providersTitle')}
        </Text>
        <Text className="text-muted text-left font-sans text-xs leading-5">
          {t('settings.model.desktopNote')}
        </Text>
      </View>
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} />
      ))}
    </PanelScreen>
  )
}
