import React, {
  useReducer,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  BackHandler,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {useTVEventHandler} from 'snas-tv';
import {PlayerSurface, supportsPlayback} from 'snas-player';
import {playbackPhase} from '../state/playback-phase';
import {
  SourceUnavailableError,
  loadRenditions,
  loadWatch,
  subtitleUrl,
  type WatchResult,
} from '../player';
import {deviceInfo, playbackLog, redact, videoPolicy} from '../device';
import {
  bufferFor,
  describeLadder,
  orderByQuality,
  pickQuality,
  type Rendition,
  type VideoPolicy,
} from '../ladder';
import {deviceSummary, policyForDevice, type DeviceInfo} from '../device-profile';
import {
  armAttempt,
  settleAttempt,
  takeKilledQuality,
} from '../state/playback-attempt';
import {attemptStorage} from '../state/attempt-storage';
import {Catalog} from '../catalog/service';
import type {Title, Episode} from '../catalog/types';
import {
  ASPECT_LABELS,
  ASPECT_MODES,
  ASPECT_NOTES,
  createPlayback,
  playbackReducer,
  formatTime,
  resizeModeFor,
  validAspect,
  type PlaybackState,
} from '../state/playback';
import type {Library} from '../state/library';
import {Artwork, Button, IconButton, LinearGradient} from './controls';
import {TVOverlay} from './TVOverlay';
import {FocusScope, useFocusNode} from './focus';
import {C} from './theme';
type Menu =
  | 'audio'
  | 'subtitles'
  | 'quality'
  | 'aspect'
  | 'settings'
  | 'speed'
  | 'episodes'
  | null;
/** A stalled native source becomes unavailable; preview always requires an explicit choice. */
const STREAM_WAIT_MS = 25000;
// Which rung a session opens on is no longer a constant in this file. It is decided from the real
// rendition sizes in the provider's master playlist and from what the device says about its memory
// and its decoder (`src/ladder.ts`, `src/device-profile.ts`), because the labels cannot be trusted:
// across five titles measured on 2026-10-16, `1080p` was 1920×1080 High Level 4.0 on four of them
// and 2584×1080 High Level 5.0 on the fifth, and `2160p` was High Level 5.1 every time.
/** How long the attempt record may take to reach storage before the surface mounts anyway. */
const ARM_TIMEOUT_MS = 1200;
export function PlayerScreen({
  title,
  episode,
  position,
  catalog,
  preferences,
  onSave,
  onExit,
  onEpisode,
}: {
  title: Title;
  episode?: Episode;
  position: number;
  catalog: Catalog;
  preferences: Library['preferences'];
  onSave: (s: PlaybackState) => void;
  onExit: (s?: PlaybackState) => void;
  onEpisode: (e: Episode) => void;
}) {
  const [state, dispatch] = useReducer(playbackReducer, undefined, () => ({
    ...createPlayback(title, episode, position),
    ...preferences,
  }));
  const [menu, setMenu] = useState<Menu>(null);
  const [timelineFocused, setTimelineFocused] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [error, setError] = useState('');
  // Playback itself: the sources the backend returned, the one actually selected, and the state of
  // the platform surface. `live` flips once a real media element reports a clock of its own.
  const [media, setMedia] = useState<WatchResult | null>(null);
  const [streamError, setStreamError] = useState('');
  // True when the failure was the source service's, not this title's: the recovery copy has to say
  // which, or a viewer goes looking for a different title that "works" while every one of them fails.
  const [outage, setOutage] = useState(false);
  const [quality, setQuality] = useState('');
  // The provider's real ladder for this title, and the policy this device is held to.
  const [renditions, setRenditions] = useState<Rendition[]>([]);
  const [policy, setPolicy] = useState<VideoPolicy>(() => videoPolicy());
  // The surface mounts only once its rung has been written down; see `armAttempt` below.
  const [armed, setArmed] = useState(false);
  const [subtitleId, setSubtitleId] = useState('');
  const [seek, setSeek] = useState<{target: number; serial: number} | null>(
    null,
  );
  const [live, setLive] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fallback, setFallback] = useState('');
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState(!supportsPlayback);
  const canSave = useRef(false);
  // A decoder that refuses a rendition is not a dead end: the ladder is walked downwards from the
  // rung that failed until one this device can open plays. `failed` remembers the rungs this
  // session has already lost, so a repeated error cannot walk the same rung twice.
  const failed = useRef<Set<string>>(new Set());
  // Rungs this device has already been shown to be unable to survive: one that took the process
  // down with it (`src/state/playback-attempt.ts`), and one the viewer chose that then failed.
  const dead = useRef<Set<string>>(new Set());
  const mediaRef = useRef<WatchResult | null>(null);
  const qualityRef = useRef('');
  const renditionsRef = useRef<Rendition[]>([]);
  const deviceRef = useRef<DeviceInfo | null>(null);
  // The source whose attempt record has already been settled, so a rung is armed once and cleared
  // once rather than on every progress report.
  const settled = useRef('');
  const sourceRef = useRef('');
  mediaRef.current = media;
  qualityRef.current = quality;
  renditionsRef.current = renditions;
  const lastInteraction = useRef(Date.now());
  const latest = useRef(state);
  latest.current = state;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const resumeAt = useRef(position);
  const resumed = useRef(false);
  const reveal = () => {
    lastInteraction.current = Date.now();
    dispatch({type: 'controls', visible: true});
  };
  // Reading this session's identity into scalars first keeps the effects below honest about what they
  // depend on, so a re-render with the same title and episode never refetches the stream.
  const {
    id: titleId,
    kind: titleKind,
    title: titleName,
    year: titleYear,
  } = title;
  const episodeSeason = episode?.season;
  const episodeNumber = episode?.number;
  const preferredSubtitle = useRef(preferences.subtitles).current;
  // Ask the backend for playable sources and the subtitle menu whenever the title or episode changes.
  // A failure is actionable on screen and never starts the simulated timeline automatically.
  useEffect(() => {
    if (preview || !supportsPlayback) return;
    let alive = true;
    setSlow(false);
    setMedia(null);
    setStreamError('');
    setOutage(false);
    setLive(false);
    setQuality('');
    setSubtitleId('');
    setRenditions([]);
    // Every fresh attempt starts with a clean slate of failures. A rung this device was already
    // killed by stays out of the ladder — it is the one piece of state that must outlive the
    // process, because a rung can only kill a process it was allowed to open.
    failed.current.clear();
    setFallback('');
    resumed.current = false;
    (async () => {
      const killed = await takeKilledQuality(attemptStorage);
      if (killed) dead.current.add(killed);
      const probe = await deviceInfo();
      if (!alive) return;
      deviceRef.current = probe;
      const result = await loadWatch(
        {id: titleId, kind: titleKind, title: titleName, year: titleYear},
        episodeSeason !== undefined && episodeNumber !== undefined
          ? {season: episodeSeason, number: episodeNumber}
          : undefined,
      );
      if (!alive) return;
      if (!result) {
        setStreamError('No playable source came back for this title.');
        playbackLog('playback:no-source', {
          title: `${titleKind}:${titleId}`,
          device: deviceSummary(probe),
          killed: killed ?? '-',
        });
        return;
      }
      // What the labels really are. A provider that will not say, or says it too slowly, costs the
      // app only the ability to judge a rung by its measured frame: the policy then falls back to
      // the label. It never holds up playback.
      const covered = result.playlist
        ? await loadRenditions(result.playlist, result.headers)
        : [];
      if (!alive) return;
      const chosen = policyForDevice(probe);
      const decision = pickQuality(result.sources, covered, chosen, {
        skip: dead.current,
      });
      setRenditions(covered);
      setPolicy(chosen);
      setMedia(result);
      setQuality(decision.quality);
      playbackLog('playback:start', {
        title: `${titleKind}:${titleId}`,
        device: deviceSummary(probe),
        policy: chosen.reason,
        ceiling: `${chosen.maxWidth}x${chosen.maxHeight} L${(
          chosen.maxH264Level / 10
        ).toFixed(1)}`,
        renditions: covered.length,
        ladder: describeLadder(result.sources, covered, chosen),
        killed: killed ?? '-',
        opening: decision.quality,
        allowed: decision.allowed,
        buffer:
          policyForDevice(probe).kind === 'constrained'
            ? `maxBufferMs=${bufferFor(chosen).maxBufferMs} reserve=${bufferFor(chosen).minBufferMemoryReservePercent}`
            : 'default',
      });
      // A subtitle choice is remembered across sessions, but only when this release actually offers it.
      const wanted = preferredSubtitle;
      setSubtitleId(
        wanted && result.subtitleGroups.some((g) => g.language === wanted)
          ? wanted
          : '',
      );
    })().catch((error: unknown) => {
      if (!alive) return;
      // The source service being down is not this title's fault, and saying so sends the viewer back
      // to the same title in a minute instead of hunting for one that "works".
      if (error instanceof SourceUnavailableError) {
        playbackLog('playback:source-unavailable', {
          title: `${titleKind}:${titleId}`,
          status: error.status,
          device: deviceSummary(deviceRef.current),
        });
        setOutage(true);
        setStreamError('The source service is unavailable right now. Try again in a moment.');
        return;
      }
      setStreamError('The stream could not be reached.');
    });
    return () => {
      alive = false;
    };
  }, [
    titleId,
    titleKind,
    titleName,
    titleYear,
    episodeSeason,
    episodeNumber,
    preferredSubtitle,
    retry,
    preview,
  ]);
  const selected =
    media?.sources.find((s) => s.quality === quality) ?? media?.sources[0];
  // The identity of the source the surface holds. A rung change is a new attempt, so both the
  // attempt record and the "has it started" bookkeeping are keyed on it.
  const sourceId = selected?.url ?? '';
  sourceRef.current = sourceId;
  // The buffer this device can afford, and how the player should treat a heap that is nearly spent.
  const buffer = useMemo(() => bufferFor(policy), [policy]);
  const bufferingStrategy =
    policy.kind === 'constrained' ? 'DependingOnMemory' : 'Default';
  const subtitleUri =
    media && subtitleId
      ? subtitleUrl(subtitleId, title.id, title.kind)
      : undefined;
  const phase = playbackPhase({
    supported: supportsPlayback,
    live,
    failed: !!streamError || slow,
    preview,
  });
  const buffering = phase === 'loading';
  const unavailable = phase === 'unavailable';
  canSave.current = phase === 'streaming' || phase === 'preview';
  useEffect(() => {
    if (!unavailable) return;
    setMenu(null);
    dispatch({type: 'controls', visible: true});
  }, [unavailable]);
  // The rung about to be opened is written down *before* the surface mounts, and cleared either by
  // the surface's first clock report or by leaving the player. A record that outlives the process is
  // therefore the only witness a killed session can leave, and the next launch reads it as "this
  // rung is fatal on this device". Nothing inside a dead process can step down; this can.
  useEffect(() => {
    if (!sourceId) {
      setArmed(false);
      return;
    }
    let alive = true;
    setArmed(false);
    // A new attempt has its own record to settle: re-using the previous source's mark would leave
    // this one armed after it plays, to be blamed for some later death that was not its doing.
    settled.current = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const written = Promise.race([
      armAttempt(attemptStorage, {
        quality: qualityRef.current || '',
        titleKey: `${titleKind}:${titleId}`,
        url: redact(sourceId),
        at: Date.now(),
      }),
      // Storage that never answers must not cost the viewer the picture: after this, the surface
      // mounts anyway and the attempt is merely unwitnessed.
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ARM_TIMEOUT_MS);
      }),
    ]);
    written.then(() => {
      if (timer) clearTimeout(timer);
      if (alive) setArmed(true);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [sourceId, titleId, titleKind]);
  // Leaving the player settles the attempt too: a viewer who backs out of a title has not crashed,
  // and must not be moved to a lower rung next time for it.
  useEffect(
    () => () => {
      settleAttempt(attemptStorage);
    },
    [],
  );
  // Every way out of the player goes through here, so the log always records that the session ended
  // rather than dying. That line is what separates a normal exit from a process that never got to
  // write anything — the distinction the whole on-device diagnosis rests on.
  const exitPlayer = useCallback(() => {
    playbackLog('playback:exit', {
      position: Math.round(latest.current.position),
      duration: Math.round(latest.current.duration),
      playing: latest.current.playing,
    });
    onExit(canSave.current ? latest.current : undefined);
  }, [onExit]);
  const retryStream = () => {
    resumeAt.current = latest.current.position;
    resumed.current = false;
    setSeek(null);
    setPreview(false);
    setSlow(false);
    setStreamError('');
    setOutage(false);
    setLive(false);
    setRetry((value) => value + 1);
  };
  // The surface is the authority while it decodes: its clock replaces the tick, and its first report
  // is what resumes a partially watched title at the position the library saved for it.
  const onProgress = useCallback(
    (progress: {position: number; duration: number}) => {
      // A clock from the surface is what makes this attempt a session rather than a rung that was
      // merely opened: there is nothing left to learn from it, so its record goes.
      const open = sourceRef.current;
      if (open && settled.current !== open) {
        settled.current = open;
        settleAttempt(attemptStorage);
      }
      setLive(true);
      dispatch({
        type: 'media',
        position: progress.position,
        duration: progress.duration,
      });
      if (!resumed.current) {
        resumed.current = true;
        if (resumeAt.current > 5)
          setSeek((old) => ({
            target: resumeAt.current,
            serial: (old?.serial ?? 0) + 1,
          }));
      }
    },
    [],
  );
  const onEnded = useCallback(
    () =>
      dispatch({
        type: 'media',
        position: latest.current.duration,
        duration: latest.current.duration,
      }),
    [],
  );
  // A rendition this device cannot open is stepped over rather than ending the session. The stream
  // the backend labels "1080p" is ultrawide H.264 (2584x1080, High L5.0), and a 1st-gen Fire TV
  // Stick 4K cannot allocate decoder output buffers for it: MediaTek fails the port reconfiguration
  // with ENOMEM and reports a fatal codec error, which the surface hands back here as a playback
  // error. The rungs below it are Main profile at 1724x720 and 852x480, which that decoder does
  // open, so the failure walks down instead of leaving the viewer with nothing to watch.
  const onStreamError = useCallback((message: string) => {
    const sources = mediaRef.current?.sources ?? [];
    const ladder = orderByQuality(sources);
    const current = qualityRef.current || ladder[0]?.quality || '';
    const at = ladder.findIndex((s) => s.quality === current);
    if (at >= 0) failed.current.add(current);
    // Only a rung this device has not already lost is worth the next attempt: the point of stepping
    // down is to reach something playable, not to spend another failure on the way there.
    const lower =
      at >= 0
        ? ladder
            .slice(at + 1)
            .find(
              (s) => !failed.current.has(s.quality) && !dead.current.has(s.quality),
            )
        : undefined;
    if (lower) {
      playbackLog('playback:step-down', {
        from: current,
        to: lower.quality,
        reason: message,
        position: Math.round(latest.current.position),
      });
      resumeAt.current = latest.current.position;
      resumed.current = false;
      setSeek(null);
      setSlow(false);
      setLive(false);
      setStreamError('');
      setFallback(
        `This device couldn’t play ${current}. Switched to ${lower.quality}.`,
      );
      setQuality(lower.quality);
      return;
    }
    playbackLog('playback:unavailable', {
      rung: current || '-',
      reason: message,
      device: deviceSummary(deviceRef.current),
      ladder: describeLadder(
        sources,
        renditionsRef.current,
        policyForDevice(deviceRef.current),
      ),
      lost: [...failed.current].join('/') || '-',
    });
    setStreamError(message);
    setLive(false);
    setMedia(null);
  }, []);
  const jump = useCallback((delta: number) => {
    const target = Math.max(
      0,
      Math.min(latest.current.duration, latest.current.position + delta),
    );
    dispatch({type: 'seek', delta});
    setSeek((old) => ({target, serial: (old?.serial ?? 0) + 1}));
    setSeekFeedback(
      `${delta < 0 ? '−' : '+'}${Math.abs(delta)} seconds · ${formatTime(
        target,
      )}`,
    );
    lastInteraction.current = Date.now();
    dispatch({type: 'controls', visible: true});
  }, []);
  useEffect(() => {
    if (!seekFeedback) return;
    const timer = setTimeout(() => setSeekFeedback(''), 1600);
    return () => clearTimeout(timer);
  }, [seekFeedback, seek]);
  const togglePlayback = () => {
    if (latest.current.completed) {
      setSeek((old) => ({target: 0, serial: (old?.serial ?? 0) + 1}));
      dispatch({type: 'replay'});
    } else dispatch({type: 'toggle'});
    reveal();
  };
  useTVEventHandler((event) => {
    if (
      event.eventKeyAction === 1 ||
      event.eventType === 'focus' ||
      event.eventType === 'blur'
    )
      return;
    if (menu) return;
    if (canSave.current && timelineFocused && event.eventType === 'left')
      jump(-10);
    if (canSave.current && timelineFocused && event.eventType === 'right')
      jump(10);
    if (canSave.current && event.eventType === 'playPause') togglePlayback();
    if (canSave.current && event.eventType === 'rewind') jump(-10);
    if (canSave.current && event.eventType === 'fastForward') jump(10);
    if (event.eventType !== 'back') reveal();
  });
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) {
        setMenu(
          menu === 'quality' || menu === 'aspect' || menu === 'speed'
            ? 'settings'
            : null,
        );
        reveal();
      } else if (unavailable || buffering) {
        exitPlayer();
      } else if (state.controls) {
        dispatch({type: 'controls', visible: false});
      } else exitPlayer();
      return true;
    });
    return () => sub.remove();
  }, [menu, state.controls, exitPlayer, unavailable, buffering]);
  useEffect(() => {
    if (!buffering) return;
    const timer = setTimeout(() => setSlow(true), STREAM_WAIT_MS);
    return () => clearTimeout(timer);
  }, [buffering, retry]);
  // The simulated clock is opt-in on Android and the supported preview mode on Vega.
  useEffect(() => {
    if (phase !== 'preview') return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      dispatch({type: 'tick', seconds: Math.min(2, (now - last) / 1000)});
      last = now;
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        !menu &&
        !unavailable &&
        !buffering &&
        latest.current.playing &&
        Date.now() - lastInteraction.current > 6000
      )
        dispatch({type: 'controls', visible: false});
    }, 1000);
    return () => clearInterval(timer);
  }, [menu, unavailable, buffering]);
  useEffect(() => {
    const timer = setInterval(
      () => canSave.current && saveRef.current(latest.current),
      5000,
    );
    return () => {
      clearInterval(timer);
      canSave.current && saveRef.current(latest.current);
    };
  }, []);
  useEffect(() => {
    if (episodeSeason === undefined) return;
    let alive = true;
    catalog
      .season(title, episodeSeason)
      .then((e) => {
        if (alive) setEpisodes(e);
      })
      .catch(() => {
        if (alive)
          setError(
            'Episodes could not be loaded. Try opening this title again.',
          );
      });
    return () => {
      alive = false;
    };
  }, [catalog, title, episodeSeason]);
  const next = episode
    ? episodes.find((e) => e.number === episode.number + 1)
    : undefined;
  const nextStarted = useRef(false);
  useEffect(() => {
    if (state.completed && next && !nextStarted.current) {
      nextStarted.current = true;
      onSave(latest.current);
      onEpisode(next);
    }
  }, [state.completed, next, onEpisode, onSave]);
  const open = (m: Menu) => {
    reveal();
    setMenu(m);
  };
  const selectOption = (value: string) => {
    if (menu === 'audio') dispatch({type: 'audio', value});
    if (menu === 'subtitles') {
      setSubtitleId(value === 'Off' ? '' : value);
      dispatch({type: 'subtitles', value});
    }
    if (menu === 'quality' && value !== quality) {
      // Choosing a rung by hand means the viewer wants it tried, even if an earlier session lost the
      // process to it. It is cleared here and learned again if this session is the one that loses.
      dead.current.delete(value);
      resumeAt.current = latest.current.position;
      resumed.current = false;
      setSeek(null);
      setLive(false);
      setSlow(false);
      setQuality(value);
    }
    if (menu === 'speed') dispatch({type: 'speed', value: Number(value)});
    if (menu === 'aspect' && validAspect(value))
      dispatch({type: 'aspect', value});
    setMenu(
      menu === 'quality' || menu === 'aspect' || menu === 'speed'
        ? 'settings'
        : null,
    );
    reveal();
  };
  const audioOptions = media ? ['Original'] : ['Original', 'English'];
  const subtitleOptions = media
    ? ['Off', ...media.subtitleGroups.map((g) => g.language)]
    : ['Off', 'English', 'Español'];
  const qualityOptions = media
    ? orderByQuality(media.sources).map((s) => s.quality)
    : ['Auto'];
  const menuOptions: string[] =
    menu === 'audio'
      ? audioOptions
      : menu === 'subtitles'
      ? subtitleOptions
      : menu === 'quality'
      ? qualityOptions
      : menu === 'speed'
      ? ['0.5', '1', '1.5', '2']
      : menu === 'aspect'
      ? [...ASPECT_MODES]
      : [];
  const selection =
    menu === 'audio'
      ? state.audio
      : menu === 'subtitles'
      ? state.subtitles
      : menu === 'quality'
      ? media
        ? quality
        : 'Auto'
      : menu === 'aspect'
      ? state.aspect
      : String(state.speed);
  const nested = menu === 'quality' || menu === 'aspect' || menu === 'speed';
  const closeMenu = () => {
    setMenu(nested ? 'settings' : null);
    reveal();
  };
  const menuTitle =
    menu === 'episodes'
      ? 'Episodes'
      : menu === 'settings'
      ? 'Settings'
      : menu === 'speed'
      ? 'Playback speed'
      : menu === 'quality'
      ? 'Video quality'
      : menu === 'audio'
      ? 'Audio'
      : menu === 'aspect'
      ? 'Screen fit'
      : 'Subtitles';
  const menuNote =
    menu === 'episodes'
      ? `Season ${episode?.season}`
      : menu === 'subtitles'
      ? 'Choose a subtitle language, or turn subtitles off.'
      : menu === 'quality'
      ? 'Choose from the qualities available for this title.'
      : menu === 'aspect'
      ? 'Choose how the picture fits your screen.'
      : menu === 'audio'
      ? 'This title provides its original audio track.'
      : menu === 'speed'
      ? 'Choose how quickly this title plays.'
      : 'Picture and playback preferences';
  const progress =
    state.duration > 0
      ? Math.min(1, Math.max(0, state.position / state.duration))
      : 0;
  const phaseLabel = preview
    ? 'Concept'
    : buffering
    ? 'Loading…'
    : unavailable
    ? ''
    : selected?.quality;
  return (
    <View style={styles.screen}>
      {selected && !preview && !unavailable && armed ? (
        <PlayerSurface
          uri={selected.url}
          headers={media?.headers}
          bufferConfig={buffer}
          bufferingStrategy={bufferingStrategy}
          subtitleUri={subtitleUri}
          paused={!state.playing}
          rate={state.speed}
          resizeMode={resizeModeFor(state.aspect)}
          seekTo={live && seek ? seek.target : undefined}
          seekId={seek?.serial}
          style={StyleSheet.absoluteFill}
          onProgress={onProgress}
          onEnded={onEnded}
          onError={onStreamError}
        />
      ) : (
        <Artwork
          title={title}
          kind="backdrop"
          style={StyleSheet.absoluteFill}
        />
      )}
      {(!selected || !armed || preview || unavailable) && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: unavailable
                ? 'rgba(5,8,12,0.8)'
                : 'rgba(5,8,12,0.25)',
            },
          ]}
        />
      )}
      {!state.controls && !menu && (
        <Pressable
          testID="player-reveal"
          accessibilityLabel="Show playback controls"
          hasTVPreferredFocus
          onPress={reveal}
          style={StyleSheet.absoluteFill}
        />
      )}
      <FocusScope
        active={state.controls && !menu}
        initial={
          unavailable
            ? 'player-retry'
            : buffering
            ? 'player-exit'
            : 'player-toggle'
        }>
        <LinearGradient
          colors={['rgba(5,8,12,0.84)', 'transparent']}
          style={styles.topShade}
        />
        <View style={styles.contextBand}>
          <View style={{flex: 1, marginRight: 28}}>
            <Text numberOfLines={1} style={styles.title}>
              {title.title}
            </Text>
            {episode && (
              <Text numberOfLines={1} style={styles.episode}>
                Season {episode.season} · Episode {episode.number} —{' '}
                {episode.title}
              </Text>
            )}
          </View>
          {!!phaseLabel && (
            <Text style={[styles.phase, preview && {color: C.accent}]}>
              {phaseLabel}
            </Text>
          )}
          <IconButton
            id="player-exit"
            icon="close"
            label="Exit player"
            onPress={exitPlayer}
          />
        </View>
        {unavailable ? (
          <View style={styles.recovery}>
            <View style={styles.recoveryMark}>
              <Text style={styles.recoverySymbol}>!</Text>
            </View>
            <Text style={styles.recoveryTitle}>Playback unavailable</Text>
            <Text testID="player-error" style={styles.recoveryCopy}>
              {outage
                ? 'The source service is unavailable right now. Try again in a moment.'
                : 'This title couldn’t play. Try again to reconnect.'}
            </Text>
            <View style={styles.recoveryActions}>
              <Button
                id="player-retry"
                label="Try again"
                icon="play"
                primary
                onPress={retryStream}
              />
              <Button
                id="player-preview"
                label="Explore player"
                onPress={() => {
                  setPreview(true);
                  setMedia(null);
                  setStreamError('');
                  setLive(false);
                }}
              />
            </View>
          </View>
        ) : buffering ? (
          <View
            testID="player-buffering"
            accessibilityLabel="Loading video"
            style={styles.loading}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={styles.loadingTitle}>Getting your video ready</Text>
            <Text style={styles.loadingNote}>
              Playback will begin when the connection is ready.
            </Text>
          </View>
        ) : (
          <>
            <LinearGradient
              colors={['transparent', 'rgba(5,8,12,0.72)', 'rgba(5,8,12,0.97)']}
              locations={[0, 0.5, 1]}
              style={styles.bottomShade}
            />
            <View style={styles.transport}>
              <Text
                testID="player-seek-feedback"
                accessibilityLiveRegion="polite"
                style={styles.seekFeedback}>
                {seekFeedback ||
                  fallback ||
                  (state.completed ? 'Ready to watch again' : '')}
              </Text>
              <View style={styles.transportButtons}>
                <IconButton
                  id="player-rewind"
                  icon="rewind"
                  label="−10 sec"
                  caption
                  onFocus={reveal}
                  onPress={() => jump(-10)}
                />
                <IconButton
                  id="player-toggle"
                  primary
                  size={88}
                  icon={state.playing ? 'pause' : 'play'}
                  label={
                    state.playing
                      ? 'Pause'
                      : state.completed
                      ? 'Replay'
                      : 'Play'
                  }
                  caption
                  onFocus={reveal}
                  onPress={togglePlayback}
                />
                <IconButton
                  id="player-forward"
                  icon="forward"
                  label="+10 sec"
                  caption
                  onFocus={reveal}
                  onPress={() => jump(10)}
                />
              </View>
            </View>
            <View style={styles.timelineArea}>
              <SeekTimeline
                progress={progress}
                position={state.position}
                duration={state.duration}
                onFocus={() => {
                  setTimelineFocused(true);
                  reveal();
                }}
                onBlur={() => setTimelineFocused(false)}
                onSeek={jump}
                onPress={togglePlayback}
              />
            </View>
            <View style={styles.utilities}>
              <View style={styles.utilitySide} />
              <View style={styles.utilityButtons}>
                <IconButton
                  id="player-audio"
                  icon="audio"
                  label="Audio"
                  caption
                  onFocus={reveal}
                  onPress={() => open('audio')}
                />
                <IconButton
                  id="player-subtitles"
                  icon="subtitles"
                  label="Subtitles"
                  caption
                  selected={state.subtitles !== 'Off'}
                  onFocus={reveal}
                  onPress={() => open('subtitles')}
                />
                <IconButton
                  id="player-settings"
                  icon="settings"
                  label="Settings"
                  caption
                  onFocus={reveal}
                  onPress={() => open('settings')}
                />
              </View>
              <View style={[styles.utilitySide, {alignItems: 'flex-end'}]}>
                {episode && (
                  <Button
                    id="player-episodes"
                    compact
                    icon="list"
                    label="Episodes"
                    onFocus={reveal}
                    onPress={() => open('episodes')}
                  />
                )}
                {next && (
                  <Button
                    id="player-next"
                    compact
                    icon="next"
                    label="Next episode"
                    onFocus={reveal}
                    onPress={() => {
                      if (canSave.current) onSave(state);
                      onEpisode(next);
                    }}
                  />
                )}
              </View>
            </View>
          </>
        )}
      </FocusScope>
      <TVOverlay
        visible={!!menu}
        onClose={closeMenu}
        initial={
          menu === 'settings'
            ? 'player-quality'
            : menuOptions.includes(selection)
            ? `option-${selection}`
            : menu === 'episodes' && episodes[0]
            ? `player-episode-${episode?.number ?? episodes[0].number}`
            : 'menu-close'
        }
        title={menuTitle}
        subtitle={menuNote}
        width={500}
        testID="player-menu">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{gap: 12, paddingBottom: 32}}>
          {menu === 'settings' ? (
            <>
              <SettingRow
                id="player-quality"
                label="Video quality"
                value={selected?.quality ?? 'Auto'}
                onPress={() => setMenu('quality')}
              />
              <SettingRow
                id="player-aspect"
                label="Screen fit"
                value={ASPECT_LABELS[state.aspect]}
                onPress={() => setMenu('aspect')}
              />
              <SettingRow
                id="player-speed"
                label="Playback speed"
                value={`${state.speed}×`}
                onPress={() => setMenu('speed')}
              />
            </>
          ) : (
            menuOptions.map((option) => (
              <Button
                key={option}
                id={`option-${option}`}
                label={
                  menu === 'speed'
                    ? `${option}×`
                    : menu === 'subtitles' && media && option !== 'Off'
                    ? option.toUpperCase()
                    : menu === 'aspect' && validAspect(option)
                    ? ASPECT_LABELS[option]
                    : option
                }
                icon={selection === option ? 'check' : undefined}
                selected={selection === option}
                onPress={() => selectOption(option)}
              />
            ))
          )}
          {menu === 'aspect' && (
            <Text style={styles.optionNote}>{ASPECT_NOTES[state.aspect]}</Text>
          )}
          {menu === 'episodes' &&
            episodes.map((e) => (
              <Button
                key={e.id}
                id={`player-episode-${e.number}`}
                label={`${e.number}. ${e.title}`}
                selected={e.id === episode?.id}
                onPress={() => {
                  if (canSave.current) onSave(state);
                  onEpisode(e);
                }}
              />
            ))}
          {menu === 'episodes' && error && (
            <Text style={styles.optionNote}>{error}</Text>
          )}
          {menu === 'episodes' && !error && !episodes.length && (
            <Text style={styles.optionNote}>
              No episodes are available for this season.
            </Text>
          )}
        </ScrollView>
      </TVOverlay>
    </View>
  );
}

function SettingRow({
  id,
  label,
  value,
  onPress,
}: {
  id: string;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <View style={{gap: 7, marginBottom: 12}}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Button id={id} label={value} icon="chevronRight" onPress={onPress} />
    </View>
  );
}

function SeekTimeline({
  progress,
  position,
  duration,
  onFocus,
  onBlur,
  onSeek,
  onPress,
}: {
  progress: number;
  position: number;
  duration: number;
  onFocus: () => void;
  onBlur: () => void;
  onSeek: (delta: number) => void;
  onPress: () => void;
}) {
  const node = useFocusNode('player-timeline');
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={node.ref as never}
      testID="player-timeline"
      hasTVPreferredFocus={node.preferred}
      focusable
      accessibilityRole="adjustable"
      accessibilityLabel="Playback timeline. Left or right seeks 10 seconds."
      accessibilityValue={{
        min: 0,
        max: duration,
        now: position,
        text: `${formatTime(position)} of ${formatTime(duration)}`,
      }}
      accessibilityActions={[
        {name: 'increment', label: 'Forward 10 seconds'},
        {name: 'decrement', label: 'Rewind 10 seconds'},
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') onSeek(10);
        if (event.nativeEvent.actionName === 'decrement') onSeek(-10);
      }}
      onFocus={() => {
        node.remember();
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      onPress={onPress}
      style={[styles.timeline, focused && styles.timelineFocused]}>
      <View style={[styles.track, focused && {height: 8}]}>
        <View
          style={{
            height: '100%',
            width: `${progress * 100}%`,
            backgroundColor: C.accent,
            borderRadius: 4,
          }}
        />
        <View
          style={[
            styles.playhead,
            {left: `${progress * 100}%`},
            focused && {width: 16, height: 16, marginLeft: -8, top: -4},
          ]}
        />
      </View>
      <View style={styles.timeLabels}>
        <Text testID="player-position" style={styles.time}>
          {formatTime(position)}
        </Text>
        <Text style={[styles.timelineHint, focused && {color: C.accent}]}>
          {focused ? 'Left / right to seek · 10 seconds' : 'Playback timeline'}
        </Text>
        <Text
          testID="player-duration"
          style={[styles.time, {textAlign: 'right'}]}>
          {formatTime(duration)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: C.bg},
  topShade: {position: 'absolute', top: 0, left: 0, right: 0, height: 180},
  bottomShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 430,
  },
  contextBand: {
    position: 'absolute',
    top: 38,
    left: 56,
    right: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  title: {fontSize: 30, lineHeight: 38, fontWeight: '600', color: C.text},
  episode: {fontSize: 17, lineHeight: 25, color: C.muted, marginTop: 4},
  phase: {fontSize: 17, color: C.muted},
  transport: {
    position: 'absolute',
    top: 320,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  transportButtons: {flexDirection: 'row', alignItems: 'center', gap: 42},
  seekFeedback: {fontSize: 18, color: C.text, height: 34, marginBottom: 16},
  timelineArea: {position: 'absolute', bottom: 147, left: 46, right: 46},
  timeline: {
    paddingHorizontal: 10,
    paddingTop: 18,
    paddingBottom: 10,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  timelineFocused: {
    borderColor: C.accent,
    backgroundColor: 'rgba(25,31,39,0.6)',
  },
  track: {
    height: 5,
    backgroundColor: C.line,
    borderRadius: 4,
    marginBottom: 15,
  },
  playhead: {
    position: 'absolute',
    top: -3,
    marginLeft: -5,
    width: 11,
    height: 11,
    borderRadius: 8,
    backgroundColor: C.accent,
  },
  timeLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  time: {
    fontSize: 17,
    lineHeight: 24,
    color: C.text,
    minWidth: 80,
    fontVariant: ['tabular-nums'],
  },
  timelineHint: {
    fontSize: 15,
    lineHeight: 24,
    color: C.dim,
    flex: 1,
    textAlign: 'center',
  },
  utilities: {
    position: 'absolute',
    bottom: 40,
    left: 56,
    right: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  utilitySide: {flex: 1, gap: 8},
  utilityButtons: {flexDirection: 'row', gap: 32, alignItems: 'center'},
  recovery: {
    position: 'absolute',
    top: 195,
    left: 220,
    right: 220,
    alignItems: 'center',
  },
  recoveryMark: {
    width: 64,
    height: 64,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  recoverySymbol: {fontSize: 34, fontWeight: '500', color: C.accent},
  recoveryTitle: {
    fontSize: 34,
    lineHeight: 44,
    fontWeight: '600',
    color: C.text,
  },
  recoveryCopy: {
    fontSize: 20,
    lineHeight: 29,
    color: C.muted,
    textAlign: 'center',
    marginTop: 12,
  },
  recoveryActions: {flexDirection: 'row', gap: 14, marginTop: 32},
  recoveryNote: {
    fontSize: 16,
    lineHeight: 24,
    color: C.dim,
    marginTop: 22,
    textAlign: 'center',
  },
  loading: {
    position: 'absolute',
    top: 278,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loadingTitle: {fontSize: 25, color: C.text, marginTop: 24},
  loadingNote: {fontSize: 18, color: C.muted, marginTop: 12},
  settingLabel: {fontSize: 17, lineHeight: 25, color: C.muted},
  optionNote: {fontSize: 17, lineHeight: 26, color: C.muted, marginTop: 12},
});
