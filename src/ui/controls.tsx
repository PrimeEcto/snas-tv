import React, {useState, useRef, useEffect, memo} from 'react';
import {
  Pressable,
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  FlatList,
} from 'react-native';
import NativeLinearGradient from 'react-native-linear-gradient';
import {C, TV} from './theme';
import {useReducedMotion} from './motion';
import {Icon, type IconName} from './icons';
import {useFocusNode} from './focus';
import type {Title} from '../catalog/types';
import {imageUrl} from '../catalog/service';
type GradientProps = {
  colors: string[];
  locations?: number[];
  start?: {x: number; y: number};
  end?: {x: number; y: number};
  style?: any;
};
export function LinearGradient({
  colors,
  locations,
  start,
  end,
  style,
}: GradientProps) {
  const stops =
    Array.isArray(colors) && colors.length >= 2
      ? colors
      : ['transparent', 'transparent'];
  const offsets =
    Array.isArray(locations) && locations.length === stops.length
      ? locations
      : undefined;
  return (
    <NativeLinearGradient
      colors={stops}
      {...(offsets ? {locations: offsets} : {})}
      {...(start ? {start} : {})}
      {...(end ? {end} : {})}
      style={style}
    />
  );
}
export function Button({
  id,
  label,
  icon,
  onPress,
  primary = false,
  compact = false,
  disabled = false,
  onFocus,
  selected = false,
}: {
  id: string;
  label: string;
  icon?: IconName;
  onPress: () => void;
  primary?: boolean;
  compact?: boolean;
  disabled?: boolean;
  onFocus?: () => void;
  selected?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(id);
  return (
    <Pressable
      ref={disabled ? undefined : (node.ref as never)}
      testID={id}
      hasTVPreferredFocus={node.preferred}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled, selected}}
      focusable={!disabled}
      disabled={disabled}
      onFocus={() => {
        setFocused(true);
        node.remember();
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        s.button,
        compact && s.compact,
        compact && label.length === 1 && s.key,
        primary && s.primary,
        selected && s.selected,
        focused && s.focused,
        disabled && s.disabled,
      ]}>
      {icon && (
        <Icon
          name={icon}
          color={primary || focused ? C.bg : C.text}
          size={compact ? 20 : 22}
        />
      )}
      <Text
        numberOfLines={1}
        style={[s.buttonLabel, (primary || focused) && s.darkLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}
export const Artwork = memo(function Artwork({
  title,
  kind = 'poster',
  style,
}: {
  title: Title;
  kind?: 'poster' | 'backdrop';
  style?: any;
}) {
  const [failed, setFailed] = useState(false);
  const path = kind === 'poster' ? title.poster : title.backdrop;
  useEffect(() => setFailed(false), [path]);
  const uri = path
    ? imageUrl(path, kind === 'poster' ? 'w342' : 'w1280')
    : undefined;
  return (
    <View style={[s.artwork, style]}>
      {uri && !failed ? (
        <Image
          source={{uri}}
          resizeMode="cover"
          onError={() => setFailed(true)}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={s.fallback}>
          <Text style={s.fallbackBrand}>SNAS</Text>
          <Text numberOfLines={3} style={s.fallbackTitle}>
            {title.title}
          </Text>
        </View>
      )}
    </View>
  );
});
export function Meta({title}: {title: Title}) {
  const values = [
    title.year,
    ...title.genres.slice(0, 2),
    title.kind === 'tv'
      ? title.seasons
        ? `${title.seasons} ${title.seasons === 1 ? 'season' : 'seasons'}`
        : 'Series'
      : title.runtime
      ? `${title.runtime} min`
      : null,
    title.rating !== null ? `TMDB ${title.rating.toFixed(1)}` : null,
  ].filter(Boolean);
  return (
    <View style={s.meta}>
      {values.map((value, i) => (
        <React.Fragment key={`${i}-${value}`}>
          {i > 0 && <Text style={s.metaDot}>·</Text>}
          <Text style={s.metaText}>{value}</Text>
        </React.Fragment>
      ))}
    </View>
  );
}
export function Card({
  title,
  id,
  onPress,
  onFocus,
  progress,
  wide = false,
}: {
  title: Title;
  id: string;
  onPress: () => void;
  onFocus?: () => void;
  progress?: number;
  wide?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(id);
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const focus = (value: boolean) => {
    setFocused(value);
    Animated.timing(scale, {
      toValue: value ? 1.025 : 1,
      duration: reduced ? 0 : 120,
      useNativeDriver: true,
    }).start();
    if (value) {
      node.remember();
      onFocus?.();
    }
  };
  const artWidth = wide ? TV.wideArt : TV.poster;
  return (
    <Pressable
      ref={node.ref as never}
      testID={id}
      accessibilityRole="button"
      hasTVPreferredFocus={node.preferred}
      accessibilityLabel={`${title.title}, ${title.year}, ${
        title.kind === 'tv' ? 'series' : 'movie'
      }${
        progress !== undefined
          ? `, ${Math.round(progress * 100)} percent watched`
          : ''
      }`}
      onFocus={() => focus(true)}
      onBlur={() => focus(false)}
      onPress={onPress}
      style={[s.card, {width: wide ? TV.wide : TV.card}]}>
      <Animated.View
        style={[
          s.frame,
          {transform: [{scale}], borderColor: focused ? C.text : 'transparent'},
        ]}>
        <Artwork
          title={title}
          kind={wide ? 'backdrop' : 'poster'}
          style={{
            width: artWidth,
            height: wide ? TV.wideHeight : TV.posterHeight,
          }}
        />
        {progress !== undefined && (
          <View style={s.progress}>
            <View
              style={{
                height: 4,
                width: artWidth * Math.max(0, Math.min(1, progress)),
                backgroundColor: C.accent,
              }}
            />
          </View>
        )}
      </Animated.View>
      <Text
        numberOfLines={1}
        style={[s.cardTitle, focused && s.cardTitleFocused]}>
        {title.title}
      </Text>
      <Text numberOfLines={1} style={s.cardMeta}>
        {[title.year, title.kind === 'tv' ? 'Series' : 'Film']
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
    </Pressable>
  );
}
export function Rail({
  id,
  title,
  items,
  onOpen,
  onFocus,
  progress,
  wide = false,
}: {
  id: string;
  title: string;
  items: Title[];
  onOpen: (title: Title) => void;
  onFocus?: () => void;
  progress?: Record<string, number>;
  wide?: boolean;
}) {
  const list = useRef<FlatList<Title>>(null);
  const reduced = useReducedMotion();
  const step = (wide ? TV.wide : TV.card) + TV.gap;
  if (!items.length) return null;
  return (
    <View style={s.rail}>
      <Text style={s.railTitle}>{title}</Text>
      <FlatList
        ref={list}
        horizontal
        data={items}
        keyExtractor={(t) => `${t.kind}-${t.id}`}
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        contentContainerStyle={s.railContent}
        getItemLayout={(_, index) => ({
          length: step,
          offset: step * index,
          index,
        })}
        renderItem={({item, index}) => (
          <Card
            id={`${id}-${item.kind}-${item.id}`}
            title={item}
            wide={wide}
            onPress={() => onOpen(item)}
            progress={progress?.[`${item.kind}:${item.id}`]}
            onFocus={() => {
              list.current?.scrollToIndex({
                index,
                animated: !reduced,
                viewPosition: 0.4,
              });
              onFocus?.();
            }}
          />
        )}
      />
    </View>
  );
}
export function Empty({
  title,
  body,
  action,
  label = 'Explore movies',
}: {
  title: string;
  body: string;
  action: () => void;
  label?: string;
}) {
  return (
    <View style={s.empty}>
      <Icon name="list" size={34} color={C.accent} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      <View style={s.emptyAction}>
        <Button id="empty-action" label={label} primary onPress={action} />
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 6,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.raised,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  compact: {height: 44, paddingHorizontal: 14},
  key: {paddingHorizontal: 0},
  primary: {backgroundColor: C.text},
  selected: {borderColor: C.accent},
  focused: {backgroundColor: C.accent, borderColor: C.text},
  disabled: {opacity: 0.45},
  buttonLabel: {fontSize: 18, color: C.text, fontWeight: '600', flexShrink: 1},
  darkLabel: {color: C.bg},
  artwork: {backgroundColor: C.surface, overflow: 'hidden'},
  fallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14,
  },
  fallbackBrand: {
    color: C.accent,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 3,
  },
  fallbackTitle: {
    color: C.muted,
    fontSize: 17,
    textAlign: 'center',
    marginTop: 15,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 5,
  },
  metaDot: {color: C.dim, fontSize: 16},
  metaText: {fontSize: 17, color: C.muted},
  card: {marginRight: TV.gap, padding: 4},
  frame: {borderWidth: 2, borderRadius: 0, padding: 1},
  progress: {height: 4, backgroundColor: C.line, marginTop: 6},
  cardTitle: {fontSize: 18, color: C.muted, marginTop: 9, fontWeight: '500'},
  cardTitleFocused: {color: C.text, fontWeight: '600'},
  cardMeta: {fontSize: 15, color: C.dim, marginTop: 4},
  rail: {marginBottom: 30},
  railTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: C.text,
    marginLeft: TV.edge,
    marginBottom: 10,
  },
  railContent: {
    paddingLeft: TV.edge - 4,
    paddingRight: TV.edge,
    paddingVertical: 7,
  },
  empty: {
    paddingHorizontal: TV.edge,
    paddingVertical: 38,
    justifyContent: 'center',
    flex: 1,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 34,
    fontWeight: '600',
    marginTop: 23,
    marginBottom: 14,
  },
  emptyBody: {
    color: C.muted,
    fontSize: 20,
    lineHeight: 30,
    maxWidth: 650,
    marginBottom: 28,
  },
  emptyAction: {alignItems: 'flex-start'},
});

export function IconButton({
  id,
  label,
  icon,
  onPress,
  onFocus,
  size = 56,
  primary = false,
  caption = false,
  selected = false,
  disabled = false,
}: {
  id: string;
  label: string;
  icon: IconName;
  onPress: () => void;
  onFocus?: () => void;
  size?: number;
  primary?: boolean;
  caption?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(id);
  return (
    <Pressable
      ref={disabled ? undefined : (node.ref as never)}
      testID={id}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled, selected}}
      disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={node.preferred}
      android_ripple={{color: 'transparent'}}
      onFocus={() => {
        setFocused(true);
        node.remember();
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{alignItems: 'center', opacity: disabled ? 0.4 : 1}}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: focused
            ? C.accent
            : primary
            ? C.text
            : 'rgba(25,31,39,0.72)',
          borderWidth: 2,
          borderColor: focused ? C.text : selected ? C.accent : 'transparent',
        }}>
        <Icon
          name={icon}
          size={size >= 70 ? 31 : 24}
          color={focused || primary ? C.bg : C.text}
        />
      </View>
      {caption && (
        <Text
          numberOfLines={1}
          style={{
            fontSize: 16,
            lineHeight: 22,
            color: focused ? C.text : C.muted,
            marginTop: 9,
            textAlign: 'center',
          }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
