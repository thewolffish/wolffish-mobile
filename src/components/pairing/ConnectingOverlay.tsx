import { BlockingProgress } from '@/components/common/BlockingProgress'
import { Activity04Icon } from '@/components/core/icons'
import { tunnelClient } from '@/lib/tunnel/client'
import type { TunnelState } from '@/lib/tunnel/tunnel'
import { useAppStore } from '@/state/appStore'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shown while a paired phone has no live tunnel.
 *
 * The app is a view of the desktop's workspace; without the tunnel it can
 * only show a stale copy and refuse every action. Blocking is the honest
 * response — and having no dismiss is the point, because there is nothing
 * useful behind it and a closable one would just be reopened.
 *
 * Deliberately not shown for a blink. Reconnecting after a background is
 * routine and usually finishes in well under a second; putting a modal in
 * front of that would make a working app feel broken. It waits, and only
 * appears once the delay is long enough that silence would be worse.
 */
const APPEAR_AFTER_MS = 1_200

/**
 * How long before the block becomes a choice.
 *
 * A reconnect that has not landed in a few seconds is not a blink any more —
 * the desktop may be asleep, or the network may be gone for the afternoon —
 * and holding someone hostage to that is worse than letting them read what
 * the phone already has. The tunnel keeps trying either way.
 */
const ESCAPE_AFTER_MS = 5_000

/** Where each phase sits on the bar. Not a measurement — the steps are known
 *  and ordered, so the bar reports which one is running rather than pretending
 *  to time something whose length nobody can know. */
const PHASE_RATIO: Record<string, number> = {
  idle: 0.08,
  reconnecting: 0.2,
  connecting: 0.4,
  'waiting-for-peer': 0.6,
  handshaking: 0.85,
  error: 0.2,
  connected: 1
}

export function ConnectingOverlay(): React.JSX.Element | null {
  const { t } = useTranslation()
  const paired = useAppStore((state) => state.paired)
  const [state, setState] = useState<TunnelState | null>(tunnelClient.state)
  const [visible, setVisible] = useState(false)
  const [escapable, setEscapable] = useState(false)
  // Dismissal lasts until the link genuinely comes back, so the overlay
  // cannot reappear over the app the user just chose to keep using.
  const [dismissed, setDismissed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const escapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => tunnelClient.subscribe(setState), [])

  const connected = state?.status === 'connected'

  useEffect(() => {
    if (!paired || connected) {
      if (timer.current) clearTimeout(timer.current)
      if (escapeTimer.current) clearTimeout(escapeTimer.current)
      timer.current = null
      escapeTimer.current = null
      setVisible(false)
      setEscapable(false)
      // A connection that came back re-arms the block for the next outage.
      if (connected) setDismissed(false)
      return
    }
    if (timer.current || visible) return
    timer.current = setTimeout(() => {
      timer.current = null
      setVisible(true)
      escapeTimer.current = setTimeout(() => {
        escapeTimer.current = null
        setEscapable(true)
      }, ESCAPE_AFTER_MS)
    }, APPEAR_AFTER_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [paired, connected, visible])

  if (!visible || !paired || connected || dismissed) return null

  const status = state?.status ?? 'idle'
  // The relay tells us which side is missing, and that changes what the user
  // should do: their desktop being asleep is not the app being broken.
  const detail =
    status === 'waiting-for-peer'
      ? t('connecting.waitingPeer')
      : status === 'error' || state?.lastError
        ? t('connecting.retrying')
        : t('connecting.dialing')

  return (
    <BlockingProgress
      icon={<Activity04Icon size={22} className="text-primary" />}
      title={t('connecting.title')}
      body={t('connecting.body')}
      ratio={PHASE_RATIO[status] ?? 0.2}
      detail={detail}
      note={state?.reconnects ? t('connecting.attempts', { count: state.reconnects }) : undefined}
      escape={
        escapable
          ? {
              label: t('connecting.continueOffline'),
              hint: t('connecting.offlineHint'),
              onPress: () => setDismissed(true)
            }
          : undefined
      }
    />
  )
}
