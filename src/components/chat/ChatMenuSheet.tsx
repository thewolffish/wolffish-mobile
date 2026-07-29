import { Modal } from '@/components/core/Modal'
import { Select, type SelectOption } from '@/components/core/Select'
import { invalidateConversation, invalidateConversationList } from '@/lib/conversations/hooks'
import { setConversationProject } from '@/lib/conversations/repo'
import type { ConversationFile } from '@/lib/conversations/types'
import { useChatRuntime } from '@/state/chatRuntime'
import { useDemoConfig, useProject } from '@/state/demoConfig'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, Text, useWindowDimensions, View } from 'react-native'
import { ContextMeterCard, ModeAndThinkingControls } from './ChatControls'
import { ModelSelector, ModelSwitch } from './ModelSwitch'

/** The unfiled option's value — Select keys on strings, so null needs one. */
const NO_PROJECT = ''

/**
 * The conversation's project, as a picker.
 *
 * An existing conversation is re-filed in place. A chat that has not been
 * created yet — the new-chat screen — has nothing to stamp, so the pick is
 * held in the runtime and applied the moment the first message mints the
 * conversation (see takePendingProject in lib/demo/agent.ts).
 *
 * Options come from the config snapshot's project list, which is why they
 * carry the project's own icon and title rather than the id conversations
 * bind by; a conversation pointing at a project the snapshot no longer has
 * keeps showing its raw id rather than silently reading as unfiled.
 */
function ProjectSelect({
  conversation
}: {
  conversation: ConversationFile | null | undefined
}): React.JSX.Element {
  const { t } = useTranslation()
  const projects = useDemoConfig((state) => state.projects)
  const pendingProjectId = useChatRuntime((state) => state.pendingProjectId)
  const setPendingProject = useChatRuntime((state) => state.setPendingProject)

  // A conversation that exists shows its OWN binding — an unfiled one reads
  // unfiled, never the project the last new chat was pointed at.
  const value = conversation
    ? (conversation.projectId ?? NO_PROJECT)
    : (pendingProjectId ?? NO_PROJECT)
  const project = useProject(value || null)

  const options = useMemo<readonly SelectOption<string>[]>(() => {
    const rows: SelectOption<string>[] = [
      { value: NO_PROJECT, label: t('chat.menu.noProject'), icon: <Text>📄</Text> },
      ...projects.map((entry) => ({
        value: entry.id,
        label: entry.title,
        icon: <Text>{entry.icon}</Text>
      }))
    ]
    // A binding whose project is missing from the snapshot still needs a row,
    // or the Select would render blank and the next pick would silently drop it.
    if (value && !projects.some((entry) => entry.id === value)) {
      rows.push({ value, label: `${conversation?.icon ?? '📁'} ${value}` })
    }
    return rows
  }, [projects, t, value, conversation?.icon])

  const onChange = (next: string): void => {
    if (!conversation?.id) {
      setPendingProject(next || null)
      return
    }
    void (async () => {
      await setConversationProject(conversation.id, next || null)
      invalidateConversation(conversation.id)
      invalidateConversationList()
    })()
  }

  return (
    <View className="flex-col gap-1.5">
      <Select<string>
        label={t('chat.menu.project')}
        value={value}
        options={options}
        onChange={onChange}
      />
      {/* The project's prompt, in the app's code-block tones — the recessed
          mono panel tool output and compaction runs already use. Scrolls in
          place rather than stretching the sheet, so a long prompt is capped
          without being truncated the way the old 3-line preview was.
          Alignment left to RN's `auto`, the desktop's `dir="auto"`: an Arabic
          prompt reads flush-right even while the app is English. */}
      {project?.instructions ? (
        <ScrollView className="bg-bg border-border max-h-32 rounded-lg border" nestedScrollEnabled>
          <Text selectable className="text-fg p-3 font-mono text-[11px] leading-4">
            {project.instructions}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  )
}

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
  const { height } = useWindowDimensions()
  return (
    <Modal open={open} onClose={onClose} title={t('chat.menu.title')}>
      <ScrollView
        // Viewport-relative, not a magic number: the body is long enough to
        // scroll on every phone, and the dialog still fits the shortest one.
        style={{ maxHeight: Math.round(height * 0.6) }}
        contentContainerStyle={{ gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <ModelSwitch />
        <ModelSelector />
        <ModeAndThinkingControls />
        <ProjectSelect conversation={conversation} />
        <ContextMeterCard conversation={conversation} />
      </ScrollView>
    </Modal>
  )
}
