/**
 * Fire OS player surface: ExoPlayer through AndroidX Media3.
 *
 * react-native-video's Android backend *is* Media3 ExoPlayer, so this is the library the project
 * asked for rather than a hand-rolled player. The stream is HLS (fMP4, H.264/AAC), which ExoPlayer
 * handles natively, and the CDN's required Referer arrives through the `headers` the backend
 * returns beside the sources. libVLC stays out of the APK: it would be needed only for a codec
 * ExoPlayer cannot decode, and these streams are the most widely supported pair there is.
 */
import React, {useEffect, useMemo, useRef} from 'react';
import Video, {
  SelectedTrackType,
  TextTrackType,
  type ReactVideoSource,
  type VideoRef,
} from 'react-native-video';
import type {PlayerSurfaceProps} from '../../src/player';

export const supportsPlayback = true;

export function PlayerSurface({
  uri,
  headers,
  subtitleUri,
  paused,
  rate = 1,
  seekTo,
  seekId = 0,
  resizeMode = 'contain',
  onProgress,
  onEnded,
  onError,
  style,
}: PlayerSurfaceProps) {
  const ref = useRef<VideoRef>(null);
  const applied = useRef<{uri: string; target: number; id: number} | null>(
    null,
  );
  const duration = useRef(0);
  const clock = useRef(0);
  // Media3 reloads when side-loaded subtitles change. Capture the native position only when
  // source identity changes; normal progress/rate/pause renders must never rebuild the source.
  const source = useMemo<ReactVideoSource>(
    () => ({
      startPosition: Math.round(clock.current * 1000),
      uri,
      ...(headers && Object.keys(headers).length ? {headers} : {}),
      ...(subtitleUri
        ? {
            textTracks: [
              // Media3 accepts BCP-47 'und' (undetermined). The library's ISO639_1 type omits
              // this valid tag; keep it truthful instead of labelling every language English.
              // The backend converts SRT to WebVTT.
              {
                title: 'Subtitles',
                language: 'und' as NonNullable<
                  ReactVideoSource['textTracks']
                >[number]['language'],
                type: TextTrackType.VTT,
                uri: subtitleUri,
              },
            ],
          }
        : {}),
    }),
    [uri, headers, subtitleUri],
  );

  useEffect(() => {
    if (typeof seekTo !== 'number' || !Number.isFinite(seekTo)) return;
    if (
      applied.current?.uri === uri &&
      applied.current.target === seekTo &&
      applied.current.id === seekId
    )
      return;
    applied.current = {uri, target: seekTo, id: seekId};
    ref.current?.seek(seekTo);
  }, [seekTo, uri, seekId]);

  return (
    <Video
      ref={ref}
      source={source}
      paused={paused}
      rate={rate}
      progressUpdateInterval={500}
      // With no subtitle chosen the track is not merely deselected, it is switched off, so a stale
      // preference from a previous session cannot resurrect captions the viewer turned off.
      selectedTextTrack={
        subtitleUri
          ? {type: SelectedTrackType.INDEX, value: 0}
          : {type: SelectedTrackType.DISABLED}
      }
      onLoad={(data) => {
        duration.current = data?.duration ?? 0;
        clock.current = data?.currentTime ?? 0;
        onProgress?.({
          position: data?.currentTime ?? 0,
          duration: duration.current,
        });
      }}
      onProgress={(data) => {
        clock.current = data?.currentTime ?? 0;
        onProgress?.({
          position: data?.currentTime ?? 0,
          duration: duration.current,
        });
      }}
      onEnd={onEnded}
      onError={(event) =>
        onError?.(
          event?.error?.errorString ?? 'The stream could not be played.',
        )
      }
      resizeMode={resizeMode}
      playInBackground={false}
      style={style as never}
    />
  );
}
