import { attachLiveUpdates, reconcile } from '@/lib/sync/sync'
import { attachTurnStream } from '@/lib/sync/prompt'
import { tunnelClient } from '@/lib/tunnel/client'
import { useAppStore } from '@/state/appStore'
import { useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

/**
 * Keeps the tunnel alive across the app's lifecycle.
 *
 * iOS suspends a backgrounded app within seconds, so the socket dies whenever
 * the user leaves and must be rebuilt when they return. That is the normal
 * cycle, not an error: reconnecting is a fresh handshake in well under a
 * second, and the desktop parks on the relay waiting for exactly this.
 *
 * Two separate jobs, deliberately not fused:
 *
 * Getting connected is the tunnel's own affair. It retries with backoff, times
 * out a dial that hangs, and tears down a socket that has gone quiet — so it
 * keeps working the whole time the app is open, not only at launch. All this
 * hook adds is a nudge past the remaining backoff when the user comes back,
 * because returning to the app is evidence the network probably returned too.
 *
 * Catching up hangs off the *connection*, not off the app opening. Those are
 * not the same moment and conflating them was the bug: foregrounding often
 * finds the network still down, and a catch-up wired to that event alone
 * leaves the phone stale until the next time the user happens to open it.
 * Wired here, every connection that forms — first, tenth, after an hour in a
 * lift — brings the phone level, with nobody watching.
 */
export function useConnection(): void {
  const paired = useAppStore((state) => state.paired)

  useEffect(() => {
    if (!paired) return

    // resume() replaces a tunnel that has stopped trying and nudges one that
    // is merely waiting; either way it is safe to call as often as we like.
    const kick = (): void => {
      void tunnelClient.resume().catch(() => undefined)
    }

    kick()

    const onChange = (next: AppStateStatus): void => {
      if (next !== 'active') return
      // Backgrounding is left alone deliberately: iOS tears the socket down
      // itself, and calling stop() here would cancel the reconnect loop that
      // makes returning instant.
      kick()
      // A brief background can leave the socket intact: iOS suspends JS
      // before the OS gets around to killing the connection, and anything the
      // desktop pushed meanwhile is simply gone. The edge-triggered catch-up
      // below only fires when a connection re-FORMS, so a still-connected
      // return needs its own reconcile or those minutes stay missing until
      // the next reconnect.
      if (tunnelClient.connected) void reconcile().catch(() => undefined)
    }
    const subscription = AppState.addEventListener('change', onChange)

    // Edge-triggered: only the transition into connected, so a burst of
    // status updates cannot start several catch-ups.
    let wasConnected = false
    const off = tunnelClient.subscribe((state) => {
      const isConnected = state.status === 'connected'
      if (isConnected && !wasConnected) {
        // Handlers are stored per topic, so re-attaching replaces rather than
        // stacking — safe on a reconnect that reuses the same tunnel.
        attachLiveUpdates()
        attachTurnStream()
        void reconcile().catch(() => undefined)
      }
      wasConnected = isConnected
    })

    return () => {
      subscription.remove()
      off()
    }
  }, [paired])
}
