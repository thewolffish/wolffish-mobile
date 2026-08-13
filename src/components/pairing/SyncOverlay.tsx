import { BlockingProgress } from '@/components/common/BlockingProgress'
import { RefreshIcon } from '@/components/core/icons'
import { getSyncActivity, onSyncActivity, type SyncActivity } from '@/lib/sync/activity'
import { useAppStore } from '@/state/appStore'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shown while a catch-up is taking long enough to be worth mentioning.
 *
 * Syncing is meant to be invisible, and nearly always is: an unchanged
 * desktop answers an incremental pull with an empty list in milliseconds.
 * The exception is the expensive one — a first open of the day, a workspace
 * that moved a lot, a slow network — where the list sits there looking
 * finished while the phone is still working. Nothing is worse than a screen
 * that gives no sign of it, so past a threshold this says what is happening
 * and how far along it is.
 *
 * The threshold IS the design: below it nothing appears, which keeps the
 * ordinary case exactly as silent as it was.
 */
const APPEAR_AFTER_MS = 800

/** Long enough that a stuck pull cannot hold the app hostage. Shorter than
 *  the reconnect overlay's, because there is nothing to wait for here —
 *  everything already on the phone is readable right now. */
const ESCAPE_AFTER_MS = 3_000

/**
 * Once shown, stay shown this long — even if the sync finished a moment
 * later.
 *
 * A delayed appearance with no floor is the classic flicker: syncs that land
 * just past the threshold paint the dialog for a few frames and rip it away,
 * which reads as a glitch rather than as progress. The pair is what works —
 * the delay hides fast syncs entirely, and the floor makes the ones that do
 * appear legible. The extra time costs nothing, because the work is over and
 * the app underneath is already current.
 */
const MIN_VISIBLE_MS = 700

export function SyncOverlay(): React.JSX.Element | null {
  const { t } = useTranslation()
  const paired = useAppStore((state) => state.paired)
  const [activity, setActivity] = useState<SyncActivity>(getSyncActivity)
  const [visible, setVisible] = useState(false)
  const [escapable, setEscapable] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const appearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const escapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownAt = useRef<number | null>(null)
  /** Kept past the end of the work, so the clock does not jump when the card
   *  is held open through the minimum-visible floor below. */
  const [startedAt, setStartedAt] = useState<number | null>(null)

  useEffect(() => onSyncActivity(setActivity), [])
  useEffect(() => {
    if (activity) setStartedAt(activity.startedAt)
  }, [activity])

  const running = activity !== null

  const clear = (): void => {
    if (appearTimer.current) clearTimeout(appearTimer.current)
    if (escapeTimer.current) clearTimeout(escapeTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    appearTimer.current = null
    escapeTimer.current = null
    hideTimer.current = null
  }

  useEffect(() => {
    if (running && paired) {
      // A new sync while the last one is still winding down keeps the dialog
      // up rather than restarting it.
      if (hideTimer.current) {
        clearTimeout(hideTimer.current)
        hideTimer.current = null
      }
      if (visible || appearTimer.current) return
      appearTimer.current = setTimeout(() => {
        appearTimer.current = null
        shownAt.current = Date.now()
        setVisible(true)
        escapeTimer.current = setTimeout(() => {
          escapeTimer.current = null
          setEscapable(true)
        }, ESCAPE_AFTER_MS)
      }, APPEAR_AFTER_MS)
      return
    }

    // Finished. A dialog that never appeared is simply cancelled.
    if (appearTimer.current) {
      clearTimeout(appearTimer.current)
      appearTimer.current = null
    }
    if (!visible) {
      setEscapable(false)
      // The next slow sync earns its own dialog; a dismissal is about this
      // one, not about every sync from now on.
      setDismissed(false)
      return
    }
    if (hideTimer.current) return
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - (shownAt.current ?? 0)))
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      shownAt.current = null
      setVisible(false)
      setEscapable(false)
      setDismissed(false)
    }, remaining)
  }, [running, paired, visible])

  useEffect(() => clear, [])

  if (!visible || !paired || dismissed) return null

  // Held open past the end of the work: say so honestly — full bar, last
  // step — rather than freezing on whatever was mid-flight. The clock keeps
  // the start it had; the wait it is timing is the one the user sat through.
  const shown = activity ?? { ratio: 1, step: 'wrapping' as const, startedAt }

  return (
    <BlockingProgress
      icon={<RefreshIcon size={22} className="text-primary" />}
      title={t('syncing.title')}
      body={t('syncing.body')}
      ratio={shown.ratio}
      detail={t(`syncing.step.${shown.step}`)}
      since={shown.startedAt}
      escape={
        escapable
          ? {
              label: t('syncing.continue'),
              hint: t('syncing.continueHint'),
              onPress: () => setDismissed(true)
            }
          : undefined
      }
    />
  )
}
