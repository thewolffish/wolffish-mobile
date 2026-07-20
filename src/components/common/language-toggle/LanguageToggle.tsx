import { ConfirmDialog } from '@/components/core/ConfirmDialog'
import type { SupportedLocale } from '@/lib/i18n'
import { useLocale } from '@/providers/locale/useLocale'
import { useTokens } from '@/providers/theme/useTheme'
import { cn } from '@/lib/utils/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

// Each option is labelled in its own language so the control stays readable
// whichever language the app is currently in (growth-app pattern).
const OPTIONS: readonly { value: SupportedLocale; label: string }[] = [
  { value: 'ar', label: 'عربي' },
  { value: 'en', label: 'EN' }
]

export function LanguageToggle({
  label,
  className
}: {
  label?: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const tokens = useTokens()
  const { locale, setLocale } = useLocale()
  const [pending, setPending] = useState<SupportedLocale | null>(null)
  const [switching, setSwitching] = useState<SupportedLocale | null>(null)

  const apply = async (next: SupportedLocale): Promise<void> => {
    setPending(null)
    setSwitching(next)
    // Reloads the app to flip RTL — nothing after this runs in dev.
    await setLocale(next)
    setSwitching(null)
  }

  const choose = (next: SupportedLocale): void => {
    // Tapping the language already in use stays inert. Confirm before
    // switching: applying a language restarts the app, which would throw
    // away anything in progress.
    if (next === locale || switching) return
    setPending(next)
  }

  return (
    <View className={cn('flex-col gap-1.5', className)}>
      {label && <Text className="text-muted font-sans-medium text-left text-sm">{label}</Text>}
      {/* h-10 + rounded-lg match the Button/Input/Select control metrics;
          the whole track dims while a switch is applying, like a disabled
          control. */}
      <View
        className={cn(
          'border-border bg-bg h-10 flex-row items-stretch self-start rounded-lg border p-0.5',
          switching !== null && 'opacity-50'
        )}
      >
        {OPTIONS.map((option) => {
          const active = option.value === locale
          const busy = switching === option.value
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              disabled={active || switching !== null}
              onPress={() => choose(option.value)}
              // Fixed min width + the track's fixed height keep the segment
              // from reflowing when the label swaps for the spinner.
              style={{ minWidth: 48 }}
              className={cn(
                'flex-row items-center justify-center rounded-md px-3',
                active ? 'bg-primary' : 'bg-transparent'
              )}
            >
              {busy ? (
                <ActivityIndicator size="small" color={tokens.primaryFg} />
              ) : (
                <Text
                  numberOfLines={1}
                  className={cn(
                    'text-xs',
                    active ? 'text-primary-fg font-sans-semibold' : 'text-muted font-sans'
                  )}
                >
                  {option.label}
                </Text>
              )}
            </Pressable>
          )
        })}
      </View>

      <ConfirmDialog
        open={pending !== null}
        busy={switching !== null}
        title={t('locale.confirmTitle')}
        message={t('locale.confirmMessage')}
        confirmLabel={t('locale.confirmSwitch')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void apply(pending)
        }}
      />
    </View>
  )
}
