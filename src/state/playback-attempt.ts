/**
 * A rendition that took the process down with it, remembered across the restart.
 *
 * On the 1st-generation Fire TV Stick 4K the failure this app is fixing does not always arrive as a
 * playback error the app can catch: the decoder cannot allocate its output buffers, the media
 * pipeline is torn down, and the process goes with it — the viewer sees a freeze and then the Fire
 * TV menu. No handler inside that process can act on it, so the only place to learn from it is the
 * next launch.
 *
 * That is what this is: the rung about to be opened is written down *before* the surface mounts and
 * cleared the moment playback is real (a first frame, or leaving the player). A record that is
 * still there on the next launch is therefore a record of a playback that never got that far, and
 * its rung is added to the set the ladder skips.
 *
 * Storage is injected so the logic can be tested without a device, the same way `catalog/preload`
 * takes its `prefetch`.
 */

/** Where the attempt record lives, next to the library. A version suffix because it is replaced. */
export const ATTEMPT_KEY = 'snas.playback.attempt.v1';

/**
 * How long an armed attempt may sit unsettled before it counts as a death.
 *
 * The record is normally removed within a second of arming (the first progress report). The grace
 * period keeps a normal exit that was still writing its settle from being read as a crash.
 */
export const SETTLE_GRACE_MS = 2500;

export interface AttemptRecord {
  quality: string;
  titleKey: string;
  /** Host and file name only: a log or a store never needs a signed URL or a path token. */
  url: string;
  at: number;
}

export interface AttemptStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

/** The record a stored string holds, or null when it is absent or unreadable. */
export function parseAttempt(json: string | null): AttemptRecord | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.quality !== 'string' || !record.quality) return null;
    if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null;
    return {
      quality: record.quality,
      titleKey: typeof record.titleKey === 'string' ? record.titleKey : '',
      url: typeof record.url === 'string' ? record.url : '',
      at: record.at,
    };
  } catch {
    return null;
  }
}

/**
 * Write down the rung that is about to be opened.
 *
 * Awaited before the surface mounts: a record that has not reached storage is no record at all, and
 * the whole point is that it outlives the process that writes it.
 */
export async function armAttempt(
  storage: AttemptStorage,
  record: AttemptRecord,
): Promise<void> {
  try {
    await storage.setItem(ATTEMPT_KEY, JSON.stringify(record));
  } catch {
    // Losing the record only costs the app the ability to learn from a crash; it must never cost
    // the viewer the playback itself.
  }
}

/** Playback began, or the viewer left: there is nothing left to learn from this attempt. */
export async function settleAttempt(storage: AttemptStorage): Promise<void> {
  try {
    await storage.removeItem(ATTEMPT_KEY);
  } catch {
    // Same as above: a failed settle is harmless next to a failed launch.
  }
}

/**
 * The rung a previous session died opening, if there was one.
 *
 * Takes the record away as it reports it, so a rung is blamed for one death rather than being
 * re-learned on every launch, and so the viewer can always retry it deliberately from the quality
 * menu.
 */
export async function takeKilledQuality(
  storage: AttemptStorage,
  now: number = Date.now(),
): Promise<string | null> {
  try {
    const record = parseAttempt(await storage.getItem(ATTEMPT_KEY));
    if (!record) return null;
    await settleAttempt(storage);
    // An attempt that was still being written when the app was force-stopped is not evidence about
    // the stream: only one that had time to become a real session is.
    if (now - record.at < SETTLE_GRACE_MS) return null;
    return record.quality || null;
  } catch {
    return null;
  }
}
