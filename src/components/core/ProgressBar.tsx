import { cn } from '@/lib/utils/cn'
import { View } from 'react-native'

export type ProgressBarProps = {
  /** 0–1. Values outside the range are clamped. */
  value: number
  className?: string
}

/** Determinate progress track — the demo import, and anything measured later. */
export function ProgressBar({ value, className }: ProgressBarProps): React.JSX.Element {
  const percent = Math.max(0, Math.min(value, 1)) * 100
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
      className={cn('bg-border h-1 w-full overflow-hidden rounded-full', className)}
    >
      <View className="bg-primary h-full rounded-full" style={{ width: `${percent}%` }} />
    </View>
  )
}
