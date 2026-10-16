/** A failed native stream is never evidence of playback. Preview is an explicit choice. */
export function playbackPhase({
  supported,
  live,
  failed,
  preview,
}: {
  supported: boolean;
  live: boolean;
  failed: boolean;
  preview: boolean;
}): 'loading' | 'streaming' | 'unavailable' | 'preview' {
  if (preview || !supported) return 'preview';
  if (failed) return 'unavailable';
  return live ? 'streaming' : 'loading';
}
