import { cn } from '@/lib/utils/cn'
import { View } from 'react-native'

/**
 * Placeholder feed for the frames a conversation spends being read out of
 * SQLite. Without it the chat screen has nothing to render and falls through
 * to the new-chat hero, so opening a long conversation flashes an empty chat
 * and then snaps to the messages.
 *
 * Bottom-aligned and clipped at the top because the real feed opens scrolled
 * to its end — the last placeholder sits where the last message will land.
 *
 * Uniform fill on purpose: alignment and width carry the user/agent read, so
 * the placeholders never imply content that isn't there. Solid bg-border, not
 * an alpha-modified token — NativeWind drops `/opacity` on var() colours (see
 * global.css), which is why these would otherwise be invisible.
 */

const ROWS = ['user', 'agent', 'user', 'agent', 'user', 'agent'] as const

export function ChatSkeleton(): React.JSX.Element {
  return (
    <View className="flex-1 justify-end gap-4 overflow-hidden p-4">
      {ROWS.map((role, index) => (
        <View
          key={index}
          className={cn(
            'bg-border animate-pulse rounded-2xl',
            role === 'user' ? 'h-10 w-[45%] self-end' : 'h-20 w-[80%] self-start'
          )}
        />
      ))}
    </View>
  )
}
