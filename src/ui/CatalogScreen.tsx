import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  StyleSheet,
  Pressable,
} from 'react-native';
import {Catalog, demoTitles, movieGenres, tvGenres} from '../catalog/service';
import type {Title, Kind, Rail as RailData} from '../catalog/types';
import {continueWatching, type Library, type Progress} from '../state/library';
import {Button, Card, Rail, Meta} from './controls';
import {C, TV} from './theme';
import {CinematicArtwork} from './CinematicArtwork';
import {useFocusTarget, useFocusNode} from './focus';
import {Icon, type IconName} from './icons';
import {TVOverlay} from './TVOverlay';
import {useReducedMotion} from './motion';
import {supportsPlayback} from 'snas-player';
const genreLabel = (genre: string) =>
  genre === 'All' ? 'All genres' : genre === 'Western' ? 'Westerns' : genre;
type Props = {
  catalog: Catalog;
  library: Library;
  onOpen: (t: Title) => void;
  onPlay: (t: Title) => void;
  onResume: (p: Progress) => void;
  onToggle: (t: Title) => void;
  onExplore: () => void;
  onDemo: () => void;
};
export function HomeScreen(p: Props) {
  const [rails, setRails] = useState<RailData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const rowYs = useRef<Record<string, number>>({});
  const reduced = useReducedMotion();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setRails([]);
    p.catalog
      .home()
      .then((value) => {
        if (alive) setRails(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [p.catalog, attempt]);
  const featured =
    rails[0]?.items.find((t) => t.id === 157336) ||
    rails[0]?.items[0] ||
    demoTitles[0];
  const progress = continueWatching(p.library);
  const top = () => scroll.current?.scrollTo({y: 0, animated: !reduced});
  const overview = featured.overview.replace(/\s+/g, ' ').trim();
  const summary = overview
    ? overview.length <= 180
      ? overview
      : `${overview.slice(0, 180).replace(/\s+\S*$/, '')}…`
    : 'A synopsis is not available for this title.';
  return (
    <ScrollView
      ref={scroll}
      style={s.fill}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.homeContent}>
      <View style={[s.hero, !!error && s.heroError]}>
        <CinematicArtwork title={featured} />
        <View style={s.heroCopy}>
          <Text numberOfLines={2} style={s.heroTitle}>
            {featured.title}
          </Text>
          <Meta title={featured} />
          <Text style={s.heroOverview}>{summary}</Text>
          {error && (
            <Text style={s.sampleNote}>
              Sample title · Live catalog unavailable
            </Text>
          )}
          <View style={s.actions}>
            <Button
              id="home-play"
              label={supportsPlayback ? 'Play' : 'Explore player'}
              icon="play"
              primary
              onFocus={top}
              onPress={() => p.onPlay(featured)}
            />
            <Button
              id="home-details"
              label="Details"
              icon="info"
              onFocus={top}
              onPress={() => p.onOpen(featured)}
            />
          </View>
        </View>
      </View>
      {error && (
        <View style={s.error}>
          <Text style={s.errorTitle}>Your catalog is out of reach.</Text>
          <Text style={s.errorBody}>
            Check your connection, then try again or explore the sample catalog.
          </Text>
          <View style={s.actions}>
            <Button
              id="home-retry"
              label="Try again"
              onPress={() => setAttempt((n) => n + 1)}
            />
            <Button
              id="home-demo"
              label="Use sample catalog"
              onPress={p.onDemo}
            />
          </View>
        </View>
      )}
      {loading && (
        <View style={s.skeleton}>
          <Text style={s.loading}>Finding your next watch…</Text>
          <View style={s.actions}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <View key={n} style={s.skeletonCover} />
            ))}
          </View>
        </View>
      )}
      {progress.length > 0 && (
        <View
          onLayout={(e) => (rowYs.current.continue = e.nativeEvent.layout.y)}>
          <Rail
            id="continue"
            title="Continue watching"
            wide
            items={progress.map((x) => x.title)}
            progress={Object.fromEntries(
              progress.map((x) => [
                `${x.title.kind}:${x.title.id}`,
                x.position / x.duration,
              ]),
            )}
            onOpen={(title) => {
              const item = progress.find(
                (x) => x.title.id === title.id && x.title.kind === title.kind,
              );
              if (item) p.onResume(item);
            }}
            onFocus={() =>
              scroll.current?.scrollTo({
                y: Math.max(0, (rowYs.current.continue || 0) - 24),
                animated: !reduced,
              })
            }
          />
        </View>
      )}
      {rails.map((rail) => (
        <View
          key={rail.id}
          onLayout={(e) => (rowYs.current[rail.id] = e.nativeEvent.layout.y)}>
          <Rail
            {...rail}
            onOpen={p.onOpen}
            onFocus={() =>
              scroll.current?.scrollTo({
                y: Math.max(0, (rowYs.current[rail.id] || 0) - 24),
                animated: !reduced,
              })
            }
          />
        </View>
      ))}
      <Text style={s.footer}>
        {p.catalog.mode === 'demo'
          ? 'Genuine sample catalog'
          : 'Discovery by TMDB'}{' '}
        ·{' '}
        {supportsPlayback
          ? 'Playback depends on source availability'
          : 'Player concept'}
      </Text>
    </ScrollView>
  );
}
export function BrowseScreen(p: Props & {kind: Kind}) {
  const grid = useRef<FlatList<Title>>(null);
  const [genre, setGenre] = useState('All');
  const [sort, setSort] = useState('popularity.desc');
  const [items, setItems] = useState<Title[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<'genre' | 'sort' | null>(null);
  const failedPage = useRef(1);
  const focusTarget = useFocusTarget();
  const reduced = useReducedMotion();
  const generation = useRef({value: 0}).current;
  const count = useRef(0);
  count.current = items.length;
  const load = useCallback(
    (next = 1) => {
      const gen = ++generation.value;
      failedPage.current = next;
      setLoading(true);
      setError('');
      if (next === 1) setItems([]);
      p.catalog
        .discover(p.kind, genre, sort, next)
        .then((result) => {
          if (gen !== generation.value) return;
          const previous = count.current;
          setItems((old) =>
            next === 1
              ? result.items
              : [
                  ...old,
                  ...result.items.filter(
                    (t) => !old.some((x) => x.id === t.id && x.kind === t.kind),
                  ),
                ],
          );
          setPage(next);
          setTotal(result.totalPages);
          if (next > 1 && result.items.length) {
            const first = result.items[0];
            setTimeout(() => {
              if (gen !== generation.value) return;
              grid.current?.scrollToIndex({
                index: Math.floor(previous / 7),
                viewPosition: 0.5,
                animated: !reduced,
              });
              setTimeout(() => {
                if (gen === generation.value)
                  focusTarget(`browse-${first.kind}-${first.id}`);
              }, 220);
            }, 120);
          }
        })
        .catch((e) => {
          if (gen === generation.value) setError(e.message);
        })
        .finally(() => {
          if (gen === generation.value) setLoading(false);
        });
    },
    [p.catalog, p.kind, genre, sort, focusTarget, reduced, generation],
  );
  useEffect(() => {
    load();
    return () => {
      generation.value++;
    };
  }, [load, generation]);
  const close = useCallback(() => {
    const trigger = menu;
    setMenu(null);
    setTimeout(() => focusTarget(trigger || 'genre'), 180);
  }, [menu, focusTarget]);
  const choose = (value: string) => {
    if (menu === 'genre') setGenre(value);
    else setSort(value);
    close();
  };
  const sorts = [
    ['popularity.desc', p.catalog.mode === 'demo' ? 'Curated' : 'Popular'],
    [
      p.kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      'Newest',
    ],
    ...(p.catalog.mode === 'live'
      ? [['vote_average.desc', 'Highest TMDB rating']]
      : []),
    ['original_title.asc', 'Title A–Z'],
  ];
  const sortName = sorts.find((x) => x[0] === sort)?.[1];
  return (
    <View style={s.page}>
      <View style={s.heading}>
        <View>
          <Text style={s.headingTitle}>
            {p.kind === 'movie' ? 'Movies' : 'Series'}
          </Text>
        </View>
        <View style={s.actions}>
          <CatalogControl
            id="genre"
            label={genreLabel(genre)}
            icon="chevronDown"
            selected={menu === 'genre'}
            onPress={() => setMenu('genre')}
          />
          <CatalogControl
            id="sort"
            label={sortName || 'Popular'}
            icon="sort"
            selected={menu === 'sort'}
            onPress={() => setMenu('sort')}
          />
        </View>
      </View>
      <TVOverlay
        visible={!!menu}
        onClose={close}
        initial={`filter-${menu === 'genre' ? genre : sort}`}
        title={menu === 'genre' ? 'Choose a genre' : 'Sort titles'}
        subtitle={
          menu === 'genre'
            ? 'Choose what you feel like watching.'
            : 'Choose how titles are ordered.'
        }
        width={menu === 'genre' ? 620 : 520}
        testID="browse-filter-sheet">
        <FilterOptions
          key={menu}
          columns={menu === 'genre' ? 2 : 1}
          options={
            menu === 'genre'
              ? [
                  'All',
                  ...Object.keys(p.kind === 'movie' ? movieGenres : tvGenres),
                ].map((g) => [g, genreLabel(g)])
              : sorts
          }
          value={menu === 'genre' ? genre : sort}
          onChoose={choose}
        />
      </TVOverlay>
      {error && (
        <View style={s.inlineError}>
          <Text style={s.errorBody}>
            The catalog could not be loaded. Check your connection and try
            again.
          </Text>
          <View style={s.actions}>
            <Button
              id="browse-retry"
              label="Try again"
              onPress={() => load(failedPage.current)}
            />
            <Button
              id="browse-demo"
              label="Use sample catalog"
              onPress={p.onDemo}
            />
          </View>
        </View>
      )}
      {loading && <Text style={s.status}>Loading catalog…</Text>}
      <FlatList
        ref={grid}
        data={items}
        numColumns={7}
        keyExtractor={(t) => `${t.kind}-${t.id}`}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={21}
        maxToRenderPerBatch={14}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        contentContainerStyle={s.gridContent}
        onScrollToIndexFailed={() => {}}
        renderItem={({item, index}) => (
          <Card
            title={item}
            id={`browse-${item.kind}-${item.id}`}
            onFocus={() =>
              grid.current?.scrollToIndex({
                index: Math.floor(index / 7),
                viewPosition: 0.3,
                animated: !reduced,
              })
            }
            onPress={() => p.onOpen(item)}
          />
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={s.noResults}>
              No titles in this category. Choose another genre.
            </Text>
          ) : null
        }
        ListFooterComponent={
          items.length ? (
            <View style={s.more}>
              <Button
                id="browse-more"
                label={
                  loading
                    ? 'Loading…'
                    : page < total
                    ? 'Load more titles'
                    : 'Back to first title'
                }
                onPress={() => {
                  if (loading) return;
                  if (page < total) load(page + 1);
                  else {
                    grid.current?.scrollToOffset({
                      offset: 0,
                      animated: !reduced,
                    });
                    setTimeout(
                      () => focusTarget(`browse-${p.kind}-${items[0].id}`),
                      180,
                    );
                  }
                }}
              />
            </View>
          ) : null
        }
      />
    </View>
  );
}
export function MyListScreen(p: Props) {
  const [section, setSection] = useState<'saved' | 'continue'>('saved');
  const progress = continueWatching(p.library);
  const items =
    section === 'saved' ? p.library.watchlist : progress.map((x) => x.title);
  const grid = useRef<FlatList<Title>>(null);
  const reduced = useReducedMotion();
  const wide = section === 'continue';
  const columns = wide ? 4 : 7;
  return (
    <View style={s.library}>
      <View style={s.libraryHeading}>
        <Text style={s.headingTitle}>My List</Text>
        <View style={s.libraryTabs}>
          <LibraryTab
            id="list-saved"
            label="Saved"
            count={p.library.watchlist.length}
            selected={!wide}
            onPress={() => setSection('saved')}
          />
          <LibraryTab
            id="list-continue"
            label="Continue watching"
            count={progress.length}
            selected={wide}
            onPress={() => setSection('continue')}
          />
        </View>
      </View>
      {!items.length ? (
        <View style={s.libraryEmpty}>
          <View style={s.emptySymbol}>
            <Icon name={wide ? 'play' : 'plus'} size={30} color={C.muted} />
          </View>
          <Text style={s.emptyTitle}>
            {wide ? 'Nothing to resume yet' : 'No saved titles yet'}
          </Text>
          <Text style={s.emptyBody}>
            {wide
              ? 'Start a film or series. Your progress will appear here.'
              : 'Find a film or series and add it to My List from its details.'}
          </Text>
          <Button
            id="empty-action"
            label="Browse movies"
            onPress={p.onExplore}
          />
        </View>
      ) : (
        <FlatList
          ref={grid}
          key={section}
          style={s.libraryGrid}
          data={items}
          numColumns={columns}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          initialNumToRender={21}
          maxToRenderPerBatch={14}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          onScrollToIndexFailed={() => {}}
          renderItem={({item, index}) => {
            const entry = progress.find(
              (x) => x.title.id === item.id && x.title.kind === item.kind,
            );
            return (
              <Card
                title={item}
                id={`list-${item.kind}-${item.id}`}
                wide={wide}
                progress={
                  wide && entry ? entry.position / entry.duration : undefined
                }
                onFocus={() =>
                  grid.current?.scrollToIndex({
                    index: Math.floor(index / columns),
                    viewPosition: 0.3,
                    animated: !reduced,
                  })
                }
                onPress={() => {
                  if (wide && entry) p.onResume(entry);
                  else p.onOpen(item);
                }}
              />
            );
          }}
          keyExtractor={(t) => `${t.kind}-${t.id}`}
        />
      )}
    </View>
  );
}
function CatalogControl({
  id,
  label,
  icon,
  selected,
  onPress,
}: {
  id: string;
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(id);
  return (
    <Pressable
      ref={node.ref as never}
      hasTVPreferredFocus={node.preferred}
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={id === 'genre' ? `Genre, ${label}` : `Sort, ${label}`}
      accessibilityState={{expanded: selected}}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        node.remember();
      }}
      onBlur={() => setFocused(false)}
      style={[s.catalogControl, focused && s.controlFocused]}>
      <Text style={[s.controlLabel, focused && s.darkText]}>{label}</Text>
      <Icon name={icon} size={20} color={focused ? C.bg : C.muted} />
    </Pressable>
  );
}
function FilterOptions({
  options,
  columns,
  value,
  onChoose,
}: {
  options: string[][];
  columns: number;
  value: string;
  onChoose: (value: string) => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const reduced = useReducedMotion();
  return (
    <ScrollView
      ref={scroll}
      style={s.choiceScroll}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.choiceContent}>
      <View style={s.choices}>
        {options.map(([key, label], index) => (
          <FilterChoice
            key={key}
            id={`filter-${key}`}
            label={label}
            selected={key === value}
            columns={columns}
            onPress={() => onChoose(key)}
            onFocus={() =>
              scroll.current?.scrollTo({
                y: Math.max(0, Math.floor(index / columns) * 56 - 160),
                animated: !reduced,
              })
            }
          />
        ))}
      </View>
    </ScrollView>
  );
}
function FilterChoice({
  id,
  label,
  selected,
  columns,
  onPress,
  onFocus,
}: {
  id: string;
  label: string;
  selected: boolean;
  columns: number;
  onPress: () => void;
  onFocus: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(id);
  return (
    <Pressable
      ref={node.ref as never}
      hasTVPreferredFocus={node.preferred}
      testID={id}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{selected, checked: selected}}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        node.remember();
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      style={[
        s.choice,
        columns === 2 ? s.halfChoice : s.fullChoice,
        selected && s.choiceSelected,
        focused && s.controlFocused,
      ]}>
      <Text
        style={[
          s.choiceLabel,
          selected && s.selectedText,
          focused && s.darkText,
        ]}>
        {label}
      </Text>
      <View style={s.choiceMarker}>
        {selected && (
          <Icon name="check" size={20} color={focused ? C.bg : C.accent} />
        )}
      </View>
    </Pressable>
  );
}
function LibraryTab({
  id,
  label,
  count,
  selected,
  onPress,
}: {
  id: string;
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(id);
  return (
    <Pressable
      ref={node.ref as never}
      hasTVPreferredFocus={node.preferred}
      testID={id}
      accessibilityRole="tab"
      accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{selected}}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        node.remember();
      }}
      onBlur={() => setFocused(false)}
      style={[s.libraryTab, focused && s.controlFocused]}>
      <Text
        style={[
          s.tabLabel,
          selected && s.tabSelectedLabel,
          focused && s.darkText,
        ]}>
        {label}
      </Text>
      <Text style={[s.tabCount, focused && s.darkText]}>{count}</Text>
      {selected && (
        <View style={[s.tabUnderline, focused && s.darkUnderline]} />
      )}
    </Pressable>
  );
}
const s = StyleSheet.create({
  fill: {flex: 1},
  homeContent: {paddingBottom: 36},
  hero: {minHeight: 280, marginBottom: 4},
  heroError: {minHeight: 340},
  heroCopy: {
    paddingLeft: TV.edge,
    paddingTop: 20,
    paddingBottom: 24,
    width: 660,
  },
  heroTitle: {
    fontSize: 46,
    lineHeight: 50,
    color: C.text,
    fontWeight: '700',
    letterSpacing: -1,
    marginBottom: 10,
    maxWidth: 600,
  },
  heroOverview: {
    fontSize: 18,
    lineHeight: 25,
    color: C.text,
    marginTop: 12,
    marginBottom: 18,
    maxWidth: 590,
  },
  sampleNote: {fontSize: 16, color: C.error, marginBottom: 10},
  actions: {flexDirection: 'row', alignItems: 'center', gap: 12},
  error: {
    marginHorizontal: TV.edge,
    marginBottom: 28,
    padding: 24,
    backgroundColor: C.surface,
    borderRadius: 6,
  },
  errorTitle: {
    fontSize: 24,
    color: C.text,
    fontWeight: '600',
    marginBottom: 10,
  },
  errorBody: {color: C.muted, fontSize: 18, lineHeight: 27, marginBottom: 18},
  skeleton: {marginHorizontal: TV.edge, marginBottom: 30},
  loading: {fontSize: 24, color: C.muted, marginBottom: 18},
  skeletonCover: {
    width: TV.poster,
    height: TV.posterHeight,
    backgroundColor: C.surface,
    marginRight: 18,
  },
  footer: {
    fontSize: 16,
    color: C.dim,
    marginHorizontal: TV.edge,
    marginTop: 12,
  },
  page: {flex: 1, paddingHorizontal: TV.edge, paddingTop: 24},
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headingTitle: {
    fontSize: 36,
    lineHeight: 43,
    color: C.text,
    fontWeight: '600',
  },
  inlineError: {marginBottom: 20},
  status: {color: C.muted, fontSize: 18, marginBottom: 16},
  gridContent: {paddingBottom: 30},
  noResults: {
    color: C.muted,
    fontSize: 23,
    lineHeight: 32,
    marginTop: 45,
    maxWidth: 600,
  },
  more: {alignItems: 'flex-start', marginTop: 22, marginBottom: 18},
  catalogControl: {
    height: 44,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: 6,
  },
  controlLabel: {fontSize: 18, color: C.text, fontWeight: '500'},
  controlFocused: {backgroundColor: C.accent, borderColor: C.text},
  darkText: {color: C.bg},
  choiceScroll: {flex: 1},
  choiceContent: {paddingBottom: 18},
  choices: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  choice: {
    height: 50,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 6,
    gap: 6,
  },
  halfChoice: {width: '49%'},
  fullChoice: {width: '100%'},
  choiceSelected: {backgroundColor: C.surface},
  choiceLabel: {fontSize: 18, color: C.muted, flex: 1},
  selectedText: {color: C.text, fontWeight: '600'},
  choiceMarker: {width: 20},
  library: {flex: 1, paddingTop: 24},
  libraryHeading: {marginHorizontal: TV.edge, marginBottom: 22},
  libraryTabs: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingBottom: 8,
  },
  libraryTab: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 6,
  },
  tabLabel: {fontSize: 19, color: C.muted},
  tabSelectedLabel: {color: C.text, fontWeight: '600'},
  tabCount: {fontSize: 16, color: C.dim},
  tabUnderline: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: -10,
    height: 3,
    backgroundColor: C.accent,
  },
  darkUnderline: {backgroundColor: C.accent},
  libraryGrid: {marginHorizontal: TV.edge - 4},
  libraryEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 68,
    paddingHorizontal: TV.edge,
  },
  emptySymbol: {
    height: 62,
    width: 62,
    borderRadius: 31,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  emptyTitle: {
    fontSize: 26,
    lineHeight: 33,
    color: C.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 18,
    lineHeight: 27,
    color: C.muted,
    textAlign: 'center',
    maxWidth: 440,
    marginTop: 10,
    marginBottom: 24,
  },
});
