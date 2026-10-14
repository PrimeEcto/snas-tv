import type { Episode, Title } from '../catalog/types';

export interface PlaybackState {
  title: Title;
  episode?: Episode;
  position: number;
  duration: number;
  playing: boolean;
  controls: boolean;
  audio: string;
  subtitles: string;
  speed: number;
  completed: boolean;
}

export type PlaybackAction =
  | { type: 'tick'; seconds: number }
  /** A real media surface reporting where it is, so duration comes from the file and not the metadata. */
  | { type: 'media'; position: number; duration: number }
  | { type: 'toggle' | 'play' | 'pause' }
  | { type: 'seek'; delta: number }
  | { type: 'seekTo'; position: number }
  | { type: 'controls'; visible: boolean }
  | { type: 'audio' | 'subtitles'; value: string }
  | { type: 'speed'; value: number };

export const validSpeed = (value: number): boolean => Number.isFinite(value) && value >= 0.25 && value <= 4;

export function createPlayback(title: Title, episode?: Episode, savedPosition = 0): PlaybackState {
  const minutes = episode?.runtime ?? title.runtime;
  const duration = Number.isFinite(minutes) && (minutes ?? 0) > 0
    ? minutes! * 60
    : (title.kind === 'movie' ? 110 : 45) * 60;
  const position = Number.isFinite(savedPosition) ? Math.min(duration, Math.max(0, savedPosition)) : 0;
  const completed = position >= duration;
  return { title, episode, position, duration, completed, playing: !completed, controls: true, audio: 'English', subtitles: 'Off', speed: 1 };
}

function moveTo(state: PlaybackState, position: number): PlaybackState {
  if (!Number.isFinite(position)) return state;
  const next = Math.max(0, Math.min(state.duration, position));
  const completed = next >= state.duration;
  return { ...state, position: next, completed, playing: completed ? false : state.playing };
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'tick':
      return state.playing && Number.isFinite(action.seconds) && action.seconds > 0
        ? moveTo(state, state.position + action.seconds * state.speed) : state;
    case 'media': {
      if (!Number.isFinite(action.position)) return state;
      // Before a player has read the container it reports a zero duration; keep the estimate then.
      const duration = Number.isFinite(action.duration) && action.duration > 0 ? action.duration : state.duration;
      const position = Math.max(0, Math.min(duration, action.position));
      const completed = duration > 0 && position >= duration;
      return { ...state, duration, position, completed, playing: completed ? false : state.playing };
    }
    case 'seek':
      return Number.isFinite(action.delta) ? moveTo(state, state.position + action.delta) : state;
    case 'seekTo': return moveTo(state, action.position);
    case 'pause': return { ...state, playing: false };
    case 'play': return { ...state, playing: !state.completed };
    case 'toggle': return { ...state, playing: !state.completed && !state.playing };
    case 'controls': return { ...state, controls: action.visible };
    case 'audio': return { ...state, audio: action.value };
    case 'subtitles': return { ...state, subtitles: action.value };
    case 'speed': return validSpeed(action.value) ? { ...state, speed: action.value } : state;
  }
}

export function progressKey(title: Title, episode?: Episode): string {
  const titleKey = `${title.kind}:${title.id}`;
  return title.kind === 'tv' && episode ? `${titleKey}:s${episode.season}:e${episode.number}` : titleKey;
}

export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}` : `${minutes}:${remaining}`;
}
