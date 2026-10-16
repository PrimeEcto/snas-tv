import React, {useState} from 'react';
import {View, Text, Image, Pressable, StyleSheet} from 'react-native';
import {Catalog} from '../catalog/service';
import {version} from '../../package.json';
import {supportsPlayback} from 'snas-player';
import {Icon} from './icons';
import {useFocusNode} from './focus';
import {C, TV} from './theme';

type Section = 'Catalog' | 'Remote' | 'About';

function SectionRow({
  section,
  detail,
  selected,
  onPress,
}: {
  section: Section;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(`settings-${section}`);
  return (
    <Pressable
      ref={node.ref as never}
      testID={`settings-${section}`}
      hasTVPreferredFocus={node.preferred}
      accessibilityRole="tab"
      accessibilityLabel={`${section}, ${detail}`}
      accessibilityState={{selected}}
      onPress={onPress}
      onFocus={() => {
        node.remember();
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      style={[s.navRow, selected && s.navSelected, focused && s.focused]}>
      <View
        style={[
          s.navMarker,
          selected && s.navMarkerSelected,
          focused && selected && s.darkMarker,
        ]}
      />
      <View style={s.rowCopy}>
        <Text style={[s.navLabel, focused && s.darkText]}>{section}</Text>
        <Text style={[s.navDetail, focused && s.darkText]}>{detail}</Text>
      </View>
      <Icon name="chevronRight" size={20} color={focused ? C.bg : C.dim} />
    </Pressable>
  );
}

function CatalogChoice({
  id,
  title,
  detail,
  selected,
  onPress,
}: {
  id: string;
  title: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const node = useFocusNode(id);
  return (
    <Pressable
      ref={node.ref as never}
      testID={id}
      hasTVPreferredFocus={node.preferred}
      accessibilityRole="radio"
      accessibilityLabel={`${title}, ${detail}`}
      accessibilityState={{checked: selected}}
      onPress={onPress}
      onFocus={() => {
        node.remember();
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      style={[s.choice, selected && s.choiceSelected, focused && s.focused]}>
      <View
        style={[
          s.radio,
          selected && s.radioSelected,
          focused && s.radioFocused,
        ]}>
        {selected && (
          <Icon name="check" size={19} color={focused ? C.bg : C.accent} />
        )}
      </View>
      <View style={s.rowCopy}>
        <Text style={[s.choiceTitle, focused && s.darkText]}>{title}</Text>
        <Text style={[s.choiceDetail, focused && s.darkText]}>{detail}</Text>
      </View>
      {selected && (
        <Text style={[s.selectedLabel, focused && s.darkText]}>Selected</Text>
      )}
    </Pressable>
  );
}

export function AboutScreen({
  catalog,
  onDemo,
  onLive,
}: {
  catalog: Catalog;
  onDemo: () => void;
  onLive: () => void;
}) {
  const [section, setSection] = useState<Section>('Catalog');
  return (
    <View style={s.page}>
      <View style={s.heading}>
        <Text style={s.title}>Settings</Text>
        <Text style={s.version}>SNAS TV {version}</Text>
      </View>
      <View style={s.columns}>
        <View style={s.navigation}>
          <SectionRow
            section="Catalog"
            detail={
              catalog.mode === 'demo' ? 'Sample catalog' : 'Live TMDB catalog'
            }
            selected={section === 'Catalog'}
            onPress={() => setSection('Catalog')}
          />
          <SectionRow
            section="Remote"
            detail="Navigation and playback"
            selected={section === 'Remote'}
            onPress={() => setSection('Remote')}
          />
          <SectionRow
            section="About"
            detail="App and attribution"
            selected={section === 'About'}
            onPress={() => setSection('About')}
          />
          <Text style={s.localNote}>
            Your list, watch progress and playback preferences stay on this
            device.
          </Text>
        </View>
        <View style={s.content}>
          {section === 'Catalog' && (
            <View testID="settings-catalog-content">
              <Text style={s.section}>Your catalog</Text>
              <Text style={s.description}>
                Choose where SNAS finds movies and series.
              </Text>
              <View style={s.choices}>
                <CatalogChoice
                  id="about-live"
                  title="Live TMDB catalog"
                  detail="Discover and search with an internet connection."
                  selected={catalog.mode === 'live'}
                  onPress={onLive}
                />
                <CatalogChoice
                  id="about-demo"
                  title="Sample catalog"
                  detail="Browse a smaller collection of genuine records."
                  selected={catalog.mode === 'demo'}
                  onPress={onDemo}
                />
              </View>
              <View style={s.catalogStatus}>
                <Icon name="check" size={21} color={C.accent} />
                <Text style={s.statusText} accessibilityLiveRegion="polite">
                  {catalog.mode === 'demo'
                    ? 'Sample catalog selected. Catalog records work offline; artwork and streams may need a connection.'
                    : 'Live TMDB catalog selected. If your connection is unavailable, choose the sample catalog.'}
                </Text>
              </View>
              <Text style={s.note}>
                Catalog listings provide information about titles. Available
                playback sources vary by title.
              </Text>
            </View>
          )}
          {section === 'Remote' && (
            <View testID="settings-remote-content">
              <Text style={s.section}>Using your remote</Text>
              <Text style={s.description}>
                A warm highlight shows which control is ready to use.
              </Text>
              {[
                ['Move', 'Use the arrows to move between titles and controls.'],
                [
                  'Select',
                  'Open a title, choose an option or activate a control.',
                ],
                [
                  'Back',
                  'Close a menu or return to the previous screen. From a main section, return Home.',
                ],
                [
                  'Playback',
                  'Use Play / Pause and the seek buttons. Audio, subtitles and playback settings are in the player.',
                ],
              ].map(([label, detail]) => (
                <View key={label} style={s.guideRow}>
                  <Text style={s.guideLabel}>{label}</Text>
                  <Text style={s.guideDetail}>{detail}</Text>
                </View>
              ))}
            </View>
          )}
          {section === 'About' && (
            <View testID="settings-about-content">
              <Text style={s.section}>SNAS TV</Text>
              <Text style={s.platform}>
                {supportsPlayback
                  ? 'Fire TV · Android / Fire OS'
                  : 'Vega OS · Player concept'}
              </Text>
              <Text style={s.description}>
                {supportsPlayback
                  ? 'Available streams play with ExoPlayer. The concept player lets you explore controls without starting a stream.'
                  : 'This build provides an interactive player concept without video or audio.'}
              </Text>
              <View style={s.attribution}>
                <Image
                  source={require('../../assets/tmdb.png')}
                  resizeMode="contain"
                  accessibilityLabel="The Movie Database"
                  style={s.tmdb}
                />
                <Text style={s.attributionText}>
                  This product uses the TMDB API but is not endorsed or
                  certified by TMDB.
                </Text>
                <Text style={s.note}>
                  Metadata and artwork: The Movie Database. TMDB scores are
                  community vote averages.
                </Text>
                <Text style={s.note}>
                  Catalog listings do not grant streaming rights.
                </Text>
              </View>
            </View>
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
    paddingBottom: 32,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  title: {color: C.text, fontSize: 36, lineHeight: 43, fontWeight: '600'},
  version: {color: C.dim, fontSize: 18},
  columns: {flexDirection: 'row', gap: 44, flex: 1},
  navigation: {width: 292, gap: 10},
  navRow: {
    height: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingRight: 14,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  navSelected: {backgroundColor: C.surface},
  navMarker: {
    width: 3,
    height: 36,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  navMarkerSelected: {backgroundColor: C.accent},
  darkMarker: {backgroundColor: C.bg},
  rowCopy: {flex: 1},
  navLabel: {color: C.text, fontSize: 21, lineHeight: 28, fontWeight: '600'},
  navDetail: {color: C.dim, fontSize: 16, lineHeight: 23, marginTop: 3},
  localNote: {
    color: C.dim,
    fontSize: 17,
    lineHeight: 26,
    marginTop: 28,
    paddingHorizontal: 18,
  },
  content: {
    flex: 1,
    borderLeftWidth: 1,
    borderLeftColor: C.line,
    paddingLeft: 44,
    paddingTop: 4,
  },
  section: {color: C.text, fontSize: 28, lineHeight: 36, fontWeight: '600'},
  description: {
    color: C.muted,
    fontSize: 19,
    lineHeight: 29,
    marginTop: 12,
    marginBottom: 26,
    maxWidth: 700,
  },
  choices: {gap: 12},
  choice: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: 6,
  },
  choiceSelected: {backgroundColor: C.surface, borderColor: C.accent},
  radio: {
    width: 29,
    height: 29,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.dim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {borderColor: C.accent},
  radioFocused: {borderColor: C.bg},
  choiceTitle: {color: C.text, fontSize: 21, lineHeight: 28, fontWeight: '600'},
  choiceDetail: {color: C.muted, fontSize: 17, lineHeight: 25, marginTop: 4},
  selectedLabel: {color: C.accent, fontSize: 16, fontWeight: '600'},
  focused: {backgroundColor: C.accent, borderColor: C.text},
  darkText: {color: C.bg},
  catalogStatus: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 24,
    marginBottom: 20,
  },
  statusText: {flex: 1, color: C.muted, fontSize: 18, lineHeight: 28},
  note: {
    color: C.dim,
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 14,
    maxWidth: 690,
  },
  guideRow: {
    flexDirection: 'row',
    gap: 26,
    paddingVertical: 17,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  guideLabel: {
    width: 102,
    color: C.text,
    fontSize: 19,
    lineHeight: 28,
    fontWeight: '600',
  },
  guideDetail: {flex: 1, color: C.muted, fontSize: 18, lineHeight: 28},
  platform: {color: C.accent, fontSize: 18, lineHeight: 27, marginTop: 18},
  attribution: {borderTopWidth: 1, borderTopColor: C.line, paddingTop: 20},
  tmdb: {width: 140, height: 20, marginBottom: 20},
  attributionText: {
    color: C.muted,
    fontSize: 19,
    lineHeight: 29,
    marginBottom: 18,
    maxWidth: 690,
  },
});
