import { Badge } from '@/components/core/Badge'
import { Button } from '@/components/core/Button'
import { ConfirmDialog } from '@/components/core/ConfirmDialog'
import { Input } from '@/components/core/Input'
import { Modal } from '@/components/core/Modal'
import { Select, type SelectOption } from '@/components/core/Select'
import { Delete02Icon, Edit02Icon, PlayIcon, PlusSignIcon } from '@/components/core/icons'
import { PanelScreen } from '@/components/settings/SettingsUI'
import { DEFAULT_PROJECT_ICON } from '@/components/workspace/ProjectDialog'
import { DialogError, PromptPreview, PromptSheet } from '@/components/workspace/PromptSheet'
import { ModePills } from '@/components/workspace/ModePills'
import { EmojiPicker } from '@/components/workspace/EmojiPicker'
import {
  createProcedure,
  deleteProcedure,
  updateProcedure,
  useProcedures
} from '@/lib/sync/procedures'
import { useProjects, useProjectsWritable } from '@/lib/sync/projects'
import type { SyncProcedure } from '@/lib/tunnel/protocol'
import { cn } from '@/lib/utils/cn'
import { formatSignedRelative } from '@/lib/utils/relativeTime'
import { useToast } from '@/providers/toast/useToast'
import { useChatRuntime } from '@/state/chatRuntime'
import { useConfigValue } from '@/state/demoConfig'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'

/**
 * Procedures — the desktop's Procedures page on one column: saved prompts run
 * on demand, each with its own emoji, run mode and optional project binding.
 *
 * Play starts a FRESH conversation and sends the prompt into it, which is what
 * the desktop's play does (a new session that auto-sends). A project-bound
 * procedure runs inside that project, so the run gets its overlay and the
 * conversation registers under it — the binding travels with the send rather
 * than being applied afterwards.
 */

/** Card emoji for a procedure that never picked one — the desktop's default. */
const DEFAULT_PROCEDURE_ICON = '📋'

/** The unbound option's value; Select keys on strings, so null needs one. */
const NO_PROJECT = ''

export default function ProceduresScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const { data: procedures = [], isLoading, refetch } = useProcedures()
  const { data: projects = [] } = useProjects()
  const writable = useProjectsWritable()
  // Rows without a stamped mode follow the workspace's global mode — the pill
  // shows that effective value, and tapping a segment stamps the row.
  const globalMode = useConfigValue('chatMode')
  const setActiveProject = useChatRuntime((state) => state.setActiveProject)
  const setPendingProject = useChatRuntime((state) => state.setPendingProject)
  const setPendingPrompt = useChatRuntime((state) => state.setPendingPrompt)

  const [editing, setEditing] = useState<SyncProcedure | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SyncProcedure | null>(null)

  useFocusEffect(
    useCallback(() => {
      void refetch()
    }, [refetch])
  )

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  /**
   * Card emoji: a project-bound procedure wears its PROJECT's emoji; an unbound
   * one wears its own, else the page default. The desktop's exact rule.
   */
  const cardIcon = useCallback(
    (procedure: SyncProcedure): string =>
      (procedure.projectId ? projectsById.get(procedure.projectId)?.icon : undefined) ||
      procedure.icon ||
      DEFAULT_PROCEDURE_ICON,
    [projectsById]
  )

  const handleCreate = useCallback((): void => {
    void createProcedure({ title: '', prompt: '' })
      .then(setEditing)
      .catch(() => toast.show({ tone: 'error', message: t('procedures.saveError') }))
  }, [t, toast])

  const handleDelete = useCallback((): void => {
    const target = deleteTarget
    if (!target) return
    void deleteProcedure(target.id)
      .then(() => {
        setDeleteTarget(null)
        toast.show({ tone: 'success', message: t('procedures.deleteSuccess') })
      })
      .catch(() => toast.show({ tone: 'error', message: t('procedures.saveError') }))
  }, [deleteTarget, t, toast])

  /**
   * The mode toggle persists on its own (a per-field merge, so a concurrent
   * title/prompt autosave cannot clobber it). No optimism: the desktop's answer
   * lands in the cache, and it is one small write.
   */
  const setMode = useCallback(
    (procedure: SyncProcedure, mode: 'single' | 'workflow'): void => {
      if ((procedure.mode ?? globalMode) === mode) return
      void updateProcedure({ id: procedure.id, mode }).catch(() =>
        toast.show({ tone: 'error', message: t('procedures.saveError') })
      )
    },
    [globalMode, t, toast]
  )

  /**
   * Run it: land in a fresh chat with this procedure's prompt queued for send,
   * inside its project when it has one.
   *
   * The prompt is left in the runtime for the chat screen to send, rather than
   * sent from here: that screen owns sending — it holds the live turn, the
   * optimistic bubble and the queue — and a prompt sent behind its back would
   * render as a reply to nothing. It also travels better than a navigation
   * param, since the run POPS BACK to a chat screen that is already mounted.
   */
  const handlePlay = useCallback(
    (procedure: SyncProcedure): void => {
      const project = procedure.projectId ? projectsById.get(procedure.projectId) : undefined
      // A bound procedure enters project mode, exactly as the desktop's run
      // does; an unbound one only files the one chat it is about to start (and
      // clears any project mode, since this run is not in one).
      if (project) setActiveProject(project)
      else {
        setActiveProject(null)
        setPendingProject(null)
      }
      setPendingPrompt(procedure.prompt)
      try {
        router.dismissTo('/chat')
      } catch {
        router.replace('/chat')
      }
    },
    [projectsById, setActiveProject, setPendingProject, setPendingPrompt]
  )

  return (
    <PanelScreen title={t('procedures.title')} subtitle={t('procedures.subtitle')}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <Text className="text-fg font-sans-semibold text-left text-base">
            {t('procedures.title')}
          </Text>
          {!isLoading && <Badge label={String(procedures.length)} />}
        </View>
        <Button size="sm" disabled={!writable} onPress={handleCreate} className="shrink-0">
          <PlusSignIcon size={14} className="text-primary-fg" />
          {t('procedures.new')}
        </Button>
      </View>

      {isLoading ? (
        <Text className="text-muted py-10 text-center font-sans text-sm">
          {t('common.loading')}
        </Text>
      ) : procedures.length === 0 ? (
        <View className="border-border rounded-2xl border border-dashed px-6 py-12">
          <Text className="text-muted text-center font-sans text-sm">{t('procedures.empty')}</Text>
        </View>
      ) : (
        <View className="flex-col gap-3">
          {procedures.map((procedure) => {
            const name = procedure.title.trim() || t('procedures.untitled')
            const runnable = procedure.prompt.trim().length > 0
            const project = procedure.projectId ? projectsById.get(procedure.projectId) : undefined
            return (
              <View
                key={procedure.id}
                className="bg-surface border-border flex-col gap-2.5 rounded-2xl border px-4 py-3"
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="min-w-0 shrink flex-row items-center gap-2.5">
                    <Text className="text-2xl leading-7">{cardIcon(procedure)}</Text>
                    <View className="min-w-0 flex-1 flex-col gap-0.5">
                      <Text
                        numberOfLines={1}
                        className="text-fg font-sans-medium text-left text-sm"
                      >
                        {name}
                      </Text>
                      <Text numberOfLines={1} className="text-muted text-left font-sans text-xs">
                        {[
                          t('procedures.editedAt', {
                            time: formatSignedRelative(procedure.updatedAt, now, t)
                          }),
                          ...(project ? [project.title.trim() || t('projects.untitled')] : [])
                        ].join(' · ')}
                      </Text>
                    </View>
                  </View>
                  <View className="shrink-0 flex-row items-center">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('procedures.run')}
                      hitSlop={6}
                      disabled={!runnable}
                      onPress={() => handlePlay(procedure)}
                      className={cn(
                        'h-8 w-8 items-center justify-center rounded-lg',
                        runnable ? 'active:bg-border/40' : 'opacity-40'
                      )}
                    >
                      <PlayIcon size={17} className="text-muted" />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('procedures.edit')}
                      hitSlop={6}
                      onPress={() => setEditing(procedure)}
                      className="h-8 w-8 items-center justify-center rounded-lg active:bg-border/40"
                    >
                      <Edit02Icon size={15} className="text-muted" />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('procedures.delete')}
                      hitSlop={6}
                      disabled={!writable}
                      onPress={() => setDeleteTarget(procedure)}
                      className={cn(
                        'h-8 w-8 items-center justify-center rounded-lg',
                        writable ? 'active:bg-border/40' : 'opacity-40'
                      )}
                    >
                      <Delete02Icon size={15} className="text-muted" />
                    </Pressable>
                    {/* The run mode closes the cluster, after delete, exactly as
                        it does on the desktop card — it belongs with the row's
                        other controls rather than on a line of its own. `ms-1`
                        separates the pill group from the icon buttons without
                        widening the gaps between them. */}
                    <View className="ms-1">
                      <ModePills
                        value={procedure.mode ?? globalMode}
                        disabled={!writable}
                        onChange={(mode) => setMode(procedure, mode)}
                      />
                    </View>
                  </View>
                </View>
                <PromptPreview value={procedure.prompt} empty={t('procedures.runEmptyHint')} />
              </View>
            )
          })}
        </View>
      )}

      <ProcedureEditor
        procedure={editing}
        projects={projects}
        readOnly={!writable}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('procedures.deleteTitle')}
        message={t('procedures.deleteWarning', {
          name: deleteTarget?.title.trim() || t('procedures.untitled')
        })}
        confirmLabel={t('procedures.deleteConfirm')}
        cancelLabel={t('procedures.deleteCancel')}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </PanelScreen>
  )
}

/**
 * The procedure editor — title, emoji, project binding and the prompt, which
 * opens in the app's expanded editor rather than being typed into the dialog.
 *
 * Autosaves ~600 ms after the last change, and the title is required: nothing is
 * persisted until one is typed, so a never-named fresh stub is discarded on
 * close and one that already had a title keeps its last saved state. The
 * desktop's exact contract.
 */
function ProcedureEditor({
  procedure,
  projects,
  readOnly,
  onClose
}: {
  procedure: SyncProcedure | null
  projects: Array<{ id: string; title: string; icon: string }>
  readOnly: boolean
  onClose: () => void
}): React.JSX.Element | null {
  if (!procedure) return null
  return (
    <ProcedureEditorBody
      key={procedure.id}
      procedure={procedure}
      projects={projects}
      readOnly={readOnly}
      onClose={onClose}
    />
  )
}

function ProcedureEditorBody({
  procedure,
  projects,
  readOnly,
  onClose
}: {
  procedure: SyncProcedure
  projects: Array<{ id: string; title: string; icon: string }>
  readOnly: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // Reported inline rather than as a toast — see DialogError.
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(procedure.title)
  const [prompt, setPrompt] = useState(procedure.prompt)
  const [icon, setIcon] = useState(procedure.icon)
  const [projectId, setProjectId] = useState(procedure.projectId ?? NO_PROJECT)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const titleInvalid = touched && title.trim() === ''

  const savedRef = useRef({
    title: procedure.title,
    prompt: procedure.prompt,
    icon: procedure.icon,
    projectId: procedure.projectId ?? NO_PROJECT
  })

  const persist = useCallback(
    (next: { title: string; prompt: string; icon: string; projectId: string }): void => {
      savedRef.current = next
      setError(null)
      void updateProcedure({ id: procedure.id, ...next }).catch(() =>
        setError(t('procedures.saveError'))
      )
    },
    [procedure.id, t]
  )

  useEffect(() => {
    if (readOnly) return
    if (title.trim() === '') return
    const saved = savedRef.current
    if (
      title === saved.title &&
      prompt === saved.prompt &&
      icon === saved.icon &&
      projectId === saved.projectId
    ) {
      return
    }
    const handle = setTimeout(() => persist({ title, prompt, icon, projectId }), 600)
    return () => clearTimeout(handle)
  }, [readOnly, title, prompt, icon, projectId, persist])

  const close = useCallback((): void => {
    const saved = savedRef.current
    if (readOnly) {
      onClose()
      return
    }
    if (title.trim() === '') {
      // Never named: the stub is discarded entirely, so create-then-abandon
      // leaves nothing behind. One that already had a title keeps it — a
      // cleared title is never written.
      if (saved.title.trim() === '') {
        void deleteProcedure(procedure.id).catch(() => undefined)
      }
      onClose()
      return
    }
    if (
      title !== saved.title ||
      prompt !== saved.prompt ||
      icon !== saved.icon ||
      projectId !== saved.projectId
    ) {
      persist({ title, prompt, icon, projectId })
    }
    onClose()
  }, [readOnly, title, prompt, icon, projectId, procedure.id, persist, onClose])

  const boundProject = projectId ? projects.find((p) => p.id === projectId) : undefined
  const options = useMemo<readonly SelectOption<string>[]>(
    () => [
      { value: NO_PROJECT, label: t('procedures.projectNone') },
      ...projects.map((project) => ({
        value: project.id,
        label: project.title.trim() || t('projects.untitled'),
        icon: <Text>{project.icon || DEFAULT_PROJECT_ICON}</Text>
      }))
    ],
    [projects, t]
  )

  return (
    <Modal
      open
      onClose={close}
      title={t('procedures.editTitle')}
      dismissable={!emojiOpen && !promptOpen}
      footer={
        <View className="flex-row justify-end">
          <Button size="sm" onPress={close}>
            {t('procedures.done')}
          </Button>
        </View>
      }
    >
      <View className="flex-row items-start gap-2">
        {/* A project-bound procedure wears the project's emoji — the button
            shows it and disables; its own icon returns when the binding goes. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={boundProject ? t('procedures.projectIcon') : t('procedures.pickIcon')}
          disabled={readOnly || boundProject !== undefined}
          onPress={() => setEmojiOpen(true)}
          className={cn(
            'bg-bg border-border h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
            readOnly ? 'opacity-50' : 'active:bg-border/40'
          )}
        >
          <Text className="text-lg">
            {boundProject
              ? boundProject.icon || DEFAULT_PROJECT_ICON
              : icon || DEFAULT_PROCEDURE_ICON}
          </Text>
        </Pressable>
        <View className="min-w-0 flex-1 flex-col gap-1">
          <Input
            value={title}
            editable={!readOnly}
            onChangeText={(value) => {
              setTouched(true)
              setTitle(value)
            }}
            placeholder={t('procedures.titlePlaceholder')}
            className={titleInvalid ? 'border-rose-500/70' : undefined}
          />
          {titleInvalid && (
            <Text className="text-left font-sans text-xs text-rose-500">
              {t('procedures.titleRequired')}
            </Text>
          )}
        </View>
      </View>

      {/* Bind a project: the run gets its context and the conversation
          registers under it. */}
      <Select<string>
        label={t('procedures.project')}
        value={projectId}
        options={options}
        disabled={readOnly}
        onChange={(value) => {
          setTouched(true)
          setProjectId(value)
        }}
      />

      <View className="flex-col gap-1.5">
        <Text className="text-muted font-sans-medium text-left text-sm">
          {t('heartbeat.editor.prompt')}
        </Text>
        <PromptPreview
          value={prompt}
          empty={t('procedures.runEmptyHint')}
          maxHeight={140}
          onPress={readOnly ? undefined : () => setPromptOpen(true)}
        />
        {!readOnly && (
          <Button variant="outline" size="sm" onPress={() => setPromptOpen(true)}>
            {prompt.trim() ? t('procedures.editPrompt') : t('procedures.addPrompt')}
          </Button>
        )}
      </View>

      <DialogError message={error} />
      <Text className="text-muted text-left font-sans text-xs">
        {readOnly ? t('projects.readOnly') : t('procedures.autosaveHint')}
      </Text>

      <EmojiPicker
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onPick={(emoji) => {
          setTouched(true)
          setIcon(emoji)
          setEmojiOpen(false)
        }}
      />
      <PromptSheet
        open={promptOpen}
        title={t('heartbeat.editor.prompt')}
        initialValue={prompt}
        placeholder={t('procedures.promptPlaceholder')}
        onDone={(value) => {
          setTouched(true)
          setPrompt(value)
          setPromptOpen(false)
        }}
      />
    </Modal>
  )
}
