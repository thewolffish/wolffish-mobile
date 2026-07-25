import { Button } from '@/components/core/Button'
import { Input } from '@/components/core/Input'
import { Delete02Icon, EyeIcon, PlusSignIcon, ViewOffIcon } from '@/components/core/icons'
import { PanelScreen, Section, SwitchRow } from '@/components/settings/SettingsUI'
import { setConfigValue, useConfigValue, type DemoVariable } from '@/state/demoConfig'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'

/**
 * Variables — the desktop VariablesPanel: named prompt variables the agent
 * can substitute, editable in place. Sensitive values render masked with an
 * eye toggle; edits persist locally in demo mode.
 */

function VariableRow({
  variable,
  onChange,
  onDelete
}: {
  variable: DemoVariable
  onChange: (variable: DemoVariable) => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const masked = variable.sensitive && !revealed
  const RevealIcon = revealed ? ViewOffIcon : EyeIcon

  return (
    <View className="border-border flex-col gap-3 rounded-xl border p-3">
      <View className="flex-row items-center gap-2">
        <Input
          containerClassName="flex-1"
          value={variable.name}
          onChangeText={(name) => onChange({ ...variable, name })}
          placeholder={t('settings.variables.namePlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {/* Reveal button is always mounted (only its visibility toggles) —
            mounting/unmounting a styled sibling makes NativeWind's css-interop
            flag a remount and, in dev, crash while stringifying props. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.showPassword')}
          accessibilityElementsHidden={!variable.sensitive}
          hitSlop={8}
          disabled={!variable.sensitive}
          onPress={() => setRevealed((value) => !value)}
          style={{ opacity: variable.sensitive ? 1 : 0 }}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-border/40"
        >
          <RevealIcon size={16} className="text-muted" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.variables.delete')}
          hitSlop={8}
          onPress={onDelete}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-rose-500/10"
        >
          <Delete02Icon size={16} className="text-rose-500" />
        </Pressable>
      </View>
      <Input
        value={variable.value}
        onChangeText={(value) => onChange({ ...variable, value })}
        placeholder={t('settings.variables.valuePlaceholder')}
        secureTextEntry={masked}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <SwitchRow
        label={t('settings.variables.sensitive')}
        value={variable.sensitive}
        onValueChange={(sensitive) => onChange({ ...variable, sensitive })}
      />
    </View>
  )
}

export default function VariablesScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const variables = useConfigValue('variables')
  const setVariables = (next: DemoVariable[]): void => setConfigValue('variables', next)

  return (
    <PanelScreen title={t('settings.tabs.variables')} subtitle={t('settings.variables.subtitle')}>
      <Section>
        {variables.length === 0 ? (
          <Text className="text-muted text-left font-sans text-sm">
            {t('settings.variables.empty')}
          </Text>
        ) : (
          variables.map((variable, index) => (
            <VariableRow
              key={index}
              variable={variable}
              onChange={(next) => {
                const copy = [...variables]
                copy[index] = next
                setVariables(copy)
              }}
              onDelete={() => setVariables(variables.filter((_, i) => i !== index))}
            />
          ))
        )}
        <Button
          variant="outline"
          size="sm"
          onPress={() =>
            setVariables([...variables, { name: '', value: '', sensitive: false }])
          }
        >
          <PlusSignIcon size={14} className="text-fg" />
          {t('settings.variables.add')}
        </Button>
      </Section>
    </PanelScreen>
  )
}
