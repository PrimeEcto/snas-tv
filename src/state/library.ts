import type { Episode, Title } from '../catalog/types';
import { progressKey, validSpeed, validAspect } from './playback.ts';
import type { AspectMode, PlaybackState } from './playback';

export interface Progress {
  title: Title;
  episode?: Episode;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface Library {
  watchlist: Title[];
  progress: Record<string, Progress>;
  preferences: { audio: string; subtitles: string; speed: number; aspect: AspectMode };
}

export function emptyLibrary(): Library {
  return { watchlist: [], progress: {}, preferences: { audio: 'English', subtitles: 'Off', speed: 1, aspect: 'fill' } };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;
const runtime = (value: unknown): boolean => value === null || (finite(value) && value > 0);

function validTitle(value: unknown): value is Title {
  return object(value) && id(value.id) && (value.kind === 'movie' || value.kind === 'tv')
    && typeof value.title === 'string' && typeof value.year === 'string'
    && typeof value.overview === 'string' && ['poster', 'backdrop'].every(key => value[key] === null || typeof value[key] === 'string')
    && Array.isArray(value.genres) && value.genres.every(genre => typeof genre === 'string')
    && (value.rating === null || finite(value.rating)) && runtime(value.runtime);
}

function validEpisode(value: unknown): value is Episode {
  return object(value) && id(value.id) && id(value.season) && id(value.number)
    && ['title', 'overview'].every(key => typeof value[key] === 'string') && (value.still === null || typeof value.still === 'string') && runtime(value.runtime);
}

function validProgress(value: unknown): value is Progress {
  return object(value) && validTitle(value.title)
    && (value.episode === undefined || (value.title.kind === 'tv' && validEpisode(value.episode)))
    && finite(value.position) && value.position > 0 && finite(value.duration) && value.duration > 0
    && value.position / value.duration < 0.95 && finite(value.updatedAt) && value.updatedAt >= 0;
}

export function parseLibrary(json: string | null): Library {
  const library = emptyLibrary();
  if (!json) return library;
  try {
    const value: unknown = JSON.parse(json);
    if (!object(value) || !Array.isArray(value.watchlist) || !object(value.progress) || !object(value.preferences)) return library;
    const seen = new Set<string>();
    library.watchlist = value.watchlist.filter((title): title is Title => {
      if (!validTitle(title)) return false;
      const key = progressKey(title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const entry of Object.values(value.progress)) {
      if (!validProgress(entry)) continue;
      const key = progressKey(entry.title, entry.episode);
      if (!library.progress[key] || library.progress[key].updatedAt < entry.updatedAt) library.progress[key] = entry;
    }
    if (typeof value.preferences.audio === 'string') library.preferences.audio = value.preferences.audio;
    if (typeof value.preferences.subtitles === 'string') library.preferences.subtitles = value.preferences.subtitles;
    if (finite(value.preferences.speed) && validSpeed(value.preferences.speed)) library.preferences.speed = value.preferences.speed;
    if (validAspect(value.preferences.aspect)) library.preferences.aspect = value.preferences.aspect;
    return library;
  } catch {
    return emptyLibrary();
  }
}

export function toggleSaved(library: Library, title: Title): Library {
  const key = progressKey(title);
  const exists = library.watchlist.some(saved => progressKey(saved) === key);
  return { ...library, watchlist: exists ? library.watchlist.filter(saved => progressKey(saved) !== key) : [...library.watchlist, title] };
}

export function saveProgress(library: Library, state: PlaybackState, now = Date.now()): Library {
  if (!finite(state.position) || !finite(state.duration) || state.duration <= 0) return library;
  const key = progressKey(state.title, state.episode);
  const progress = { ...library.progress };
  if (state.position <= 0 || state.position / state.duration >= 0.95) {
    delete progress[key];
  } else {
    progress[key] = {
      title: state.title, episode: state.episode, position: state.position, duration: state.duration,
      updatedAt: finite(now) && now >= 0 ? now : Date.now(),
    };
  }
  return { ...library, progress };
}

export function continueWatching(library: Library): Progress[] {
  const seen = new Set<string>();
  return Object.values(library.progress).filter(validProgress).sort((a, b) => b.updatedAt - a.updatedAt).filter(entry => {
    const key = progressKey(entry.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
