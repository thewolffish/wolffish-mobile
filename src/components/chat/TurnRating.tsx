import { cn } from '@/lib/utils/cn'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'

/**
 * The turn score bar — the desktop's NPS-style 0-10 strip, shown above the
 * composer once a turn has finished. One tap records the score; the chosen
 * segment stays filled and can be re-tapped to change the vote. Entirely
 * optional: an unrated turn is fine, the nightly reflection simply reviews it
 * without a user signal. Gated by Settings → Knowledge → Reflection, the same
 * switch that gates the desktop's own bar.
 *
 * The desktop's is a floating pill — label and eleven segments on one line.
 * That does not fit a phone: eleven touch targets plus a sentence would leave
 * each number under 20pt wide on a small screen. So the label sits above its
 * own row and the segments share the full width, each an equal flex share, so
 * the strip fits any device down to an SE without scrolling or truncation.
 *
 * Direction is deliberately left to the layout. `flex-row` follows the app's
 * writing direction, so an Arabic build counts 0-10 right to left exactly as
 * the desktop's does — the numerals themselves stay Western Arabic in both,
 * matching every other figure in the app.
 */
export function TurnRating({
  score,
  onRate
}: {
  score: number | null
  onRate: (score: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    // The card recipe every other surface in the feed uses — border-border on
    // bg-surface. NOT the desktop's translucent `bg-surface/95` + backdrop
    // blur: these tokens are var()-backed hex, and NativeWind cannot inject an
    // alpha channel into one, so the modifier drops the fill altogether and
    // the bar reads as a floating row of numbers over the transcript.
    <View className="border-border bg-surface mx-3 mb-2 rounded-2xl border px-2 py-2">
      <Text className="text-muted mb-1.5 text-center font-sans text-[11px]">
        {t('chat.rating.label')}
      </Text>
      {/* Labelled like the desktop's radiogroup: the sentence above is a
          caption a screen reader reaches separately, so the group has to name
          itself or eleven bare numerals announce with no subject. */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('chat.rating.label')}
        className="flex-row items-center gap-0.5"
      >
        {Array.from({ length: 11 }, (_, n) => {
          const active = score === n
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t('chat.rating.rateAs', { score: n })}
              onPress={() => onRate(n)}
              className={cn(
                'h-8 flex-1 items-center justify-center rounded-lg',
                active ? 'bg-primary' : 'active:bg-border/40'
              )}
            >
              <Text
                className={cn(
                  'font-sans-medium text-[12px]',
                  active ? 'text-primary-fg' : 'text-muted'
                )}
                // Two-digit "10" must not reorder beside its neighbours in an
                // RTL build; the numeral is a number, not a word.
                style={{ writingDirection: 'ltr' }}
              >
                {n}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
