import { useEvent } from 'expo';
import { useVideoPlayer } from 'expo-video';

export type PreviewPlayer = ReturnType<typeof useVideoPlayer>;

export interface PreviewPlayerState {
  player: PreviewPlayer;
  seekTo: (seconds: number) => void;
  currentTime: number;
  duration: number;
  srcSize: { width: number; height: number } | null;
  status: string;
}

/**
 * Creates the looping video player for the preview screen and exposes the
 * derived playback values (current time, duration, source size, status).
 */
export function usePreviewPlayer(videoUri: string | undefined): PreviewPlayerState {
  const player = useVideoPlayer(videoUri ?? null, (instance) => {
    instance.loop = true;
    instance.timeUpdateEventInterval = 0.25;
    instance.play();
  });

  const timeUpdate = useEvent(player, 'timeUpdate');
  const currentTime = timeUpdate?.currentTime ?? 0;
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  const duration = player.duration > 0 ? player.duration : 0;
  const srcSize = videoTrack?.size ?? null;

  const seekTo = (seconds: number) => {
    player.seekBy(seconds - currentTime);
  };

  return { player, seekTo, currentTime, duration, srcSize, status };
}
