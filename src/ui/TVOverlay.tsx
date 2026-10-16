import React from 'react';
import {Modal, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {FocusScope} from './focus';
import {IconButton} from './controls';
import {useReducedMotion} from './motion';
import {C} from './theme';
/** A real native dialog owns focus/Back; the content keeps the TV's logical canvas. */
export function TVOverlay({
  visible,
  onClose,
  initial,
  title,
  subtitle,
  children,
  width = 560,
  testID = 'tv-overlay',
}: {
  visible: boolean;
  onClose: () => void;
  initial: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: number;
  testID?: string;
}) {
  const viewport = useWindowDimensions();
  const scale = Math.min(viewport.width / 1280, viewport.height / 720);
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated>
      <View style={s.window}>
        <View
          style={{
            position: 'absolute',
            width: 1280,
            height: 720,
            left: (viewport.width - 1280) / 2,
            top: (viewport.height - 720) / 2,
            transform: [{scale}],
          }}>
          <View testID={testID} style={[s.panel, {width}]}>
            <FocusScope initial={initial}>
              <View style={s.header}>
                <Text style={s.title}>{title}</Text>
                <IconButton
                  id="menu-close"
                  label="Close"
                  icon="close"
                  size={46}
                  onPress={onClose}
                />
              </View>
              {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
              <View style={s.content}>{children}</View>
            </FocusScope>
          </View>
        </View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  window: {flex: 1, backgroundColor: 'rgba(3,6,10,0.78)'},
  panel: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: C.surface,
    paddingHorizontal: 36,
    paddingTop: 32,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    lineHeight: 39,
    fontWeight: '600',
    color: C.text,
    flex: 1,
  },
  subtitle: {fontSize: 18, lineHeight: 27, color: C.muted, marginBottom: 24},
  content: {flex: 1},
});
