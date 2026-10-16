import React, {useState, useMemo, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
  BackHandler,
  Image,
} from 'react-native';
import backend from './backend.json';
import {version as appVersion} from '../package.json';
import {checkForUpdate, updateMessage, type UpdateCheck} from './update';
import {Catalog} from './catalog/service';
import type {Title, Episode} from './catalog/types';
import {useLibrary} from './state/useLibrary';
import {continueWatching, type Progress} from './state/library';
import {progressKey, type PlaybackState} from './state/playback';
import {HomeScreen, BrowseScreen, MyListScreen} from './ui/CatalogScreen';
import {SearchScreen} from './ui/SearchScreen';
import {DetailsScreen} from './ui/DetailsScreen';
import {PlayerScreen} from './ui/PlayerScreen';
import {FocusScope, useFocusNode} from './ui/focus';
import {AboutScreen} from './ui/AboutScreen';
import {IconButton} from './ui/controls';
import {MotionProvider} from './ui/motion';
import {BootScreen} from './ui/BootScreen';
import {preloadHome} from './catalog/preload';
import {C, TV} from './ui/theme';
type Tab = 'Home' | 'Movies' | 'Series' | 'Search' | 'My List' | 'About';
type Player = {
  title: Title;
  episode?: Episode;
  position: number;
  serial: number;
};
function NavItem({
  name,
  active,
  onPress,
}: {
  name: Tab;
  active: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(`nav-${name}`);
  if (name === 'Search' || name === 'About')
    return (
      <IconButton
        id={`nav-${name}`}
        label={name === 'About' ? 'Settings' : 'Search'}
        icon={name === 'About' ? 'settings' : 'search'}
        size={46}
        selected={active}
        onPress={onPress}
      />
    );
  return (
    <Pressable
      ref={node.ref as never}
      testID={`nav-${name}`}
      hasTVPreferredFocus={node.preferred}
      accessibilityRole="tab"
      accessibilityLabel={name}
      accessibilityState={{selected: active}}
      onFocus={() => {
        setFocused(true);
        node.remember();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        paddingHorizontal: 15,
        paddingVertical: 11,
        borderRadius: 6,
        backgroundColor: focused ? C.text : 'transparent',
        borderWidth: 2,
        borderColor: focused ? C.accent : 'transparent',
      }}>
      <Text
        style={{
          fontSize: 19,
          fontWeight: active || focused ? '600' : '400',
          color: focused ? C.bg : active ? C.text : C.muted,
        }}>
        {name}
      </Text>
      {active && !focused && (
        <View
          style={{
            position: 'absolute',
            bottom: 2,
            left: 15,
            right: 15,
            height: 2,
            backgroundColor: C.accent,
          }}
        />
      )}
    </Pressable>
  );
}
// Direction contract retained in source and bundled via the branded About experience.
// Native Operate surface: cinematic art, restrained ink/sand system, restored remote focus.
// Catalogue data comes from the SNAS backend in src/backend.json, which keeps the TMDB
// credential server-side; the sample catalog stays available as an offline fallback.
export function App() {
  const {width, height} = useWindowDimensions();
  const scale = Math.min(width / 1280, height / 720);
  const [tab, setTab] = useState<Tab>('Home');
  const [visited, setVisited] = useState<Tab[]>(['Home']);
  const [details, setDetails] = useState<Title[]>([]);
  const [player, setPlayer] = useState<Player | null>(null);
  const [sample, setSample] = useState(false);
  const catalog = useMemo(
    () => new Catalog(sample ? '' : backend.tmdbProxy),
    [sample],
  );
  const store = useLibrary();
  const save = store.save;
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [booted, setBooted] = useState(false);
  const [progress, setProgress] = useState({done: 0, total: 0});
  const libraryRef = useRef(store.library);
  libraryRef.current = store.library;
  // A newer release is only ever reported here: installing one is a host-side action
  // (see scripts/device-watch.mjs), so this never interrupts playback or focus.
  useEffect(() => {
    let alive = true;
    checkForUpdate(backend.workerBase, appVersion)
      .then((result) => {
        if (alive && result.updateAvailable) setUpdate(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // Nothing mounts until every image home is about to paint is in the cache. Mounting the rails
  // first asks the network for a hundred posters at once, and the stutter lands on the hero; the
  // wave is bounded, so a slow or dead network ends it and the app opens anyway.
  useEffect(() => {
    if (!store.ready || booted) return;
    let alive = true;
    const prefetch = (url: string) => {
      const load = (
        Image as unknown as {prefetch?: (uri: string) => Promise<unknown>}
      ).prefetch;
      return typeof load === 'function' ? load(url) : Promise.resolve(false);
    };
    const finish = () => {
      if (alive) setBooted(true);
    };
    preloadHome(
      catalog,
      continueWatching(libraryRef.current).map((entry) => entry.title),
      {
        prefetch,
        onProgress: (next) => {
          if (alive) setProgress(next);
        },
      },
    ).then(finish, finish);
    return () => {
      alive = false;
    };
  }, [booted, catalog, store.ready]);
  const updateNote = update ? updateMessage(update) : undefined;
  const open = (t: Title) =>
    setDetails((old) =>
      old.length &&
      old[old.length - 1].id === t.id &&
      old[old.length - 1].kind === t.kind
        ? old
        : [...old, t],
    );
  const play = (t: Title, e?: Episode) => {
    const saved = store.library.progress[progressKey(t, e)];
    setPlayer((old) => ({
      title: t,
      episode: e,
      position: saved?.position || 0,
      serial: (old?.serial || 0) + 1,
    }));
  };
  const playFromHome = (title: Title) => {
    const last = continueWatching(store.library).find(
      (p) => p.title.id === title.id && p.title.kind === title.kind,
    );
    if (last) {
      resume(last);
      return;
    }
    if (title.kind === 'tv')
      catalog
        .detail(title)
        .then((d) => play(d, d.episodes[0]))
        .catch(() => open(title));
    else play(title);
  };
  const resume = (p: Progress) =>
    setPlayer((old) => ({
      title: p.title,
      episode: p.episode,
      position: p.position,
      serial: (old?.serial || 0) + 1,
    }));
  const exit = useCallback(
    (state?: PlaybackState) => {
      if (state) save(state);
      setPlayer(null);
    },
    [save],
  );
  const back = useCallback(() => {
    if (player) return false;
    if (details.length) {
      setDetails((old) => old.slice(0, -1));
      return true;
    }
    if (tab !== 'Home') {
      setTab('Home');
      return true;
    }
    return false;
  }, [player, details.length, tab]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]);
  const changeTab = (next: Tab) => {
    setVisited((old) => (old.includes(next) ? old : [...old, next]));
    setTab(next);
    setDetails([]);
  };
  const onDemo = () => setSample(true);
  const onLive = () => setSample(false);
  const props = {
    catalog,
    library: store.library,
    onOpen: open,
    onPlay: playFromHome,
    onResume: resume,
    onToggle: store.toggle,
    onExplore: () => changeTab('Movies'),
    onDemo,
  };
  return (
    <MotionProvider>
      <View style={{flex: 1, backgroundColor: C.bg}}>
        <View
          style={{
            width: 1280,
            height: 720,
            position: 'absolute',
            left: (width - 1280) / 2,
            top: (height - 720) / 2,
            transform: [{scale}],
            backgroundColor: C.bg,
          }}>
          {!store.ready || !booted ? (
            <BootScreen
              label={
                store.ready
                  ? 'Loading the artwork you are about to see'
                  : 'Opening your library'
              }
              done={progress.done}
              total={progress.total}
            />
          ) : (
            <>
              {player && (
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    zIndex: 10,
                  }}>
                  <PlayerScreen
                    key={`${player.serial}-${progressKey(
                      player.title,
                      player.episode,
                    )}`}
                    {...player}
                    catalog={catalog}
                    preferences={store.library.preferences}
                    onSave={store.save}
                    onExit={exit}
                    onEpisode={(e) => play(player.title, e)}
                  />
                </View>
              )}
              <View
                style={{flex: 1, display: player ? 'none' : 'flex'}}
                pointerEvents={player ? 'none' : 'auto'}
                accessibilityElementsHidden={!!player}>
                <View
                  style={{
                    height: TV.nav,
                    backgroundColor: C.bg,
                    paddingHorizontal: TV.edge,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderBottomWidth: 1,
                    borderBottomColor: 'rgba(182,190,201,0.08)',
                  }}>
                  <Text
                    accessibilityLabel="SNAS"
                    style={{
                      fontSize: 30,
                      fontWeight: '800',
                      letterSpacing: 4,
                      color: C.text,
                      marginRight: 42,
                    }}>
                    SNAS
                  </Text>
                  <View style={{flex: 1}}>
                    <FocusScope
                      active={!player}
                      autoFocus={false}
                      initial="nav-Home">
                      <View
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}>
                        <View
                          style={{
                            flex: 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 14,
                          }}>
                          {(
                            ['Home', 'Movies', 'Series', 'My List'] as Tab[]
                          ).map((name) => (
                            <NavItem
                              key={name}
                              name={name}
                              active={!player && tab === name}
                              onPress={() => changeTab(name)}
                            />
                          ))}
                        </View>
                        <View
                          style={{
                            flexDirection: 'row',
                            gap: 16,
                            marginLeft: 42,
                          }}>
                          {(['Search', 'About'] as Tab[]).map((name) => (
                            <NavItem
                              key={name}
                              name={name}
                              active={!player && tab === name}
                              onPress={() => changeTab(name)}
                            />
                          ))}
                        </View>
                      </View>
                    </FocusScope>
                  </View>
                </View>
                <View style={{flex: 1}}>
                  <FocusScope
                    active={!player && tab === 'Home' && !details.length}
                    initial="home-play">
                    <HomeScreen {...props} />
                  </FocusScope>
                  {visited.includes('Movies') && (
                    <FocusScope
                      active={!player && tab === 'Movies' && !details.length}
                      initial="genre">
                      <BrowseScreen {...props} kind="movie" />
                    </FocusScope>
                  )}
                  {visited.includes('Series') && (
                    <FocusScope
                      active={!player && tab === 'Series' && !details.length}
                      initial="genre">
                      <BrowseScreen {...props} kind="tv" />
                    </FocusScope>
                  )}
                  {visited.includes('Search') && (
                    <FocusScope
                      active={!player && tab === 'Search' && !details.length}
                      initial="key-A">
                      <SearchScreen
                        catalog={catalog}
                        onOpen={open}
                        onDemo={onDemo}
                      />
                    </FocusScope>
                  )}
                  {visited.includes('My List') && (
                    <FocusScope
                      active={!player && tab === 'My List' && !details.length}
                      initial="list-saved">
                      <MyListScreen {...props} />
                    </FocusScope>
                  )}
                  {visited.includes('About') && (
                    <FocusScope
                      active={!player && tab === 'About' && !details.length}
                      initial="settings-Catalog">
                      <AboutScreen
                        catalog={catalog}
                        onDemo={onDemo}
                        onLive={onLive}
                      />
                    </FocusScope>
                  )}
                  {details.map((t, i) => (
                    <FocusScope
                      key={`${i}-${t.kind}-${t.id}`}
                      active={!player && i === details.length - 1}
                      initial="details-play">
                      <DetailsScreen
                        catalog={catalog}
                        title={t}
                        library={store.library}
                        onPlay={play}
                        onToggle={store.toggle}
                        onBack={() => setDetails((old) => old.slice(0, -1))}
                        onOpen={open}
                        onDemo={onDemo}
                      />
                    </FocusScope>
                  ))}
                </View>
                {updateNote && (
                  <View
                    testID="update-banner"
                    style={{
                      position: 'absolute',
                      bottom: store.error ? 62 : 15,
                      left: 56,
                      right: 56,
                      backgroundColor: C.surface,
                      padding: 14,
                      borderRadius: 0,
                    }}>
                    <Text
                      accessibilityLabel="Update available"
                      style={{color: C.accent, fontSize: 17}}>
                      {updateNote}
                    </Text>
                  </View>
                )}
                {store.error && (
                  <View
                    style={{
                      position: 'absolute',
                      bottom: 15,
                      left: 56,
                      right: 56,
                      backgroundColor: C.surface,
                      padding: 14,
                      borderRadius: 0,
                    }}>
                    <Text style={{color: C.error, fontSize: 17}}>
                      {store.error}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}
        </View>
      </View>
    </MotionProvider>
  );
}
