import React, {useState, useEffect, useRef, useCallback} from 'react';
import {View, Text, FlatList, StyleSheet} from 'react-native';
import {Catalog, demoTitles} from '../catalog/service';
import type {Title} from '../catalog/types';
import {Button, Card} from './controls';
import {Icon} from './icons';
import {C, TV} from './theme';
import {useReducedMotion} from './motion';

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const keyRows = Array.from({length: 5}, (_, row) =>
  letters.slice(row * 8, row * 8 + 8).split(''),
);
const sampleSuggestions = demoTitles.slice(0, 4);

export function SearchScreen({
  catalog,
  onOpen,
  onDemo,
}: {
  catalog: Catalog;
  onOpen: (t: Title) => void;
  onDemo: () => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Title[]>([]);
  const [suggestions, setSuggestions] = useState<Title[]>([]);
  const [sampleFallback, setSampleFallback] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef({value: 0}).current;
  const grid = useRef<FlatList<Title>>(null);
  const reduced = useReducedMotion();
  const hasQuery = !!query.trim();

  useEffect(() => {
    let active = true;
    setSuggestions([]);
    setSampleFallback(false);
    setSuggestionsLoading(true);
    catalog.home().then(
      (rails) => {
        if (!active) return;
        const unique = new Map<string, Title>();
        // Alternate collections so the starting suggestions include films and series.
        for (let i = 0; i < 4; i++) {
          for (const rail of rails.slice(0, 2)) {
            const title = rail.items[i];
            if (title) unique.set(`${title.kind}-${title.id}`, title);
          }
        }
        setSuggestions(Array.from(unique.values()).slice(0, 4));
        setSuggestionsLoading(false);
      },
      () => {
        if (!active) return;
        setSuggestions(sampleSuggestions);
        setSampleFallback(true);
        setSuggestionsLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [catalog]);

  const search = useCallback(
    (next = 1) => {
      if (!query.trim()) return;
      const gen = ++generation.value;
      setLoading(true);
      setError('');
      if (next === 1) setItems([]);
      catalog
        .search(query, next)
        .then((result) => {
          if (gen !== generation.value) return;
          setItems((old) =>
            next === 1
              ? result.items
              : [
                  ...old,
                  ...result.items.filter(
                    (t) => !old.some((x) => x.kind === t.kind && x.id === t.id),
                  ),
                ],
          );
          setPage(next);
          setTotal(result.totalPages);
        })
        .catch(() => {
          if (gen === generation.value)
            setError(
              'Search is unavailable. Check your connection and try again.',
            );
        })
        .finally(() => {
          if (gen === generation.value) setLoading(false);
        });
    },
    [catalog, query, generation],
  );
  useEffect(() => {
    generation.value++;
    setItems([]);
    setPage(1);
    setTotal(1);
    setError('');
    setLoading(!!query.trim());
    grid.current?.scrollToOffset({offset: 0, animated: false});
    const timer = setTimeout(() => search(), 350);
    return () => {
      clearTimeout(timer);
      generation.value++;
    };
  }, [search, query, generation, attempt]);

  return (
    <View style={s.page}>
      <View style={s.heading}>
        <Text style={s.title}>Search</Text>
        <Text style={s.catalog}>
          {catalog.mode === 'demo'
            ? 'Sample catalog'
            : 'Movies and series from TMDB'}
        </Text>
      </View>
      <View style={s.layout}>
        <View style={s.keyboard}>
          <View
            testID="search-input"
            accessibilityLabel={`Search query: ${query || 'empty'}`}
            style={s.query}>
            <Icon name="search" color={query ? C.accent : C.dim} size={24} />
            <Text
              numberOfLines={1}
              ellipsizeMode="head"
              style={[s.queryText, !query && s.placeholder]}>
              {query || 'Enter a title'}
            </Text>
          </View>
          <View style={s.keys}>
            {keyRows.map((row, index) => (
              <View key={index} style={s.keyRow}>
                {row.map((char) => (
                  <View key={char} style={s.key}>
                    <Button
                      id={`key-${char}`}
                      compact
                      label={char}
                      disabled={query.length >= 80}
                      onPress={() => setQuery((q) => q + char)}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
          <View style={s.utilities}>
            <View style={s.utility}>
              <Button
                id="key-space"
                compact
                label="Space"
                disabled={query.length >= 80}
                onPress={() => setQuery((q) => (q.length < 80 ? q + ' ' : q))}
              />
            </View>
            <View style={s.utility}>
              <Button
                id="key-delete"
                compact
                label="Delete"
                onPress={() => setQuery((q) => q.slice(0, -1))}
              />
            </View>
            <View style={s.utility}>
              <Button
                id="key-clear"
                compact
                label="Clear"
                onPress={() => setQuery('')}
              />
            </View>
          </View>
          <Text style={s.help}>
            {query.length >= 80
              ? 'Delete a character to keep editing.'
              : 'Results update as you choose letters.'}
          </Text>
        </View>
        <View style={s.results}>
          <View style={s.resultsHeading}>
            <Text style={s.section}>
              {hasQuery ? 'Results' : 'Start with a title'}
            </Text>
            <Text style={s.resultStatus} accessibilityLiveRegion="polite">
              {!hasQuery
                ? 'Choose letters to find a movie or series.'
                : loading
                ? 'Searching…'
                : error
                ? 'Unable to load results'
                : `${items.length} ${
                    items.length === 1 ? 'title' : 'titles'
                  } shown for “${query.trim()}”`}
            </Text>
          </View>
          {!hasQuery && (
            <View style={s.suggestions}>
              <Text style={s.suggestionsTitle}>
                {sampleFallback || catalog.mode === 'demo'
                  ? 'Explore sample titles'
                  : 'Explore your catalog'}
              </Text>
              {sampleFallback && (
                <Text style={s.fallbackNote}>
                  Live suggestions are unavailable. These titles are from the
                  sample catalog.
                </Text>
              )}
              {suggestionsLoading ? (
                <Text style={s.resultStatus}>Loading suggestions…</Text>
              ) : (
                <View style={s.suggestionCards}>
                  {suggestions.map((title) => (
                    <Card
                      key={`${title.kind}-${title.id}`}
                      title={title}
                      id={`search-suggestion-${title.kind}-${title.id}`}
                      onPress={() => onOpen(title)}
                    />
                  ))}
                </View>
              )}
            </View>
          )}
          {!!error && (
            <View style={s.message}>
              <Text style={s.messageTitle}>Search couldn’t connect</Text>
              <Text style={s.messageBody}>{error}</Text>
              <View style={s.errorActions}>
                <Button
                  id="search-retry"
                  label="Try again"
                  primary
                  onPress={() => setAttempt((n) => n + 1)}
                />
                <Button
                  id="search-demo"
                  label="Use sample catalog"
                  onPress={onDemo}
                />
              </View>
            </View>
          )}
          {!loading && !error && hasQuery && !items.length && (
            <View style={s.message}>
              <Text style={s.messageTitle}>No matching titles</Text>
              <Text style={s.messageBody}>
                Try fewer words or a different spelling. Use Delete to edit your
                search.
              </Text>
            </View>
          )}
          {hasQuery && (
            <FlatList
              ref={grid}
              data={items}
              numColumns={4}
              removeClippedSubviews={false}
              initialNumToRender={12}
              maxToRenderPerBatch={8}
              updateCellsBatchingPeriod={50}
              windowSize={5}
              keyExtractor={(t) => `${t.kind}-${t.id}`}
              onScrollToIndexFailed={() => {}}
              renderItem={({item, index}) => (
                <Card
                  title={item}
                  id={`search-${item.kind}-${item.id}`}
                  onFocus={() =>
                    grid.current?.scrollToIndex({
                      index: Math.floor(index / 4),
                      viewPosition: 0.25,
                      animated: !reduced,
                    })
                  }
                  onPress={() => onOpen(item)}
                />
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={s.resultContent}
              ListFooterComponent={
                page < total ? (
                  <View style={s.more}>
                    <Button
                      id="search-more"
                      label={loading ? 'Loading…' : 'More results'}
                      disabled={loading}
                      onPress={() => search(page + 1)}
                    />
                  </View>
                ) : null
              }
            />
          )}
        </View>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  page: {
    flex: 1,
    paddingHorizontal: TV.edge,
    paddingTop: 24,
    paddingBottom: 24,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {color: C.text, fontSize: 36, lineHeight: 43, fontWeight: '600'},
  catalog: {color: C.dim, fontSize: 17},
  layout: {flex: 1, flexDirection: 'row', gap: 44},
  keyboard: {width: 408},
  query: {
    height: 56,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    backgroundColor: C.surface,
    paddingHorizontal: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 6,
  },
  queryText: {color: C.text, fontSize: 23, flex: 1},
  placeholder: {color: C.dim},
  keys: {gap: 8},
  keyRow: {flexDirection: 'row', justifyContent: 'center', gap: 8},
  key: {width: 44},
  utilities: {flexDirection: 'row', gap: 8, marginTop: 12},
  utility: {flex: 1},
  help: {color: C.dim, fontSize: 17, lineHeight: 24, marginTop: 16},
  results: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: C.line,
    paddingLeft: 28,
  },
  resultsHeading: {marginBottom: 20},
  section: {color: C.text, fontSize: 26, lineHeight: 33, fontWeight: '600'},
  resultStatus: {color: C.muted, fontSize: 18, lineHeight: 26, marginTop: 8},
  suggestions: {marginTop: 8},
  suggestionsTitle: {
    color: C.muted,
    fontSize: 20,
    lineHeight: 27,
    marginBottom: 12,
  },
  suggestionCards: {flexDirection: 'row', marginLeft: -4},
  fallbackNote: {color: C.dim, fontSize: 17, lineHeight: 25, marginBottom: 12},
  message: {paddingTop: 35, paddingBottom: 24, maxWidth: 600},
  messageTitle: {
    color: C.text,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '600',
  },
  messageBody: {color: C.muted, fontSize: 19, lineHeight: 29, marginTop: 12},
  errorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 24,
  },
  resultContent: {paddingBottom: 30},
  more: {alignItems: 'flex-start', marginTop: 18},
});
