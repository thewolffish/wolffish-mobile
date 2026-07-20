import { useTokens } from '@/providers/theme/useTheme'
import { cn } from '@/lib/utils/cn'
import { forwardRef, useState } from 'react'
import { I18nManager, Text, TextInput, View, type TextInputProps } from 'react-native'

// Base bidi direction for typed input text. Alignment alone (text-left,
// swapped in RTL) puts the text on the correct side, but with an LTR base
// direction Arabic punctuation like the trailing ؟ still renders on the
// wrong end of the sentence.
export const WRITING_DIRECTION = {
  writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr'
} as const

// TextInput ignores React Native's RTL left/right swap (it works for Text
// but not for input placeholders), so alignment is set explicitly per
// direction — the growth-app approach.
export const INPUT_TEXT_ALIGN = I18nManager.isRTL ? 'text-right' : 'text-left'

/**
 * Placeholders ignore the writingDirection text style (the native field
 * renders them separately), so wrap them in Unicode RTL-isolate marks
 * (U+2067…U+2069) when the app is RTL. This forces correct bidi ordering
 * of the string itself; Latin-only placeholders are visually unaffected.
 */
export function rtlPlaceholder(placeholder: string | undefined): string | undefined {
  if (!placeholder || !I18nManager.isRTL) return placeholder
  return `⁧${placeholder}⁩`
}

export type InputProps = TextInputProps & {
  label?: string
  className?: string
  /** Extra classes for the wrapping column (label + field). */
  containerClassName?: string
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, className, containerClassName, editable, placeholder, onFocus, onBlur, style, ...rest },
  ref
) {
  const tokens = useTokens()
  const [focused, setFocused] = useState(false)
  const disabled = editable === false
  return (
    <View className={cn('flex-col gap-1.5', containerClassName)}>
      {/* text-left = start alignment: React Native swaps left/right in RTL,
          matching the desktop app's dir-driven alignment. */}
      {label && <Text className="text-muted font-sans-medium text-left text-sm">{label}</Text>}
      <TextInput
        ref={ref}
        editable={editable}
        placeholder={rtlPlaceholder(placeholder)}
        placeholderTextColor={tokens.muted}
        selectionColor={tokens.accent}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        className={cn(
          'bg-bg text-fg border-border h-10 w-full rounded-lg border px-3 py-0 font-sans text-sm',
          INPUT_TEXT_ALIGN,
          focused && 'border-accent',
          disabled && 'opacity-50',
          className
        )}
        style={[WRITING_DIRECTION, style]}
        {...rest}
      />
    </View>
  )
})
