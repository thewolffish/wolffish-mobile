import {
  Activity04Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete01Icon,
  PlayIcon,
  TelegramLogo,
  WhatsAppLogo
} from '@/components/core/icons'
import { ConfirmDialog } from '@/components/core/ConfirmDialog'
import { removeConversation, useConversationList } from '@/lib/conversations/hooks'
import type { ConversationMeta } from '@/lib/conversations/types'
import { formatRelativeTime } from '@/lib/utils/relativeTime'
import { router } from 'expo-router'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, I18nManager, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Conversation history — the desktop History page as a single-column list:
 * numbered recency chip, channel/source badge, title, relative time, delete
 * with the desktop's confirm copy. Rows open the conversation in the chat
 * screen; data comes straight from the SQLite index so the list is instant.
 */

function ChannelBadge({ meta }: { meta: ConversationMeta }): React.JSX.Element | null {
  if (meta.icon) {
    return <Text className="text-left text-sm">{meta.icon}</Text>
  }
  switch (meta.channel) {
    case 'telegram':
      return <TelegramLogo size={14} className="text-muted" />
    case 'whatsapp':
      return <WhatsAppLogo size={14} className="text-muted" />
    case 'heartbeat':
      return <Activity04Icon size={14} className="text-muted" />
    case 'procedure':
      return <PlayIcon size={14} className="text-muted" />
    default:
      return null
  }
}

const Row = memo(function Row({
  meta,
  index,
  time,
  untitledLabel,
  deleteLabel,
  onDelete
}: {
  meta: ConversationMeta
  index: number
  time: string
  untitledLabel: string
  deleteLabel: string
  onDelete: (meta: ConversationMeta) => void
}): React.JSX.Element {
  const title = meta.title === 'Untitled' ? untitledLabel : meta.title
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => router.push({ pathname: '/chat', params: { id: meta.id } })}
      className="bg-surface border-border flex-row items-center gap-3 rounded-xl border px-4 py-3 active:bg-border/30"
    >
      <View className="border-border h-6 w-6 items-center justify-center rounded-full border">
        <Text
          className="text-muted font-sans-semibold text-[8px]"
          style={{ writingDirection: 'ltr' }}
        >
          {index + 1}
        </Text>
      </View>
      <View className="flex-1 flex-col gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <ChannelBadge meta={meta} />
          <Text
            numberOfLines={1}
            className="text-fg font-sans-medium flex-shrink text-left text-sm"
          >
            {title}
          </Text>
        </View>
        <Text className="text-muted text-left font-sans text-xs">{time}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={deleteLabel}
        hitSlop={8}
        onPress={() => onDelete(meta)}
        className="h-8 w-8 items-center justify-center rounded-lg active:bg-rose-500/10"
      >
        <Delete01Icon size={16} className="text-muted" />
      </Pressable>
    </Pressable>
  )
})

export default function HistoryScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const insets = useSafeAreaInsets()
  const { data, isLoading } = useConversationList()
  const [doomed, setDoomed] = useState<ConversationMeta | null>(null)
  const [deleting, setDeleting] = useState(false)

  const rows = useMemo(() => data ?? [], [data])
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
        <Text className="text-fg font-sans-semibold flex-1 text-left text-base">
          {t('chat.conversations')}
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-col gap-2 p-4">
          {/* Solid bg-border, not bg-border/60 — NativeWind drops `/opacity` on
              var() colours (see global.css), which left these rows invisible. */}
          {Array.from({ length: 8 }, (_, index) => (
            <View key={index} className="bg-border h-16 animate-pulse rounded-xl" />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-muted text-center font-sans text-sm">{t('history.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <Row
              meta={item}
              index={index}
              time={formatRelativeTime(item.updatedAt, t)}
              untitledLabel={t('chat.conversationsUntitled')}
              deleteLabel={t('history.delete')}
              onDelete={setDoomed}
            />
          )}
          contentContainerStyle={{
            padding: 16,
            gap: 8,
            paddingBottom: insets.bottom + 16
          }}
        />
      )}

      <ConfirmDialog
        open={doomed !== null}
        title={t('history.deleteTitle')}
        message={t('history.deleteWarning')}
        confirmLabel={t('history.deleteConfirm')}
        cancelLabel={t('history.deleteCancel')}
        busy={deleting}
        onCancel={() => setDoomed(null)}
        onConfirm={() => {
          if (!doomed) return
          setDeleting(true)
          void removeConversation(doomed.id).finally(() => {
            setDeleting(false)
            setDoomed(null)
          })
        }}
      />
    </View>
  )
}
