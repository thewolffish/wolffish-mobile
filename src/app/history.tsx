import {
  Activity04Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete01Icon,
  PlayIcon,
  SmartPhone01Icon,
  TelegramLogo,
  WhatsAppLogo
} from '@/components/core/icons'
import { ConfirmDialog } from '@/components/core/ConfirmDialog'
import { HistorySkeleton } from '@/components/history/HistorySkeleton'
import { groupConversations } from '@/lib/conversations/grouping'
import { removeConversation, useConversationList } from '@/lib/conversations/hooks'
import type { ConversationMeta } from '@/lib/conversations/types'
import { cn } from '@/lib/utils/cn'
import { formatRelativeTime } from '@/lib/utils/relativeTime'
import { router } from 'expo-router'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { I18nManager, Pressable, SectionList, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Conversation history — the desktop History page as a single-column list:
 * date-grouped under the same recency headers, numbered recency chip,
 * channel/source badge, title, relative time, delete with the desktop's confirm
 * copy. Rows open the conversation in the chat screen; data comes straight from
 * the SQLite index so the list is instant.
 */

function RowSeparator(): React.JSX.Element {
  return <View className="h-2" />
}

/**
 * Where a conversation came from, as one glyph — the desktop's ChannelIcon,
 * under the desktop's precedence: a source emoji (a project's icon, an
 * automation's) wins outright, because it says something this row cannot say
 * twice over. The channel badge is the fallback, and `mobile` sits in it with
 * the rest — a conversation started on the phone shows a phone unless it has
 * an emoji of its own to show instead. In-app conversations show nothing: the
 * app is the default, not a badge.
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
    case 'mobile':
      return <SmartPhone01Icon size={14} className="text-muted" />
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
  position,
  time,
  untitledLabel,
  deleteLabel,
  onDelete
}: {
  meta: ConversationMeta
  /** Rank in the WHOLE list, not in its group — see ConversationGroup. */
  position: number
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
          {position}
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
        {({ pressed }) => (
          <Delete01Icon size={16} className={pressed ? 'text-rose-500' : 'text-muted'} />
        )}
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
  // Sliced into the same recency buckets the desktop's History page and rail
  // use. Recomputed with the rows, which refetch on every conversation change,
  // so the day boundary is never more stale than the list itself.
  const groups = useMemo(() => groupConversations(rows), [rows])
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
        <HistorySkeleton />
      ) : rows.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-muted text-center font-sans text-sm">{t('history.empty')}</Text>
        </View>
      ) : (
        <SectionList
          sections={groups}
          keyExtractor={(item) => item.id}
          // Desktop's headers scroll away with their group rather than pinning;
          // RN sticks them on iOS by default, so turn that off to match.
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text
              className={cn(
                'text-muted font-sans-medium px-1 pb-1.5 text-left text-[11px] uppercase',
                // Only the first group starts at rank 1 — every later header
                // gets the gap that separates it from the rows above it.
                section.startIndex > 1 && 'pt-5'
              )}
            >
              {t(section.labelKey)}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <Row
              meta={item}
              // The chip keeps counting across the headers (…7, 8 · "Yesterday"
              // · 9, 10…) instead of restarting per group.
              position={section.startIndex + index}
              time={formatRelativeTime(item.updatedAt, t)}
              untitledLabel={t('chat.conversationsUntitled')}
              deleteLabel={t('history.delete')}
              onDelete={setDoomed}
            />
          )}
          // A contentContainer `gap` would space the headers off their own rows
          // too — the separator keeps the 8px strictly between sibling rows.
          ItemSeparatorComponent={RowSeparator}
          contentContainerStyle={{
            padding: 16,
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
