import { useTheme } from '@/providers/theme/useTheme'
import { cn } from '@/lib/utils/cn'
import { BlurView } from 'expo-blur'
import type { ReactNode } from 'react'
import { Modal as RNModal, Pressable, StyleSheet, Text, View } from 'react-native'

export type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Optional footer area for action buttons. */
  footer?: ReactNode
  /** Backdrop tap / back button dismissable (default true). */
  dismissable?: boolean
  /** Extra classes for the dialog panel. */
  className?: string
}

/**
 * Dialog surface — the React Native counterpart of wolffish-app Modal.tsx:
 * dimmed glass backdrop, centered surface card, title/body/footer stack.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  dismissable = true,
  className
}: ModalProps): React.JSX.Element {
  const { isDark } = useTheme()
  return (
    <RNModal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (dismissable) onClose()
      }}
    >
      <Pressable
        accessibilityRole="none"
        onPress={dismissable ? onClose : undefined}
        className="flex-1 items-center justify-center p-4"
      >
        {/* Same glass backdrop as the Select modal — the mobile equivalent of
            the desktop Modal's bg-black/40 backdrop-blur-sm. */}
        <BlurView
          pointerEvents="none"
          intensity={20}
          tint={isDark ? 'dark' : 'light'}
          blurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" className="absolute inset-0 bg-black/40" />
        {/* Pressable card swallows taps so they don't reach the backdrop. */}
        <Pressable
          accessibilityRole="none"
          onPress={() => {}}
          className={cn(
            'bg-surface border-border w-full max-w-md flex-col gap-4 rounded-2xl border p-6 shadow-lg',
            className
          )}
        >
          {title && <Text className="text-fg font-sans-semibold text-left text-lg">{title}</Text>}
          <View className="flex-col gap-3">{children}</View>
          {footer && <View className="pt-2">{footer}</View>}
        </Pressable>
      </Pressable>
    </RNModal>
  )
}
