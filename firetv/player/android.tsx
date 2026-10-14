/**
 * Fire OS player surface: ExoPlayer through AndroidX Media3.
 *
 * react-native-video's Android backend *is* Media3 ExoPlayer, so this is the library the project
 * asked for rather than a hand-rolled player. The stream is HLS (fMP4, H.264/AAC), which ExoPlayer
 * handles natively, and the CDN's required Referer arrives through the `headers` the backend
 * returns beside the sources. libVLC stays out of the APK: it would be needed only for a codec
 * ExoPlayer cannot decode, and these streams are the most widely supported pair there is.
 */
import React, {useEffect, useRef} from 'react';
import Video, {SelectedTrackType, type VideoRef} from 'react-native-video';
import type {PlayerSurfaceProps} from '../../src/player';

export function PlayerSurface({
  uri,
  headers,
  subtitleUri,
  paused,
  rate = 1,
  seekTo,
  resizeMode = 'contain',
  onProgress,
  onEnded,
  onError,
  style,
}: PlayerSurfaceProps) {
  const ref = useRef<VideoRef>(null);
  const applied = useRef<number | null>(null);
  // Media3 reports the container's duration once, on load; progress events carry only the clock, so
  // the duration is remembered here and sent with every position update.
  const duration = useRef(0);

  // Only seek when the request changes, so a re-render never yanks playback backwards.
  useEffect(() => {
    if (typeof seekTo !== 'number' || !Number.isFinite(seekTo)) return;
    if (applied.current === seekTo) return;
    applied.current = seekTo;
    ref.current?.seek(seekTo);
  }, [seekTo]);

  const source = {
    uri,
    ...(headers && Object.keys(headers).length ? {headers} : {}),
    ...(subtitleUri
      ? {
          textTracks: [
            // The backend converts SRT to WebVTT, so no referer and no parsing is needed here.
            {title: 'Subtitles', language: 'und', type: 'text/vtt', uri: subtitleUri},
          ],
        }
      : {}),
  };

  return (
    <Video
      ref={ref}
      source={source}
      paused={paused}
      rate={rate}
      progressUpdateInterval={500}
      // With no subtitle chosen the track is not merely deselected, it is switched off, so a stale
      // preference from a previous session cannot resurrect captions the viewer turned off.
      selectedTextTrack={subtitleUri ? {type: SelectedTrackType.INDEX, value: 0} : {type: SelectedTrackType.DISABLED}}
      onLoad={data => {
        duration.current = data?.duration ?? 0;
        onProgress?.({position: data?.currentTime ?? 0, duration: duration.current});
      }}
      onProgress={data => onProgress?.({position: data?.currentTime ?? 0, duration: duration.current})}
      onEnd={onEnded}
      onError={event => onError?.(event?.error?.errorString ?? 'The stream could not be played.')}
      resizeMode={resizeMode}
      playInBackground={false}
      style={style as never}
    />
  );
}
