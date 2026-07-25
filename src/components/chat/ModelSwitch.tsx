import { Select, type SelectOption } from '@/components/core/Select'
import { OllamaLogo, PROVIDER_LABELS, PROVIDER_LOGOS } from '@/components/core/providerLogos'
import { cn } from '@/lib/utils/cn'
import { setConfigValue, useConfigValue, useDemoConfig } from '@/state/demoConfig'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'

/**
 * The desktop composer's ModelSwitch as a full-width control: two tabs —
 * Local (Ollama logo + local model) and Cloud (active provider logo + model,
 * truncated). Picking a side flips llm.localOnly exactly like the desktop;
 * below it, the active side's model picker.
 */

function ProviderMark({
  provider,
  size,
  className
}: {
  provider: string
  size: number
  className?: string
}): React.JSX.Element {
  const Logo = PROVIDER_LOGOS[provider]
  if (Logo) return <Logo size={size} className={className} />
  return (
    <View
      className="border-border items-center justify-center rounded border"
      style={{ width: size, height: size }}
    >
      <Text className={cn('font-sans-semibold text-[8px]', className)}>
        {(provider[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  )
}

export function ModelSwitch(): React.JSX.Element {
  const { t } = useTranslation()
  const localOnly = useConfigValue('localOnly')
  const localEnabled = useConfigValue('localEnabled')
  const localModel = useConfigValue('localModel')
  const brainProvider = useConfigValue('brainProvider')
  const brainModel = useConfigValue('brainModel')

  const localActive = localOnly && localEnabled

  return (
    <View className="border-border bg-bg w-full flex-row items-stretch rounded-lg border p-0.5">
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: localActive, disabled: !localEnabled }}
        disabled={!localEnabled}
        onPress={() => setConfigValue('localOnly', true)}
        className={cn(
          'h-11 flex-1 flex-row items-center justify-center gap-2 rounded-md px-3',
          localActive && 'bg-primary shadow-sm',
          !localEnabled && 'opacity-50'
        )}
      >
        <OllamaLogo size={16} className={localActive ? 'text-primary-fg' : 'text-muted'} />
        <Text
          numberOfLines={1}
          className={cn(
            'font-sans-medium flex-shrink text-xs',
            localActive ? 'text-primary-fg' : 'text-muted'
          )}
          style={{ writingDirection: 'ltr' }}
        >
          {localEnabled && localModel ? localModel : t('settings.model.noModel')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: !localActive }}
        onPress={() => setConfigValue('localOnly', false)}
        className={cn(
          'h-11 flex-1 flex-row items-center justify-center gap-2 rounded-md px-3',
          !localActive && 'bg-primary shadow-sm'
        )}
      >
        <ProviderMark
          provider={brainProvider}
          size={16}
          className={!localActive ? 'text-primary-fg' : 'text-muted'}
        />
        <Text
          numberOfLines={1}
          className={cn(
            'font-sans-medium flex-shrink text-xs',
            !localActive ? 'text-primary-fg' : 'text-muted'
          )}
          style={{ writingDirection: 'ltr' }}
        >
          {brainModel || t('settings.model.noModel')}
        </Text>
      </Pressable>
    </View>
  )
}

/** The active side's model picker(s) — provider + model on cloud, model on local. */
export function ModelSelector(): React.JSX.Element {
  const { t } = useTranslation()
  const localOnly = useConfigValue('localOnly')
  const localEnabled = useConfigValue('localEnabled')
  const localModel = useConfigValue('localModel')
  const brainProvider = useConfigValue('brainProvider')
  const brainModel = useConfigValue('brainModel')
  const providers = useDemoConfig((state) => state.providers)

  const providerOptions = useMemo<readonly SelectOption<string>[]>(
    () =>
      providers.map((provider) => ({
        value: provider.id,
        label: PROVIDER_LABELS[provider.id] ?? provider.id,
        icon: <ProviderMark provider={provider.id} size={16} className="text-muted" />
      })),
    [providers]
  )

  const activeProvider = providers.find((provider) => provider.id === brainProvider)
  const modelOptions = useMemo<readonly SelectOption<string>[]>(() => {
    const models = activeProvider?.models?.length
      ? activeProvider.models
      : brainModel
        ? [brainModel]
        : []
    return models.map((model) => ({ value: model, label: model }))
  }, [activeProvider, brainModel])

  if (localOnly && localEnabled) {
    return (
      <Select<string>
        label={t('settings.model.localTitle')}
        value={localModel}
        options={[{ value: localModel, label: localModel }]}
        onChange={(model) => setConfigValue('localModel', model)}
      />
    )
  }

  return (
    <View className="flex-col gap-4">
      <Select<string>
        label={t('settings.model.providersTitle')}
        value={brainProvider}
        options={providerOptions}
        onChange={(id) => {
          const provider = providers.find((candidate) => candidate.id === id)
          if (!provider) return
          setConfigValue('brainProvider', provider.id)
          setConfigValue('brainModel', provider.model ?? provider.models[0] ?? '')
        }}
      />
      <Select<string>
        label={t('settings.model.brainLabel')}
        value={brainModel}
        options={modelOptions}
        onChange={(model) => {
          setConfigValue('brainModel', model)
          // Mirror onto the provider entry like the desktop's setBrain.
          setConfigValue(
            'providers',
            useDemoConfig
              .getState()
              .providers.map((provider) =>
                provider.id === brainProvider ? { ...provider, model } : provider
              )
          )
        }}
        searchable
      />
    </View>
  )
}
