import { cn } from '@/lib/utils/cn'
import { Text, View } from 'react-native'

/**
 * The unread-notification count: one small solid-primary pill, shared by every
 * surface that shows it (conversation rows, the history list, the floating
 * menu disc) so "unread" reads as one mark everywhere. Renders nothing at
 * zero — absence IS the read state, and a zero would be a claim of its own.
 *
 * Sized to hang beside a one-line row without growing it: min-width equals
 * height so a single digit is a circle, and the count caps at 99+ before it
 * can widen into a lozenge that crowds the title.
 */
export function UnreadBadge({
  count,
  className
}: {
  count: number
  className?: string
}): React.JSX.Element | null {
  if (count <= 0) return null
  return (
    <View
      pointerEvents="none"
      className={cn('bg-primary items-center justify-center rounded-full', className)}
      style={{ minWidth: 15, height: 15, paddingHorizontal: 4 }}
    >
      <Text
        className="text-primary-fg font-sans-semibold text-[9px] leading-none"
        // A count is a number in every locale, exactly like the rank chips.
        style={{ writingDirection: 'ltr' }}
      >
        {count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  )
}
