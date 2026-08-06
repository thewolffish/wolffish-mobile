import { Badge } from '@/components/core/Badge'
import { Button } from '@/components/core/Button'
import { ConfirmDialog } from '@/components/core/ConfirmDialog'
import { Input } from '@/components/core/Input'
import { Modal } from '@/components/core/Modal'
import { Select, type SelectOption } from '@/components/core/Select'
import {
  Delete02Icon,
  Edit02Icon,
  GridViewIcon,
  HelpCircleIcon,
  InformationCircleIcon,
  PlayIcon,
  PlusSignIcon,
  SourceCodeIcon
} from '@/components/core/icons'
import { PanelScreen } from '@/components/settings/SettingsUI'
import { DEFAULT_PROJECT_ICON } from '@/components/workspace/ProjectDialog'
import { DialogError, PromptPreview, PromptSheet } from '@/components/workspace/PromptSheet'
import { EmojiPicker } from '@/components/workspace/EmojiPicker'
import { ModePills } from '@/components/workspace/ModePills'
import {
  attachJobs,
  chipSchedule,
  CHIP_KINDS,
  deleteBlock,
  DEFAULT_AUTOMATION_ICON,
  findBlock,
  GUIDE_ROWS,
  nextCronMs,
  orderAutomations,
  parseAutomations,
  parseSchedule,
  setBlockMode,
  toggleBlock,
  writeDraft,
  type AutomationBlock,
  type BoundBlock
} from '@/lib/automations/heartbeat'
import { editAutomations, runAutomation, useAutomations } from '@/lib/sync/automations'
import { useProjects, useProjectsWritable } from '@/lib/sync/projects'
import { cn } from '@/lib/utils/cn'
import { formatAbsoluteMoment, formatSignedRelative } from '@/lib/utils/relativeTime'
import { useLocale } from '@/providers/locale/useLocale'
import { useToast } from '@/providers/toast/useToast'
import { useConfigValue } from '@/state/demoConfig'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'

/**
 * Automations — the desktop's Automations page on one column.
 *
 * The store is a markdown file, so both views the desktop offers are here: the
 * CARDS, which is what the file means, and the MARKDOWN, which is what the file
 * is. Every card action (switch on/off, change mode, delete, save the editor) is
 * a splice of that one file, and all of the splicing lives in
 * lib/automations/heartbeat.ts — a direct port of the desktop's own, so the two
 * screens can never write the file in incompatible ways.
 *
 * What the desktop uniquely knows is WHEN each active automation fires: the
 * scheduler runs on that machine, against that clock. So the next-run moment is
 * served, never computed here — except in the editor's preview of a schedule
 * that has not been saved yet, which has no desktop answer to ask for.
 */
export default function AutomationsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const toast = useToast()
  const { data, isLoading, refetch } = useAutomations()
  const { data: projects = [] } = useProjects()
  const writable = useProjectsWritable()
  const globalMode = useConfigValue('chatMode')

  const [view, setView] = useState<'cards' | 'markdown'>('cards')
  const [editorFor, setEditorFor] = useState<AutomationBlock | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AutomationBlock | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [fileOpen, setFileOpen] = useState(false)

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

  const markdown = data?.markdown ?? ''
  const blocks = useMemo(
    () => orderAutomations(attachJobs(parseAutomations(markdown), data?.jobs ?? [])),
    [markdown, data?.jobs]
  )
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  /**
   * Which automations are busy, keyed by heading label — the page's identity for
   * one. A running or queued automation's play button is disabled with a note:
   * pressing it again would only coalesce into the pending run.
   */
  const busyByLabel = useMemo(() => {
    const map = new Map<string, 'running' | 'queued'>()
    for (const run of data?.runs.running ?? []) map.set(run.label, 'running')
    for (const run of data?.runs.queued ?? []) if (!map.has(run.label)) map.set(run.label, 'queued')
    return map
  }, [data?.runs])

  /**
   * Card emoji: a project-bound automation wears its PROJECT's emoji; an unbound
   * one wears its own `icon:` marker, else the screen default.
   */
  const cardIcon = useCallback(
    (block: AutomationBlock): string =>
      (block.project ? projectsById.get(block.project)?.icon : undefined) ||
      block.icon ||
      DEFAULT_AUTOMATION_ICON,
    [projectsById]
  )

  /**
   * Every file edit funnels through here so one failure message covers them all
   * and every splice re-locates its block in the file as it stands right now —
   * the indices on a card were parsed from whatever the last read returned.
   */
  const applyEdit = useCallback(
    async (edit: (markdown: string) => string | null): Promise<boolean> => {
      try {
        const result = await editAutomations(edit)
        return result !== null
      } catch {
        toast.show({ tone: 'error', message: t('workspace.saveError') })
        return false
      }
    },
    [t, toast]
  )

  const relocate = useCallback(
    (block: AutomationBlock, apply: (md: string, fresh: AutomationBlock) => string) =>
      applyEdit((md) => {
        const fresh = findBlock(md, { label: block.label, active: block.active })
        // The automation is gone — edited away from the other screen while this
        // card sat here. Abandoning is right: there is nothing to act on, and
        // the push that removed it is already on its way to this list.
        if (!fresh) return null
        return apply(md, fresh)
      }),
    [applyEdit]
  )

  const handleToggle = useCallback(
    (block: AutomationBlock): void => {
      void relocate(block, (md, fresh) => toggleBlock(md, fresh))
    },
    [relocate]
  )

  const handleSetMode = useCallback(
    (block: AutomationBlock, mode: 'single' | 'workflow'): void => {
      if (block.mode === mode) return
      void relocate(block, (md, fresh) => setBlockMode(md, fresh, mode))
    },
    [relocate]
  )

  const handleDelete = useCallback((): void => {
    const target = deleteTarget
    if (!target || deleting) return
    setDeleting(true)
    void relocate(target, (md, fresh) => deleteBlock(md, fresh))
      .then((ok) => {
        setDeleteTarget(null)
        if (ok) toast.show({ tone: 'success', message: t('heartbeat.deleteSuccess') })
      })
      .finally(() => setDeleting(false))
  }, [deleteTarget, deleting, relocate, t, toast])

  const handleRun = useCallback(
    (block: AutomationBlock): void => {
      void runAutomation(block.label)
        .then((result) => {
          if (result.started) toast.show({ tone: 'success', message: t('heartbeat.runStarted') })
          else if (result.ok) toast.show({ tone: 'info', message: t('heartbeat.runQueued') })
          else toast.show({ tone: 'error', message: t('heartbeat.runError') })
        })
        .catch(() => toast.show({ tone: 'error', message: t('heartbeat.runError') }))
    },
    [t, toast]
  )

  /**
   * The meta line, in the desktop's order: schedule (or its next run), the bound
   * project, the last edit. A switched-off automation says only that — it never
   * fires, so a next run would be a lie.
   */
  const metaLine = useCallback(
    (block: AutomationBlock): string => {
      // The desktop's own scheduler answers first (attachJobs). With nobody to
      // ask — demo mode, where the heartbeat comes from the config snapshot and
      // no scheduler is running anywhere — resolve the moment from the cron on
      // this device's clock, exactly as the editor's preview does below. That
      // is what keeps a bundled automation showing a live next fire instead of
      // a timestamp baked at build time, which would read as a run in the past.
      const nextRunMs = block.nextRunMs ?? (block.cron ? nextCronMs(block.cron, now) : null)
      const schedule = !block.active
        ? t('heartbeat.inactive')
        : block.type === 'startup'
          ? t('heartbeat.onLaunch')
          : nextRunMs != null
            ? `${t('heartbeat.nextRun', { time: formatSignedRelative(nextRunMs, now, t) })} · ${formatAbsoluteMoment(nextRunMs, locale)}`
            : t('heartbeat.active')
      const parts = [schedule]
      const project = block.project ? projectsById.get(block.project) : undefined
      if (project) parts.push(project.title.trim() || t('projects.untitled'))
      const edited = data?.stamps[block.label]
      if (edited != null) {
        parts.push(t('heartbeat.editedAt', { time: formatSignedRelative(edited, now, t) }))
      }
      return parts.join(' · ')
    },
    [data?.stamps, locale, now, projectsById, t]
  )

  return (
    <PanelScreen title={t('heartbeat.title')} subtitle={t('heartbeat.subtitle')}>
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <Text className="text-fg font-sans-semibold text-left text-base">
            {t('heartbeat.title')}
          </Text>
          {!isLoading && <Badge label={String(blocks.length)} />}
          {/* Cards ↔ markdown, the desktop's own pair of icons: the file is the
              store, so being able to read and edit it directly is not a power
              feature here, it is the store. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              view === 'cards' ? t('heartbeat.markdownMode') : t('heartbeat.cardsMode')
            }
            hitSlop={6}
            onPress={() => setView((v) => (v === 'cards' ? 'markdown' : 'cards'))}
            className="h-8 w-8 items-center justify-center rounded-lg active:bg-border/40"
          >
            {view === 'cards' ? (
              <SourceCodeIcon size={16} className="text-muted" />
            ) : (
              <GridViewIcon size={16} className="text-muted" />
            )}
          </Pressable>
        </View>
        {view === 'cards' && (
          <Button
            size="sm"
            disabled={!writable}
            onPress={() => setCreating(true)}
            className="shrink-0"
          >
            <PlusSignIcon size={14} className="text-primary-fg" />
            {t('heartbeat.new')}
          </Button>
        )}
      </View>

      {isLoading ? (
        <Text className="text-muted py-10 text-center font-sans text-sm">
          {t('common.loading')}
        </Text>
      ) : view === 'markdown' ? (
        <View className="flex-col gap-2">
          <View className="flex-row items-center justify-between gap-2">
            <Text
              style={{ writingDirection: 'ltr' }}
              className="text-fg font-sans-medium text-left text-sm"
            >
              heartbeat.md
            </Text>
            {writable && (
              <Button variant="outline" size="sm" onPress={() => setFileOpen(true)}>
                {t('heartbeat.edit')}
              </Button>
            )}
          </View>
          {/* The file itself, in the same recessed mono block the prompts use —
              tall, because this is the whole store rather than one prompt. */}
          <PromptPreview
            value={markdown}
            empty={t('heartbeat.empty')}
            maxHeight={420}
            onPress={writable ? () => setFileOpen(true) : undefined}
          />
        </View>
      ) : blocks.length === 0 ? (
        <View className="border-border rounded-2xl border border-dashed px-6 py-12">
          <Text className="text-muted text-center font-sans text-sm">{t('heartbeat.empty')}</Text>
        </View>
      ) : (
        <View className="flex-col gap-3">
          {blocks.map((block) => {
            const busy = block.active ? busyByLabel.get(block.label) : undefined
            return (
              <View
                key={block.label}
                className={cn(
                  'bg-surface border-border flex-col gap-2.5 rounded-2xl border px-4 py-3',
                  !block.active && 'opacity-60'
                )}
              >
                <View className="flex-row items-start justify-between gap-3">
                  <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                    <Text className="text-2xl leading-7">{cardIcon(block)}</Text>
                    <View className="min-w-0 flex-1 flex-col gap-1">
                      {/* The heading is the schedule syntax — LTR technical
                          text, even in Arabic. */}
                      <Text
                        numberOfLines={1}
                        style={{ writingDirection: 'ltr' }}
                        className="text-fg font-sans-medium text-left text-sm"
                      >
                        {block.label}
                      </Text>
                      <View className="flex-row">
                        <Badge label={t(`heartbeat.type.${block.type}`)} variant="primary" />
                      </View>
                    </View>
                  </View>
                  <View className="shrink-0 flex-row items-center">
                    {block.active && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('heartbeat.run')}
                        hitSlop={6}
                        disabled={!!busy || !writable}
                        onPress={() => handleRun(block)}
                        className={cn(
                          'h-8 w-8 items-center justify-center rounded-lg',
                          busy || !writable ? 'opacity-40' : 'active:bg-border/40'
                        )}
                      >
                        <PlayIcon size={17} className="text-muted" />
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('heartbeat.edit')}
                      hitSlop={6}
                      onPress={() => setEditorFor(block)}
                      className="h-8 w-8 items-center justify-center rounded-lg active:bg-border/40"
                    >
                      <Edit02Icon size={15} className="text-muted" />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('heartbeat.delete')}
                      hitSlop={6}
                      disabled={!writable}
                      onPress={() => setDeleteTarget(block)}
                      className={cn(
                        'h-8 w-8 items-center justify-center rounded-lg',
                        writable ? 'active:bg-border/40' : 'opacity-40'
                      )}
                    >
                      <Delete02Icon size={15} className="text-muted" />
                    </Pressable>
                  </View>
                </View>

                {/* On/off and the run mode, the desktop's two segmented pills.
                    End-aligned above the schedule line: they are settings for
                    this automation, so they sit with the action cluster's edge
                    rather than starting a new column under the emoji. RN mirrors
                    `justify-end` with the writing direction, so this is the right
                    edge in English and the left one in Arabic. */}
                <View className="flex-row flex-wrap items-center justify-end gap-2">
                  <OnOffPills
                    active={block.active}
                    disabled={!writable}
                    onChange={() => handleToggle(block)}
                  />
                  <ModePills
                    value={block.mode ?? globalMode}
                    disabled={!writable}
                    onChange={(mode) => handleSetMode(block, mode)}
                  />
                </View>

                <Text className="text-muted text-left font-sans text-xs">{metaLine(block)}</Text>

                {busy && (
                  <View className="flex-row items-center gap-1.5">
                    <InformationCircleIcon
                      size={13}
                      className={busy === 'running' ? 'text-emerald-500' : 'text-amber-500'}
                    />
                    <Text
                      numberOfLines={1}
                      className={cn(
                        'flex-1 text-left font-sans text-xs',
                        busy === 'running' ? 'text-emerald-500' : 'text-amber-500'
                      )}
                    >
                      {t(busy === 'running' ? 'heartbeat.noteRunning' : 'heartbeat.noteQueued')}
                    </Text>
                  </View>
                )}

                <PromptPreview value={block.body} empty={t('heartbeat.promptEmpty')} />
              </View>
            )
          })}
        </View>
      )}

      {(editorFor !== null || creating) && (
        <AutomationEditor
          block={editorFor}
          blocks={blocks}
          projects={projects}
          onOpenGuide={() => setGuideOpen(true)}
          guideOpen={guideOpen}
          onClose={() => {
            setEditorFor(null)
            setCreating(false)
          }}
        />
      )}

      <ScheduleGuide open={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* The whole file in the expanded editor. Saved as one write, exactly as
          the desktop's markdown view saves it. */}
      <PromptSheet
        open={fileOpen}
        title="heartbeat.md"
        initialValue={markdown}
        onDone={(value) => {
          setFileOpen(false)
          if (value === markdown) return
          void applyEdit(() => value)
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('heartbeat.deleteTitle')}
        message={t('heartbeat.deleteWarning', { name: deleteTarget?.label ?? '' })}
        confirmLabel={deleting ? t('heartbeat.deleting') : t('heartbeat.deleteConfirm')}
        cancelLabel={t('heartbeat.deleteCancel')}
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </PanelScreen>
  )
}

/** On | Off, the desktop's first pill. Either segment switches the automation. */
function OnOffPills({
  active,
  disabled,
  onChange
}: {
  active: boolean
  disabled?: boolean
  onChange: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <View
      accessibilityRole="tablist"
      className={cn(
        'border-border bg-bg flex-row items-center self-start rounded-lg border p-0.5',
        disabled && 'opacity-60'
      )}
    >
      {[true, false].map((on) => {
        const selected = on === active
        return (
          <Pressable
            key={String(on)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            disabled={disabled || selected}
            onPress={onChange}
            className={cn('rounded-md px-2 py-1', selected && 'bg-primary')}
          >
            <Text
              className={cn(
                'font-sans-medium text-[10px]',
                selected ? 'text-primary-fg' : 'text-muted'
              )}
            >
              {t(on ? 'settings.toggle.on' : 'settings.toggle.off')}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const NO_PROJECT = ''

/**
 * The automation editor — schedule, emoji, project and prompt.
 *
 * Autosaves ~600 ms after the last change, but ONLY while the draft is actually
 * saveable: schedule recognized, no label collision, prompt present. An invalid
 * draft is never written, so closing keeps the last saved state. The desktop's
 * exact contract, including the label-collision guard — the heading IS the
 * automation's identity, and a second one with the same heading would collide in
 * the scheduler.
 */
function AutomationEditor({
  block,
  blocks,
  projects,
  guideOpen,
  onOpenGuide,
  onClose
}: {
  /** Null ⇒ creating. */
  block: AutomationBlock | null
  blocks: AutomationBlock[]
  projects: Array<{ id: string; title: string; icon: string }>
  guideOpen: boolean
  onOpenGuide: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  // Reported inline rather than as a toast — see DialogError.
  const [error, setError] = useState<string | null>(null)

  const [schedule, setSchedule] = useState(block?.label ?? chipSchedule('daily'))
  const [prompt, setPrompt] = useState(block?.body ?? '')
  const [icon, setIcon] = useState(block?.icon ?? '')
  const [projectId, setProjectId] = useState(block?.project ?? NO_PROJECT)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)

  /**
   * The persisted block's identity. It MOVES as the label is edited across
   * autosaves, which is what lets the next save find the block the previous one
   * wrote instead of inserting a second copy.
   */
  const boundRef = useRef<BoundBlock | null>(
    block ? { label: block.label, active: block.active } : null
  )
  const [boundLabel, setBoundLabel] = useState<string | null>(block?.label ?? null)
  const savedRef = useRef({
    schedule: block?.label ?? '',
    prompt: block?.body ?? '',
    icon: block?.icon ?? '',
    projectId: block?.project ?? NO_PROJECT
  })

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const trimmed = schedule.trim()
  const parsed = useMemo(() => parseSchedule(trimmed), [trimmed])
  const duplicate =
    trimmed !== '' &&
    blocks.some(
      (b) =>
        b.label.toLowerCase() === trimmed.toLowerCase() &&
        b.label.toLowerCase() !== (boundLabel?.toLowerCase() ?? '')
    )
  const invalid = parsed === null || duplicate

  /**
   * Errors paint late, validity paints now. Mid-edit keystrokes pass through
   * invalid states ("Daily (09:3" on the way to "Daily (09:30)") and turning the
   * field red for each one reads as flicker, so the red state waits out a typing
   * pause. Display only — the autosave gate below reads the raw validity.
   */
  const [heldInvalid, setHeldInvalid] = useState(false)
  useEffect(() => {
    if (!invalid) {
      setHeldInvalid(false)
      return
    }
    const handle = setTimeout(() => setHeldInvalid(true), 600)
    return () => clearTimeout(handle)
  }, [invalid, trimmed])
  const showError = invalid && heldInvalid

  // While the error is held back, the preview keeps the last parseable draft —
  // swapping to blank and back would be its own flash.
  const [lastParsed, setLastParsed] = useState(parsed)
  useEffect(() => {
    if (parsed) setLastParsed(parsed)
  }, [parsed])
  const preview = parsed ?? lastParsed
  const previewMs = preview
    ? (preview.atMs ?? (preview.cron ? nextCronMs(preview.cron, now) : null))
    : null

  const boundProject = projectId ? projects.find((p) => p.id === projectId) : undefined

  const persist = useCallback(
    (draft: { schedule: string; prompt: string; icon: string; projectId: string }): void => {
      savedRef.current = draft
      const bound = boundRef.current
      // The binding must move in the SAME tick the write is dispatched: the
      // duplicate check excludes the draft's own block only through boundLabel,
      // and updating it after the await paints a spurious "duplicate" while the
      // write is in flight.
      boundRef.current = { label: draft.schedule, active: bound?.active ?? true }
      setBoundLabel(draft.schedule)
      setError(null)
      void editAutomations((markdown) => {
        const result = writeDraft(markdown, bound, draft)
        boundRef.current = result.bound
        return result.markdown
      }).catch(() => setError(t('workspace.saveError')))
    },
    [t]
  )

  useEffect(() => {
    if (invalid || prompt.trim() === '') return
    const saved = savedRef.current
    if (
      trimmed === saved.schedule &&
      prompt === saved.prompt &&
      icon === saved.icon &&
      projectId === saved.projectId
    ) {
      return
    }
    const handle = setTimeout(() => persist({ schedule: trimmed, prompt, icon, projectId }), 600)
    return () => clearTimeout(handle)
  }, [invalid, trimmed, prompt, icon, projectId, persist])

  const close = useCallback((): void => {
    // Flush whatever the debounce has not dispatched.
    const saved = savedRef.current
    if (
      !invalid &&
      prompt.trim() !== '' &&
      (trimmed !== saved.schedule ||
        prompt !== saved.prompt ||
        icon !== saved.icon ||
        projectId !== saved.projectId)
    ) {
      persist({ schedule: trimmed, prompt, icon, projectId })
    }
    onClose()
  }, [invalid, trimmed, prompt, icon, projectId, persist, onClose])

  const options = useMemo<readonly SelectOption<string>[]>(
    () => [
      { value: NO_PROJECT, label: t('heartbeat.editor.projectNone') },
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
      // Escape/backdrop must only close whatever is stacked on top.
      dismissable={!emojiOpen && !promptOpen && !guideOpen}
      title={block ? t('heartbeat.editor.editTitle') : t('heartbeat.editor.createTitle')}
      footer={
        <View className="flex-row justify-end">
          <Button size="sm" onPress={close}>
            {t('heartbeat.editor.done')}
          </Button>
        </View>
      }
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-muted font-sans-medium text-left text-sm">
          {t('heartbeat.editor.schedule')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('heartbeat.editor.guideButton')}
          hitSlop={6}
          onPress={onOpenGuide}
          className="h-7 w-7 items-center justify-center rounded-md active:bg-border/40"
        >
          <HelpCircleIcon size={15} className="text-muted" />
        </Pressable>
      </View>

      {/* The chips fill in a correct schedule anchored on now, so the preview
          line below immediately confirms the pick. */}
      <View className="flex-row flex-wrap gap-1.5">
        {CHIP_KINDS.map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            onPress={() => setSchedule(chipSchedule(kind))}
            className="border-border bg-bg rounded-full border px-2.5 py-1 active:bg-border/40"
          >
            <Text className="text-muted font-sans text-xs">
              {t(`heartbeat.editor.chips.${kind}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="flex-row items-start gap-2">
        {/* A project-bound automation wears the project's emoji — the button
            shows it and disables; its own icon returns when the binding goes. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            boundProject ? t('heartbeat.editor.projectIcon') : t('heartbeat.editor.pickIcon')
          }
          disabled={boundProject !== undefined}
          onPress={() => setEmojiOpen(true)}
          className="bg-bg border-border h-10 w-10 shrink-0 items-center justify-center rounded-lg border active:bg-border/40"
        >
          <Text className="text-lg">
            {boundProject
              ? boundProject.icon || DEFAULT_PROJECT_ICON
              : icon || DEFAULT_AUTOMATION_ICON}
          </Text>
        </Pressable>
        <View className="min-w-0 flex-1">
          <Input
            value={schedule}
            onChangeText={setSchedule}
            placeholder="Daily (09:00)"
            autoCapitalize="words"
            autoCorrect={false}
            // The schedule is the file's own syntax: LTR and monospaced in
            // either locale, like every other technical value in the app.
            style={{ writingDirection: 'ltr' }}
            className={cn('font-mono', showError && 'border-rose-500/70')}
          />
        </View>
      </View>

      {showError || preview === null ? (
        parsed === null ? (
          <Pressable accessibilityRole="button" onPress={onOpenGuide}>
            <Text className="text-left font-sans text-xs text-rose-500">
              {`${t('heartbeat.editor.invalid')} ${t('heartbeat.editor.guideButton')}`}
            </Text>
          </Pressable>
        ) : (
          <Text className="text-left font-sans text-xs text-rose-500">
            {t('heartbeat.editor.duplicate')}
          </Text>
        )
      ) : preview.type === 'startup' ? (
        <Text className="text-muted text-left font-sans text-xs">{t('heartbeat.onLaunch')}</Text>
      ) : preview.atMs != null && preview.atMs <= now ? (
        <Text className="text-left font-sans text-xs text-amber-500">
          {t('heartbeat.editor.pastOnce')}
        </Text>
      ) : previewMs != null ? (
        <Text className="text-muted text-left font-sans text-xs">
          {`${t('heartbeat.nextRun', { time: formatSignedRelative(previewMs, now, t) })} · ${formatAbsoluteMoment(previewMs, locale)}`}
        </Text>
      ) : (
        <Text className="text-left font-sans text-xs text-amber-500">
          {t('heartbeat.editor.cronUnknown')}
        </Text>
      )}

      <Select<string>
        label={t('heartbeat.editor.project')}
        value={projectId}
        options={options}
        onChange={(value) => {
          setProjectId(value)
          setEmojiOpen(false)
        }}
      />

      <View className="flex-col gap-1.5">
        <Text className="text-muted font-sans-medium text-left text-sm">
          {t('heartbeat.editor.prompt')}
        </Text>
        <PromptPreview
          value={prompt}
          empty={t('heartbeat.promptEmpty')}
          maxHeight={140}
          onPress={() => setPromptOpen(true)}
        />
        <Button variant="outline" size="sm" onPress={() => setPromptOpen(true)}>
          {prompt.trim() ? t('procedures.editPrompt') : t('procedures.addPrompt')}
        </Button>
      </View>

      <DialogError message={error} />
      <Text className="text-muted text-left font-sans text-xs">
        {t('heartbeat.editor.autosaveHint')}
      </Text>

      <EmojiPicker
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onPick={(emoji) => {
          setIcon(emoji)
          setEmojiOpen(false)
        }}
      />
      <PromptSheet
        open={promptOpen}
        title={t('heartbeat.editor.prompt')}
        initialValue={prompt}
        placeholder={t('heartbeat.editor.promptPlaceholder')}
        onDone={(value) => {
          setPrompt(value)
          setPromptOpen(false)
        }}
      />
    </Modal>
  )
}

/** The schedule forms, verbatim from the desktop's guide dialog. */
function ScheduleGuide({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { height } = useWindowDimensions()
  return (
    <Modal open={open} onClose={onClose} title={t('heartbeat.guide.title')}>
      <Text className="text-muted text-left font-sans text-sm leading-relaxed">
        {t('heartbeat.guide.intro')}
      </Text>
      <ScrollView
        style={{ maxHeight: Math.round(height * 0.45) }}
        contentContainerStyle={{ gap: 10 }}
        showsVerticalScrollIndicator={false}
      >
        {GUIDE_ROWS.map((row) => (
          <View key={row.key} className="flex-col gap-1">
            <View className="bg-bg border-border rounded-lg border px-2.5 py-1.5">
              <Text
                selectable
                style={{ writingDirection: 'ltr' }}
                className="text-fg text-left font-mono text-xs"
              >
                {row.code}
              </Text>
            </View>
            <Text className="text-muted px-0.5 text-left font-sans text-xs leading-relaxed">
              {t(`heartbeat.guide.${row.key}`)}
            </Text>
          </View>
        ))}
      </ScrollView>
      <Text className="text-muted text-left font-sans text-xs leading-relaxed">
        {t('heartbeat.guide.localTime')}
      </Text>
      <Text className="text-muted text-left font-sans text-xs leading-relaxed">
        {t('heartbeat.guide.chipsTip')}
      </Text>
    </Modal>
  )
}
