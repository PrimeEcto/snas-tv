import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  Image,
  StyleSheet,
} from 'react-native';
import {Catalog, imageUrl} from '../catalog/service';
import type {Title, Episode, Detail} from '../catalog/types';
import type {Library} from '../state/library';
import {continueWatching} from '../state/library';
import {Artwork, Button, IconButton, Meta, Rail} from './controls';
import {C, TV} from './theme';
import {useFocusNode, useFocusTarget} from './focus';
import {TVOverlay} from './TVOverlay';

import {CinematicArtwork} from './CinematicArtwork';
import {useReducedMotion} from './motion';
import {supportsPlayback} from 'snas-player';
function EpisodeCard({
  episode,
  title,
  onSelect,
  onFocus,
}: {
  episode: Episode;
  title: Title;
  onSelect: () => void;
  onFocus: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(`episode-${episode.season}-${episode.number}`);
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      ref={node.ref as never}
      testID={`episode-${episode.season}-${episode.number}`}
      accessibilityRole="button"
      hasTVPreferredFocus={node.preferred}
      accessibilityLabel={`${title.title}: Play season ${episode.season} episode ${episode.number}: ${episode.title}`}
      onFocus={() => {
        setFocused(true);
        node.remember();
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onSelect}
      style={[s.episode, focused && s.episodeFocused]}>
      {episode.still && !failed ? (
        <Image
          source={{uri: imageUrl(episode.still, 'w300')}}
          onError={() => setFailed(true)}
          style={s.still}
        />
      ) : (
        <View style={[s.still, s.episodeFallback]}>
          <Text style={s.episodeNumber}>
            {String(episode.number).padStart(2, '0')}
          </Text>
          <Text style={s.episodeFallbackLabel}>Season {episode.season}</Text>
        </View>
      )}
      <Text numberOfLines={2} style={s.episodeTitle}>
        {episode.number}. {episode.title}
      </Text>
      <Text style={s.episodeMeta}>
        {episode.runtime ? `${episode.runtime} min` : 'Duration unavailable'}
      </Text>
    </Pressable>
  );
}
export function DetailsScreen({
  catalog,
  title,
  library,
  onPlay,
  onToggle,
  onBack,
  onOpen,
  onDemo,
}: {
  catalog: Catalog;
  title: Title;
  library: Library;
  onPlay: (t: Title, e?: Episode) => void;
  onToggle: (t: Title) => void;
  onBack: () => void;
  onOpen: (t: Title) => void;
  onDemo: () => void;
}) {
  const [detail, setDetail] = useState<Detail>({
    ...title,
    episodes: [],
    related: [],
    seasonNumbers: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [season, setSeason] = useState(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selected, setSelected] = useState<Episode | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [seasonMenu, setSeasonMenu] = useState(false);
  const focusTarget = useFocusTarget();
  const [requestedSeason, setRequestedSeason] = useState<number | null>(null);
  const scroll = useRef<ScrollView>(null);
  const episodeList = useRef<FlatList<Episode>>(null);
  const episodeY = useRef(0);
  const actionY = useRef(0);
  const relatedY = useRef(0);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const reduced = useReducedMotion();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    catalog
      .detail(title)
      .then(async (value) => {
        const last = continueWatching(libraryRef.current).find(
          (p) => p.title.id === title.id && p.title.kind === title.kind,
        );
        const wanted =
          requestedSeason ??
          last?.episode?.season ??
          value.seasonNumbers[0] ??
          1;
        const list =
          value.seasonNumbers.length && wanted !== value.seasonNumbers[0]
            ? await catalog.season(value, wanted)
            : value.episodes;
        if (!alive) return;
        setDetail(value);
        setSeason(wanted);
        setEpisodes(list);
        setSelected(list.find((e) => e.id === last?.episode?.id) || list[0]);
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
  }, [catalog, title, attempt, requestedSeason]);
  const saved = library.watchlist.some(
    (t) => t.id === title.id && t.kind === title.kind,
  );
  const resume = continueWatching(library).find(
    (p) =>
      p.title.id === title.id &&
      p.title.kind === title.kind &&
      (!selected || p.episode?.id === selected.id),
  );
  const top = () => scroll.current?.scrollTo({y: 0, animated: !reduced});
  const showActions = () =>
    scroll.current?.scrollTo({
      y: Math.max(0, actionY.current - 420),
      animated: !reduced,
    });
  const showEpisodes = () =>
    scroll.current?.scrollTo({
      y: Math.max(0, episodeY.current - 24),
      animated: !reduced,
    });
  const playLabel = resume
    ? supportsPlayback
      ? 'Resume'
      : 'Continue exploring'
    : title.kind === 'tv' && selected
    ? supportsPlayback
      ? 'Play episode'
      : 'Explore episode'
    : supportsPlayback
    ? 'Play'
    : 'Explore player';
  return (
    <ScrollView
      ref={scroll}
      style={s.fill}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <CinematicArtwork title={detail} />
        <View style={s.back}>
          <IconButton
            id="details-back"
            label="Back"
            icon="back"
            size={46}
            onFocus={top}
            onPress={onBack}
          />
        </View>
        <View style={s.identity}>
          <Artwork title={detail} style={s.detailPoster} />
          <View style={s.heroCopy}>
            <Text numberOfLines={2} style={s.title}>
              {detail.title}
            </Text>
            <Meta title={detail} />
            <Text numberOfLines={3} style={s.overview}>
              {detail.overview || 'A synopsis is not available for this title.'}
            </Text>
            {selected && (
              <Text numberOfLines={1} style={s.selection}>
                S{selected.season} · E{selected.number} — {selected.title}
              </Text>
            )}
            <View
              style={s.actions}
              onLayout={(event) => {
                actionY.current = event.nativeEvent.layout.y + 90;
              }}>
              <Button
                id="details-play"
                icon="play"
                primary
                label={playLabel}
                disabled={title.kind === 'tv' && !selected}
                onFocus={showActions}
                onPress={() => onPlay(detail, selected)}
              />
              <IconButton
                id="details-save"
                icon={saved ? 'check' : 'plus'}
                label={saved ? 'Remove from My List' : 'Add to My List'}
                selected={saved}
                onFocus={showActions}
                onPress={() => onToggle(detail)}
              />
            </View>
          </View>
        </View>
      </View>
      {loading && <Text style={s.status}>Loading details…</Text>}
      {error && (
        <View style={s.error}>
          <Text style={s.errorText}>{error}</Text>
          <View style={s.actions}>
            <Button
              id="details-retry"
              label="Try again"
              onPress={() => setAttempt((n) => n + 1)}
            />
            <Button
              id="details-demo"
              label="Use sample catalog"
              onPress={onDemo}
            />
          </View>
        </View>
      )}
      {title.kind === 'tv' && (
        <View onLayout={(e) => (episodeY.current = e.nativeEvent.layout.y)}>
          <View style={s.episodeHeading}>
            <Text style={s.sectionTitle}>Episodes</Text>
            <Button
              id="details-season"
              label={`Season ${season}`}
              icon="chevronDown"
              compact
              onFocus={showEpisodes}
              onPress={() => setSeasonMenu(true)}
            />
          </View>
          {episodes.length ? (
            <FlatList
              ref={episodeList}
              key={season}
              horizontal
              data={episodes}
              keyExtractor={(e) => String(e.id)}
              showsHorizontalScrollIndicator={false}
              removeClippedSubviews={false}
              initialNumToRender={5}
              maxToRenderPerBatch={5}
              updateCellsBatchingPeriod={50}
              contentContainerStyle={s.episodes}
              getItemLayout={(_, index) => ({
                length: 298,
                offset: 298 * index,
                index,
              })}
              renderItem={({item, index}) => (
                <EpisodeCard
                  episode={item}
                  title={detail}
                  onSelect={() => onPlay(detail, item)}
                  onFocus={() => {
                    setSelected(item);
                    showEpisodes();
                    episodeList.current?.scrollToIndex({
                      index,
                      viewPosition: 0.3,
                      animated: !reduced,
                    });
                  }}
                />
              )}
            />
          ) : (
            !loading && (
              <Text style={s.status}>
                Episodes are unavailable for this title. Try another season or
                check back later.
              </Text>
            )
          )}
          {selected?.overview && (
            <Text style={s.episodeOverview}>{selected.overview}</Text>
          )}
        </View>
      )}
      {detail.overview.length > 220 && (
        <View style={s.story}>
          <Text style={s.sectionTitle}>The story</Text>
          <Text style={s.fullOverview}>
            {detail.overview || 'A synopsis is not available for this title.'}
          </Text>
        </View>
      )}
      {detail.cast?.length ? (
        <View style={s.credits}>
          <View style={s.creditMain}>
            <Text style={s.sectionTitle}>Cast</Text>
            <View style={s.castGrid}>
              {Array.from(
                {length: Math.ceil(detail.cast.length / 3)},
                (_, row) => (
                  <View key={row} style={s.castRow}>
                    {[0, 1, 2].map((column) => {
                      const credit = detail.cast?.[row * 3 + column];
                      const [name, ...role] = credit?.split(' as ') || [];
                      return (
                        <View key={column} style={s.castCell}>
                          {credit && (
                            <>
                              <Text style={s.castActor}>{name}</Text>
                              {role.length > 0 && (
                                <Text style={s.castRole}>
                                  {role.join(' as ')}
                                </Text>
                              )}
                            </>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ),
              )}
            </View>
          </View>
          {detail.director && (
            <View style={s.directorBlock}>
              <Text style={s.sectionTitle}>Director</Text>
              <Text style={s.castName}>{detail.director}</Text>
            </View>
          )}
        </View>
      ) : null}
      {detail.related.length > 0 && (
        <View onLayout={(e) => (relatedY.current = e.nativeEvent.layout.y)}>
          <Rail
            id="related"
            title="More like this"
            items={detail.related}
            onOpen={onOpen}
            onFocus={() =>
              scroll.current?.scrollTo({
                y: Math.max(0, relatedY.current - 24),
                animated: !reduced,
              })
            }
          />
        </View>
      )}
      {detail.trailers?.length ? (
        <View style={s.trailers}>
          <Text style={s.sectionTitle}>Promotional videos</Text>
          <Text style={s.trailerNote}>
            Video information from TMDB · Playback is not available here.
          </Text>
          {detail.trailers.map((v) => (
            <Text key={v.key} style={s.trailer}>
              {v.name} · {v.site}
            </Text>
          ))}
        </View>
      ) : null}
      <TVOverlay
        visible={seasonMenu}
        title="Choose a season"
        subtitle={detail.title}
        initial={`season-${season}`}
        width={500}
        onClose={() => {
          setSeasonMenu(false);
          setTimeout(() => focusTarget('details-season'), 180);
        }}>
        <ScrollView contentContainerStyle={{gap: 12}}>
          {detail.seasonNumbers.map((n) => (
            <Button
              key={n}
              id={`season-${n}`}
              label={`Season ${n}`}
              selected={n === season}
              icon={n === season ? 'check' : undefined}
              onPress={() => {
                setSeasonMenu(false);
                if (n !== season) {
                  setRequestedSeason(n);
                  setSelected(undefined);
                }
                setTimeout(() => focusTarget('details-season'), 180);
              }}
            />
          ))}
        </ScrollView>
      </TVOverlay>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  fill: {flex: 1},
  content: {paddingBottom: 40},
  hero: {minHeight: 410, marginBottom: 20, paddingBottom: 28},
  identity: {
    flexDirection: 'row',
    gap: 32,
    paddingHorizontal: TV.edge,
    alignItems: 'center',
  },
  detailPoster: {width: 178, height: 267},
  heroCopy: {width: 660},
  back: {
    alignItems: 'flex-start',
    marginLeft: TV.edge,
    marginTop: 20,
    marginBottom: 22,
  },
  title: {
    fontSize: 43,
    lineHeight: 49,
    fontWeight: '700',
    color: C.text,
    maxWidth: 670,
    marginBottom: 14,
    letterSpacing: -0.8,
  },
  overview: {
    fontSize: 19,
    lineHeight: 28,
    color: C.text,
    width: 640,
    marginTop: 18,
    marginBottom: 22,
  },
  selection: {color: C.accent, fontSize: 18, marginBottom: 18, maxWidth: 650},
  actions: {flexDirection: 'row', gap: 12},
  status: {
    fontSize: 18,
    lineHeight: 27,
    color: C.muted,
    marginHorizontal: TV.edge,
    marginBottom: 24,
  },
  error: {
    marginHorizontal: TV.edge,
    marginBottom: 28,
    padding: 22,
    backgroundColor: C.surface,
  },
  errorText: {color: C.error, fontSize: 18, lineHeight: 27, marginBottom: 16},
  episodeHeading: {
    marginHorizontal: TV.edge,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginBottom: 16,
  },
  sectionTitle: {fontSize: 24, color: C.text, fontWeight: '600'},
  seasons: {gap: 10},
  episodes: {
    paddingLeft: TV.edge - 5,
    paddingRight: TV.edge,
    paddingBottom: 22,
  },
  episode: {
    width: 278,
    marginRight: 20,
    padding: 5,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  episodeFocused: {borderColor: C.text},
  still: {width: 264, height: 149},
  episodeTitle: {
    fontSize: 18,
    lineHeight: 25,
    color: C.text,
    marginTop: 12,
    fontWeight: '600',
  },
  episodeMeta: {fontSize: 16, color: C.dim, marginTop: 6},
  episodeOverview: {
    fontSize: 19,
    lineHeight: 28,
    color: C.muted,
    marginHorizontal: TV.edge,
    marginBottom: 28,
    maxWidth: 900,
  },
  story: {paddingHorizontal: TV.edge, marginBottom: 32},
  fullOverview: {
    fontSize: 19,
    lineHeight: 29,
    color: C.muted,
    maxWidth: 1000,
    marginTop: 14,
  },
  credits: {
    paddingHorizontal: TV.edge,
    marginBottom: 36,
    flexDirection: 'row',
    gap: 42,
  },
  creditMain: {flex: 1},
  castGrid: {gap: 22, marginTop: 16},
  castRow: {flexDirection: 'row', gap: 24, alignItems: 'flex-start'},
  castCell: {flex: 1, minWidth: 0},
  castActor: {fontSize: 19, lineHeight: 28, color: C.text, fontWeight: '500'},
  castRole: {fontSize: 17, lineHeight: 25, color: C.muted, marginTop: 4},
  castName: {fontSize: 19, lineHeight: 28, color: C.muted, minWidth: 210},
  directorBlock: {width: 260, gap: 16},
  episodeFallback: {
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodeNumber: {fontSize: 57, fontWeight: '600', color: C.dim},
  episodeFallbackLabel: {fontSize: 17, color: C.muted, marginTop: 6},
  cast: {
    fontSize: 19,
    lineHeight: 30,
    color: C.muted,
    marginTop: 14,
    maxWidth: 1000,
  },
  director: {fontSize: 18, color: C.dim, marginTop: 12},
  trailers: {marginHorizontal: TV.edge},
  trailerNote: {
    fontSize: 17,
    color: C.dim,
    lineHeight: 25,
    marginTop: 12,
    marginBottom: 10,
  },
  trailer: {color: C.muted, fontSize: 18, lineHeight: 28},
});
