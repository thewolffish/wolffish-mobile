import { Button } from '@/components/core/Button'
import { Modal } from '@/components/core/Modal'
import { ProgressBar } from '@/components/core/ProgressBar'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

/**
 * The shape both waits wear: reconnecting, and syncing.
 *
 * Shared so the two read as the same event to the user — the app is busy
 * with the desktop, here is how far along it is — rather than two different
 * dialogs that happen to overlap in purpose. What differs between them is
 * only the words, the progress and whether there is a way out.
 */
export function BlockingProgress({
  icon,
  title,
  body,
  ratio,
  detail,
  note,
  escape
}: {
  icon: ReactNode
  title: string
  body: string
  /** 0–1. Phase-derived rather than measured — see each caller. */
  ratio: number
  detail?: string
  note?: string
  /** Present once waiting has gone on long enough to deserve a way out. */
  escape?: { label: string; hint?: string; onPress: () => void }
}): React.JSX.Element {
  return (
    <Modal open onClose={() => undefined} dismissable={false}>
      <View className="items-center gap-4 py-2">
        <View className="bg-primary-soft h-12 w-12 items-center justify-center rounded-2xl">
          {icon}
        </View>
        <Text className="text-fg text-center font-sans-semibold text-base">{title}</Text>
        <Text className="text-muted text-center font-sans text-sm leading-relaxed">{body}</Text>
        <ProgressBar value={ratio} className="w-full" />
        {detail ? (
          <Text className="text-muted text-center font-sans text-xs leading-relaxed">{detail}</Text>
        ) : null}
        {note ? <Text className="text-muted text-center font-sans text-xs">{note}</Text> : null}
        {escape ? (
          <View className="w-full gap-2 pt-1">
            <Button variant="outline" style={{ alignSelf: 'stretch' }} onPress={escape.onPress}>
              {escape.label}
            </Button>
            {escape.hint ? (
              <Text className="text-muted text-center font-sans text-xs leading-relaxed">
                {escape.hint}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  )
}
