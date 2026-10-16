import React from 'react';
import {StyleSheet, View} from 'react-native';
import type {Title} from '../catalog/types';
import {Artwork, LinearGradient} from './controls';
import {C} from './theme';

/** Keep the artwork and both legibility fades inside the same bounds: no mask seams. */
export function CinematicArtwork({title}: {title: Title}) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, {overflow: 'hidden'}]}>
      <Artwork
        title={title}
        kind="backdrop"
        style={{
          position: 'absolute',
          left: 260,
          right: 0,
          top: 0,
          bottom: 0,
          minHeight: 574,
        }}
      />
      <LinearGradient
        colors={[
          C.bg,
          C.bg,
          'rgba(12,16,21,0.94)',
          'rgba(12,16,21,0.65)',
          'rgba(12,16,21,0.08)',
        ]}
        locations={[0, 0.22, 0.4, 0.72, 1]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(12,16,21,0)', C.bg]}
        locations={[0, 1]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 110,
        }}
      />
    </View>
  );
}
