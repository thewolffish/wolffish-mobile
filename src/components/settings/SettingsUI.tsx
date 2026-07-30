import { ArrowLeft01Icon, ArrowRight01Icon } from '@/components/core/icons'
import { Toggle } from '@/components/settings/ConfigRows'
import { cn } from '@/lib/utils/cn'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { I18nManager, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Settings building blocks — the desktop Settings grammar on one column:
 * screen header (`text-2xl font-semibold tracking-tight` + muted subtitle),
 * then `bg-surface border rounded-2xl` sections; toggles follow the desktop
 * switch pattern; rows keep the 1px `border-border` separation, never
 * elevation.
 */

export function PanelScreen({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const BackIcon = I18nManager.isRTL ? ArrowRight01Icon : ArrowLeft01Icon
  return (
    <View className="bg-bg flex-1" style={{ paddingTop: insets.top }}>
      <View className="border-border-soft flex-row items-center gap-1 border-b px-2 pb-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={() => router.back()}
          className="h-9 w-9 items-center justify-center rounded-lg active:bg-border/40"
        >
          <BackIcon size={20} className="text-fg" />
        </Pressable>
        <Text numberOfLines={1} className="text-fg font-sans-semibold flex-1 text-left text-base">
          {title}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {subtitle ? (
          <Text className="text-muted text-left font-sans text-sm leading-relaxed">{subtitle}</Text>
        ) : null}
        {children}
      </ScrollView>
    </View>
  )
}

export function Section({
  title,
  children,
  className
}: {
  title?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <View
      className={cn('bg-surface border-border flex-col gap-4 rounded-2xl border p-4', className)}
    >
      {title ? (
        <Text className="text-fg font-sans-semibold text-left text-base">{title}</Text>
      ) : null}
      {children}
    </View>
  )
}

export function SwitchRow({
  label,
  description,
  icon,
  value,
  onValueChange,
  disabled
}: {
  label: string
  description?: string
  icon?: React.ReactNode
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <View className={cn('flex-row items-center gap-3', disabled && 'opacity-50')}>
      {icon}
      <View className="flex-1 flex-col gap-0.5">
        <Text className="text-fg font-sans-medium text-left text-sm">{label}</Text>
        {description ? (
          <Text className="text-muted text-left font-sans text-xs leading-5">{description}</Text>
        ) : null}
      </View>
      <Toggle
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
      />
    </View>
  )
}

/**
 * `code` renders the value as an inline-code chip. The chip background is
 * bg-bg because these rows live inside bg-surface cards — same contrast trick
 * as MarkdownView's code_inline. `mono` still means "this is an LTR technical
 * value"; code chips holding localized text (a translated channel name, a
 * relative time) omit it so Arabic keeps its direction.
 */
export function InfoRow({
  label,
  value,
  mono,
  code
}: {
  label: string
  value: string
  mono?: boolean
  code?: boolean
}): React.JSX.Element {
  if (code) {
    return (
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-muted text-left font-sans text-sm">{label}</Text>
        <View className="bg-bg flex-shrink rounded px-1.5 py-0.5">
          <Text
            numberOfLines={1}
            selectable
            style={mono ? { writingDirection: 'ltr' } : undefined}
            className="text-fg text-left font-mono text-xs"
          >
            {value}
          </Text>
        </View>
      </View>
    )
  }
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-muted text-left font-sans text-sm">{label}</Text>
      <Text
        numberOfLines={1}
        selectable
        style={mono ? { writingDirection: 'ltr' } : undefined}
        className={cn(
          'text-fg flex-shrink text-left text-sm',
          mono ? 'font-mono text-xs' : 'font-sans-medium'
        )}
      >
        {value}
      </Text>
    </View>
  )
}

export function StatusDot({ connected }: { connected: boolean }): React.JSX.Element {
  return (
    <View
      className={cn('h-2 w-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-border')}
      accessibilityElementsHidden
    />
  )
}

export function NavRow({
  label,
  description,
  icon,
  onPress
}: {
  label: string
  description?: string
  icon?: React.ReactNode
  onPress: () => void
}): React.JSX.Element {
  const Chevron = I18nManager.isRTL ? ArrowLeft01Icon : ArrowRight01Icon
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="bg-surface border-border flex-row items-center gap-3 rounded-xl border px-4 py-3 active:bg-border/30"
    >
      {icon}
      <View className="flex-1 flex-col gap-0.5">
        <Text className="text-fg font-sans-medium text-left text-sm">{label}</Text>
        {description ? (
          <Text numberOfLines={1} className="text-muted text-left font-sans text-xs">
            {description}
          </Text>
        ) : null}
      </View>
      <Chevron size={16} className="text-muted" />
    </Pressable>
  )
}
