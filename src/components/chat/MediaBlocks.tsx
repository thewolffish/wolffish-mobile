import { PauseIcon, PlayIcon, Upload01Icon } from '@/components/core/icons'
import { ExpandedSheet } from '@/components/core/ExpandedSheet'
import { fileName, formatBytes } from '@/lib/files/fileKinds'
import { useWorkspaceFile } from '@/lib/files/useWorkspaceFile'
import { cn } from '@/lib/utils/cn'
import { useTokens } from '@/providers/theme/useTheme'
import { useEvent } from 'expo'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from 'react-native'
import { IconAction, MissingCard, shareFile, type Align } from './FileChrome'

/**
 * Media renderers — the mobile counterparts of the desktop's ImageViewer /
 * AudioPlayer / VideoPlayer. Every file resolves through the workspace cache;
 * a pruned or unpushed file renders its per-type "deleted/unavailable" state,
 * exactly like the desktop's missing-file cards.
 *
 * Images and video expand to full screen, mirroring the desktop's click-to-
 * zoom lightbox and the video element's fullscreen control.
 */

const THUMB_WIDTH = 260
const THUMB_HEIGHT = 200

/** Shape of the video card until the track's natural size lands — desktop's loading aspect. */
const DEFAULT_VIDEO_ASPECT = 16 / 9
/** The mobile reading of the desktop player's `max-height: 60vh`. */
const VIDEO_MAX_HEIGHT_FRACTION = 0.6

export function ImageBlock({
  relPath,
  conversationId,
  align = 'start',
  sizeBytes,
  displayName
}: {
  relPath: string
  conversationId?: string
  align?: Align
  sizeBytes?: number
  displayName?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { uri, loading, missing } = useWorkspaceFile(relPath, conversationId)
  const name = displayName ?? fileName(relPath)

  if (loading) {
    return (
      <View
        className={cn(
          'bg-surface border-border h-40 w-56 items-center justify-center rounded-2xl border',
          align === 'end' ? 'self-end' : 'self-start'
        )}
      >
        <ActivityIndicator />
      </View>
    )
  }
  if (missing || !uri) return <MissingCard label={t('chat.imageViewer.deleted')} align={align} />

  return (
    <View className={align === 'end' ? 'self-end' : 'self-start'}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={name}
        onPress={() => setOpen(true)}
        onLongPress={() => shareFile(uri)}
      >
        {/* The pressable carries the label — a nested one would double it. */}
        <Image
          source={{ uri }}
          contentFit="cover"
          style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: 16 }}
        />
      </Pressable>
      <ExpandedSheet
        open={open}
        onClose={() => setOpen(false)}
        title={name}
        actions={
          <IconAction
            label={t('chat.fileCard.share')}
            icon={<Upload01Icon size={16} className="text-muted" />}
            onPress={() => shareFile(uri)}
          />
        }
      >
        <View className="flex-1 items-center justify-center bg-black">
          {/* contain + full bleed: the whole image at the largest size that fits. */}
          <Image
            source={{ uri }}
            contentFit="contain"
            style={{ width: '100%', height: '100%' }}
            accessibilityLabel={name}
          />
        </View>
        {sizeBytes ? (
          <Text className="text-muted p-2 text-center font-sans text-[10px]">
            {formatBytes(sizeBytes)}
          </Text>
        ) : null}
      </ExpandedSheet>
    </View>
  )
}

export function VideoBlock({
  relPath,
  conversationId,
  align = 'start',
  displayName,
  fallback
}: {
  relPath: string
  conversationId?: string
  align?: Align
  displayName?: string
  /** Shown when the platform's decoder can't play this container (e.g. .webm on iOS). */
  fallback?: React.JSX.Element
}): React.JSX.Element {
  const { t } = useTranslation()
  const { uri, loading, missing } = useWorkspaceFile(relPath, conversationId)
  // The player must be created unconditionally (hook order); a null source is
  // legal and simply leaves the view idle until the cache resolves.
  const player = useVideoPlayer(uri ?? null, (instance) => {
    instance.loop = false
  })
  // A container the device cannot decode (Ogg/WebM on iOS, say) fails at load
  // time, not at classify time — the only honest signal is the player's own
  // status, so a dead black box degrades to the openable file card.
  const { status } = useEvent(player, 'statusChange', { status: player.status })
  // The natural size arrives with the track, not with the source, so the card
  // holds a 16/9 shape until then and re-lays out once the decoder reports in.
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack })
  const size = videoTrack?.size
  const aspectRatio = size?.width && size?.height ? size.width / size.height : DEFAULT_VIDEO_ASPECT
  const { height: windowHeight } = useWindowDimensions()
  const name = displayName ?? fileName(relPath)

  if (loading) {
    return (
      <View
        className={cn(
          'bg-surface border-border w-[85%] items-center justify-center rounded-2xl border',
          align === 'end' ? 'self-end' : 'self-start'
        )}
        // Same footprint the loaded card starts at, so resolving the cache
        // doesn't jog the transcript sideways.
        style={{ aspectRatio: DEFAULT_VIDEO_ASPECT }}
      >
        <ActivityIndicator />
      </View>
    )
  }
  if (missing || !uri) return <MissingCard label={t('chat.videoPlayer.deleted')} align={align} />
  if (status === 'error' && fallback) return fallback

  return (
    <View
      className={cn(
        'bg-surface border-border w-[85%] overflow-hidden rounded-2xl border',
        align === 'end' ? 'self-end' : 'self-start'
      )}
    >
      {/* Native controls carry play/scrub/fullscreen — the platform's own
          video affordances, and the mobile answer to the desktop <video>.
          The card's width is the constraint; the video's own ratio sets the
          height, so a landscape clip carries no letterbox bars. */}
      <VideoView
        player={player}
        style={{
          width: '100%',
          aspectRatio,
          maxHeight: windowHeight * VIDEO_MAX_HEIGHT_FRACTION,
          // A portrait clip hits the height cap, and Yoga then narrows the view
          // to keep the ratio — centred, so the leftover sits evenly either side
          // instead of pushing the video against the card's leading edge.
          alignSelf: 'center',
          backgroundColor: 'black'
        }}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
        accessibilityLabel={name}
      />
      <View className="flex-row items-center gap-2 px-3 py-2">
        <Text
          numberOfLines={1}
          className="text-muted font-sans min-w-0 flex-1 text-left text-[11px]"
        >
          {name}
        </Text>
        <IconAction
          label={t('chat.fileCard.share')}
          icon={<Upload01Icon size={14} className="text-muted" />}
          onPress={() => shareFile(uri)}
        />
      </View>
    </View>
  )
}

export function AudioBlock({
  relPath,
  conversationId,
  align = 'start',
  displayName
}: {
  relPath: string
  conversationId?: string
  align?: Align
  displayName?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const tokens = useTokens()
  const { uri, loading, missing } = useWorkspaceFile(relPath, conversationId)
  const player = useAudioPlayer(uri ?? undefined)
  const status = useAudioPlayerStatus(player)

  if (loading) {
    return (
      <View
        className={cn(
          'bg-surface border-border h-14 w-[85%] items-center justify-center rounded-xl border',
          align === 'end' ? 'self-end' : 'self-start'
        )}
      >
        <ActivityIndicator />
      </View>
    )
  }
  if (missing || !uri) return <MissingCard label={t('chat.audioPlayer.deleted')} align={align} />

  const playing = status.playing
  const duration = status.duration ?? 0
  const position = status.currentTime ?? 0
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0
  const mmss = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  return (
    <View
      className={cn(
        // w-[85%] is CardShell's width — the transport lines up with every
        // other file card in the feed instead of sitting short of them.
        'bg-surface border-border w-[85%] flex-row items-center gap-3 rounded-xl border px-3 py-2.5',
        align === 'end' ? 'self-end' : 'self-start'
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? t('chat.stop') : t('chat.send')}
        onPress={() => {
          if (playing) {
            player.pause()
          } else {
            if (status.didJustFinish || (duration > 0 && position >= duration)) {
              player.seekTo(0)
            }
            player.play()
          }
        }}
        className="bg-primary h-9 w-9 items-center justify-center rounded-full active:opacity-90"
      >
        {playing ? (
          <PauseIcon size={16} color={tokens.primaryFg} />
        ) : (
          <PlayIcon size={16} color={tokens.primaryFg} />
        )}
      </Pressable>
      <View className="flex-1 flex-col gap-1.5">
        <Text numberOfLines={1} className="text-fg font-sans-medium text-left text-xs">
          {displayName ?? fileName(relPath)}
        </Text>
        <View className="bg-border h-1 w-full overflow-hidden rounded-full">
          <View className="bg-primary h-full" style={{ width: `${progress * 100}%` }} />
        </View>
        <Text className="text-muted text-left font-sans text-[10px]">
          {mmss(position)} / {mmss(duration)}
        </Text>
      </View>
      {/* Same share affordance the video card carries, on the trailing edge so
          the transport keeps its shape. */}
      <IconAction
        label={t('chat.fileCard.share')}
        icon={<Upload01Icon size={14} className="text-muted" />}
        onPress={() => shareFile(uri)}
      />
    </View>
  )
}
