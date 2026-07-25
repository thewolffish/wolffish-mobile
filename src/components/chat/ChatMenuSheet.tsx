import { Modal } from '@/components/core/Modal'
import type { ConversationFile } from '@/lib/conversations/types'
import { useTranslation } from 'react-i18next'
import { ScrollView, Text, View } from 'react-native'
import { ContextMeterCard, ModeAndThinkingControls } from './ChatControls'
import { ModelSelector, ModelSwitch } from './ModelSwitch'

/**
 * The chat controls menu — everything that flanks the desktop composer
 * (mode, thinking, model, project, context meter) in one sheet opened from
 * the menu button at the start of the prompt input.
 */
export function ChatMenuSheet({
  open,
  onClose,
  conversation
}: {
  open: boolean
  onClose: () => void
  conversation: ConversationFile | null | undefined
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} title={t('chat.menu.title')}>
      <ScrollView
        style={{ maxHeight: 520 }}
        contentContainerStyle={{ gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <ModelSwitch />
        <ModelSelector />
        <ModeAndThinkingControls />
        <View className="flex-col gap-1.5">
          <Text className="text-muted font-sans-medium text-left text-sm">
            {t('chat.menu.project')}
          </Text>
          <Text className="text-fg text-left font-sans text-sm">
            {conversation?.projectId
              ? `${conversation.icon ?? '📁'} ${conversation.projectId}`
              : t('chat.menu.noProject')}
          </Text>
        </View>
        <ContextMeterCard conversation={conversation} />
      </ScrollView>
    </Modal>
  )
}
