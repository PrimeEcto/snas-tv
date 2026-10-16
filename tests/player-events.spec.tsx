import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {DetailsScreen} from '../src/ui/DetailsScreen';
import {BrowseScreen, HomeScreen} from '../src/ui/CatalogScreen';
import {PlayerScreen} from '../src/ui/PlayerScreen';
import {PlayerSurface} from '../firetv/player/android';
import {loadWatch} from '../src/player';
import {demoTitles} from '../src/catalog/service';
import {emptyLibrary} from '../src/state/library';

jest.mock('react-native', () => ({
  View: 'View',
  Image: 'Image',
  FlatList: 'FlatList',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: {absoluteFill: {}, create: (styles: any) => styles},
  BackHandler: {addEventListener: () => ({remove: () => {}})},
}));
let mockTVHandler: (event: any) => void;
jest.mock(
  'snas-tv',
  () => ({
    useTVEventHandler: (handler: any) => {
      mockTVHandler = handler;
    },
  }),
  {virtual: true},
);
let mockNativeSurface = false;
jest.mock(
  'snas-player',
  () => ({
    supportsPlayback: true,
    PlayerSurface: (props: any) =>
      require('react').createElement(
        mockNativeSurface
          ? require('../firetv/player/android').PlayerSurface
          : 'PlayerSurface',
        props,
      ),
  }),
  {virtual: true},
);
const mockFocusTarget = () => {};
jest.mock('../src/ui/focus', () => ({
  FocusScope: ({children, active = true}: any) => (active ? children : null),
  useFocusNode: () => ({ref: () => {}, remember: () => {}}),
  useFocusTarget: () => mockFocusTarget,
}));
jest.mock('../src/ui/icons', () => ({Icon: () => null}));
jest.mock('../src/ui/motion', () => ({useReducedMotion: () => false}));
jest.mock('../src/ui/TVOverlay', () => ({
  TVOverlay: ({visible, children, ...props}: any) =>
    visible
      ? require('react').createElement('TVOverlay', props, children)
      : null,
}));
jest.mock('../src/ui/controls', () => ({
  Button: (props: any) => require('react').createElement('Button', props),
  IconButton: (props: any) => require('react').createElement('Button', props),
  Artwork: () => null,
  Meta: () => null,
  Rail: () => null,
  LinearGradient: () => null,
}));
jest.mock('../src/player', () => ({
  loadWatch: jest.fn(),
  subtitleUrl: (id: string) => `https://example.test/${id}.vtt`,
}));
const mockSeek = jest.fn();
jest.mock('react-native-video', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({seek: mockSeek}));
      return React.createElement('Video', props);
    }),
    SelectedTrackType: {INDEX: 'index', DISABLED: 'disabled'},
    TextTrackType: {VTT: 'text/vtt'},
  };
});

const title = demoTitles[0];
const watch = {
  sources: [{quality: '1080p', url: 'https://example.test/a.m3u8'}],
  headers: {},
  subtitleGroups: [{language: 'en', subtitles: []}],
  subtitleCount: 1,
};
let mounted: ReactTestRenderer;
const component = (preferences = emptyLibrary().preferences) => (
  <PlayerScreen
    title={title}
    position={600}
    preferences={preferences}
    catalog={{} as never}
    onSave={() => {}}
    onExit={() => {}}
    onEpisode={() => {}}
  />
);
const surface = () => mounted.root.findByType('PlayerSurface' as never);
const button = (id: string) =>
  mounted.root.findAllByType('Button' as never).find((n) => n.props.id === id)!;

beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.useFakeTimers();
  jest
    .mocked(loadWatch)
    .mockReset()
    .mockResolvedValue(watch as never);
  mockSeek.mockReset();
  mockNativeSurface = false;
});
afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  jest.useRealTimers();
});

test('Retry restores the last native position instead of the session-entry position', async () => {
  await act(async () => {
    mounted = create(component());
  });
  await act(async () =>
    surface().props.onProgress({position: 600, duration: 7200}),
  );
  await act(async () =>
    surface().props.onProgress({position: 2400, duration: 7200}),
  );
  await act(async () => surface().props.onError('Source failed'));
  await act(async () => button('player-retry').props.onPress());
  await act(async () =>
    surface().props.onProgress({position: 0, duration: 7200}),
  );
  expect(surface().props.seekTo).toBe(2400);
});

test('saving a changed subtitle preference does not refetch the active stream', async () => {
  await act(async () => {
    mounted = create(component());
  });
  await act(async () =>
    surface().props.onProgress({position: 600, duration: 7200}),
  );
  await act(async () => button('player-subtitles').props.onPress());
  await act(async () => button('option-en').props.onPress());
  await act(async () => {
    mounted.update(component({...emptyLibrary().preferences, subtitles: 'en'}));
  });
  expect(loadWatch).toHaveBeenCalledTimes(1);
});

test('a seek at the same position applies again when the media URI changes', async () => {
  await act(async () => {
    mounted = create(
      <PlayerSurface uri="https://example.test/a" paused seekTo={600} />,
    );
  });
  expect(mockSeek).toHaveBeenCalledTimes(1);
  await act(async () =>
    mounted.update(
      <PlayerSurface uri="https://example.test/a" paused seekTo={600} />,
    ),
  );
  expect(mockSeek).toHaveBeenCalledTimes(1);
  await act(async () =>
    mounted.update(<PlayerSurface uri="https://example.test/b" paused />),
  );
  await act(async () =>
    mounted.update(
      <PlayerSurface uri="https://example.test/b" paused seekTo={600} />,
    ),
  );
  expect(mockSeek).toHaveBeenCalledTimes(2);
});

test('attaching subtitles starts the replacement source at the last native position in milliseconds', async () => {
  await act(async () => {
    mounted = create(<PlayerSurface uri="https://example.test/a" paused />);
  });
  const video = () => mounted.root.findByType('Video' as never);
  await act(async () => video().props.onProgress({currentTime: 2400}));
  await act(async () =>
    mounted.update(
      <PlayerSurface
        uri="https://example.test/a"
        paused
        subtitleUri="https://example.test/en.vtt"
      />,
    ),
  );
  expect(video().props.source.startPosition).toBe(2400000);
});

test('selecting the same season twice keeps the header Play action available', async () => {
  const series = {...title, kind: 'tv' as const};
  const episode = {
    id: 20,
    season: 1,
    number: 1,
    title: 'Pilot',
    overview: '',
    runtime: 45,
    still: null,
  };
  const catalog = {
    detail: async () => ({
      ...series,
      episodes: [episode],
      related: [],
      seasonNumbers: [1],
    }),
  };
  await act(async () => {
    mounted = create(
      <DetailsScreen
        catalog={catalog as never}
        title={series}
        library={emptyLibrary()}
        onPlay={() => {}}
        onToggle={() => {}}
        onBack={() => {}}
        onOpen={() => {}}
        onDemo={() => {}}
      />,
    );
  });
  await act(async () => button('details-season').props.onPress());
  await act(async () => button('season-1').props.onPress());
  await act(async () => button('details-season').props.onPress());
  await act(async () => button('season-1').props.onPress());
  expect(button('details-play').props.disabled).toBe(false);
});

test('Settings groups current values and a quality change resumes at the latest position', async () => {
  jest.mocked(loadWatch).mockResolvedValue({
    ...watch,
    sources: [
      ...watch.sources,
      {quality: '720p', url: 'https://example.test/b.m3u8'},
    ],
  } as never);
  await act(async () => {
    mounted = create(component());
  });
  await act(async () =>
    surface().props.onProgress({position: 600, duration: 7200}),
  );
  await act(async () =>
    surface().props.onProgress({position: 2400, duration: 7200}),
  );
  expect(button('player-quality')).toBeUndefined();
  await act(async () => button('player-settings').props.onPress());
  expect(button('player-quality').props.label).toBe('1080p');
  expect(button('player-speed').props.label).toBe('1×');
  await act(async () => button('player-quality').props.onPress());
  expect(button('option-1080p').props.selected).toBe(true);
  await act(async () => button('option-720p').props.onPress());
  expect(surface().props.uri).toBe('https://example.test/b.m3u8');
  expect(button('player-quality').props.label).toBe('720p');
  await act(async () =>
    surface().props.onProgress({position: 0, duration: 7200}),
  );
  expect(surface().props.seekTo).toBe(2400);
});

test('focused timeline handles remote seeking, reports full duration, and suppresses seeking inside menus', async () => {
  await act(async () => {
    mounted = create(component());
  });
  await act(async () =>
    surface().props.onProgress({position: 600, duration: 7200}),
  );
  const timeline = () => mounted.root.findByProps({testID: 'player-timeline'});
  await act(async () => timeline().props.onFocus());
  await act(async () => mockTVHandler({eventType: 'right', eventKeyAction: 0}));
  expect(surface().props.seekTo).toBe(610);
  expect(timeline().props.accessibilityValue).toMatchObject({
    now: 610,
    max: 7200,
  });
  expect(
    mounted.root.findByProps({testID: 'player-duration'}).props.children,
  ).toBe('2:00:00');
  await act(async () => button('player-settings').props.onPress());
  await act(async () => mockTVHandler({eventType: 'right', eventKeyAction: 0}));
  expect(surface().props.seekTo).toBe(610);
});

test('failure shows composed recovery without raw native errors, transport, or simulated saves', async () => {
  const save = jest.fn();
  jest
    .mocked(loadWatch)
    .mockRejectedValue(
      new Error('ExoPlaybackException: private provider details'),
    );
  await act(async () => {
    mounted = create(
      <PlayerScreen
        title={title}
        position={600}
        preferences={emptyLibrary().preferences}
        catalog={{} as never}
        onSave={save}
        onExit={() => {}}
        onEpisode={() => {}}
      />,
    );
  });
  expect(
    mounted.root.findByProps({testID: 'player-error'}).props.children,
  ).toBe('This title couldn’t play. Try again to reconnect.');
  expect(button('player-toggle')).toBeUndefined();
  expect(button('player-settings')).toBeUndefined();
  await act(async () => jest.advanceTimersByTime(11000));
  expect(save).not.toHaveBeenCalled();
  await act(async () => button('player-preview').props.onPress());
  expect(button('player-toggle')).toBeDefined();
  await act(async () => jest.advanceTimersByTime(5000));
  expect(save).toHaveBeenCalled();
});

test('completed playback keeps the replay action and restarts at zero', async () => {
  await act(async () => {
    mounted = create(component());
  });
  await act(async () =>
    surface().props.onProgress({position: 600, duration: 7200}),
  );
  await act(async () => surface().props.onEnded());
  expect(button('player-toggle').props.label).toBe('Replay');
  await act(async () => button('player-toggle').props.onPress());
  expect(surface().props.seekTo).toBe(0);
  expect(surface().props.paused).toBe(false);
});

test('subtitle reload preserves the native clock without replaying a stale seek command', async () => {
  await act(async () => {
    mounted = create(
      <PlayerSurface uri="https://example.test/a" paused seekTo={600} />,
    );
  });
  const video = () => mounted.root.findByType('Video' as never);
  await act(async () => video().props.onProgress({currentTime: 2400}));
  await act(async () =>
    mounted.update(
      <PlayerSurface
        uri="https://example.test/a"
        paused
        seekTo={600}
        subtitleUri="https://example.test/en.vtt"
      />,
    ),
  );
  expect(video().props.source.startPosition).toBe(2400000);
  expect(mockSeek).toHaveBeenCalledTimes(1);
});

test('a native error reveals recovery after playback controls have hidden', async () => {
  await act(async () => {
    mounted = create(component());
  });
  await act(async () =>
    surface().props.onProgress({position: 610, duration: 7200}),
  );
  await act(async () => {
    jest.advanceTimersByTime(8000);
  });
  expect(button('player-toggle')).toBeUndefined();
  await act(async () => surface().props.onError('Decoder failed'));
  expect(button('player-retry')).toBeDefined();
});

test('browse retry requests the failed page and preserves earlier pages', async () => {
  const first = {...demoTitles[0], id: 1001};
  const second = {...demoTitles[0], id: 1002};
  const third = {...demoTitles[0], id: 1003};
  const discover = jest
    .fn()
    .mockResolvedValueOnce({items: [first], totalPages: 3})
    .mockResolvedValueOnce({items: [second], totalPages: 3})
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({items: [third], totalPages: 3});
  await act(async () => {
    mounted = create(
      <BrowseScreen
        kind="movie"
        catalog={{discover, mode: 'live'} as never}
        library={emptyLibrary()}
        onOpen={() => {}}
        onPlay={() => {}}
        onResume={() => {}}
        onToggle={() => {}}
        onExplore={() => {}}
        onDemo={() => {}}
      />,
    );
  });
  const grid = () => mounted.root.findByType('FlatList' as never);
  const more = () =>
    grid().props.ListFooterComponent.props.children.props.onPress();
  await act(async () => more());
  await act(async () => more());
  expect(grid().props.data).toEqual([first, second]);
  await act(async () => button('browse-retry').props.onPress());
  expect(discover.mock.calls.map((call) => call[3])).toEqual([1, 2, 3, 3]);
  expect(grid().props.data).toEqual([first, second, third]);
});

test('Home synopsis keeps abbreviations within a complete short overview', async () => {
  const overview =
    'When the son of an L.A. mayor disappears, the family must find him.';
  const home = jest.fn().mockResolvedValue([
    {
      id: 'featured',
      title: 'Trending now',
      items: [{...demoTitles[0], overview}],
    },
  ]);
  await act(async () => {
    mounted = create(
      <HomeScreen
        catalog={{home} as never}
        library={emptyLibrary()}
        onOpen={() => {}}
        onPlay={() => {}}
        onResume={() => {}}
        onToggle={() => {}}
        onExplore={() => {}}
        onDemo={() => {}}
      />,
    );
  });
  const text = mounted.root
    .findAllByType('Text' as never)
    .map((node) => node.props.children);
  expect(text).toContain(overview);
});

test('the concept player uses one quiet mode label without preview banners', async () => {
  jest.mocked(loadWatch).mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    mounted = create(component());
  });
  await act(async () => button('player-preview').props.onPress());
  const text = mounted.root
    .findAllByType('Text' as never)
    .flatMap((node) =>
      typeof node.props.children === 'string' ? [node.props.children] : [],
    );
  expect(text).toContain('Concept');
  expect(text.join(' ')).not.toMatch(/preview|simulated|No video or audio/i);
});

test('replaying the same title twice sends a fresh native seek each time', async () => {
  mockNativeSurface = true;
  await act(async () => {
    mounted = create(component());
  });
  const video = () => mounted.root.findByType('Video' as never);
  await act(async () =>
    video().props.onLoad({duration: 7200, currentTime: 600}),
  );
  for (let replay = 0; replay < 2; replay++) {
    await act(async () => video().props.onEnd());
    await act(async () => button('player-toggle').props.onPress());
    await act(async () => video().props.onProgress({currentTime: 0}));
  }
  expect(mockSeek.mock.calls.map((call) => call[0])).toEqual([600, 0, 0]);
});
