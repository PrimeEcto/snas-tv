/**
 * A local stand-in for `react-native-linear-gradient`, resolved only by the Fire OS build.
 *
 * The app already depends on react-native-svg, so drawing the gradient with SVG keeps a
 * legacy native module (and its New Architecture interop risk) out of the APK while
 * presenting the same component name and props the shared screens already use.
 */
import React from 'react';
import {View} from 'react-native';
import Svg, {Defs, LinearGradient as SvgLinearGradient, Rect, Stop} from 'react-native-svg';

let sequence = 0;

/** Accept #rgb/#rrggbb/#rrggbbaa/rgb()/rgba() and split colour from alpha for SVG. */
function parseColor(value) {
  if (typeof value !== 'string') return {color: '#000000', opacity: 1};
  if (value.trim().toLowerCase() === 'transparent') return {color: '#000000', opacity: 0};
  const match = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (match) {
    const parts = match[1].split(',').map(part => Number.parseFloat(part.trim()));
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    if ([r, g, b, a].every(Number.isFinite)) {
      return {color: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`, opacity: Math.min(1, Math.max(0, a))};
    }
  }
  if (/^#[0-9a-f]{8}$/i.test(value.trim())) {
    const hex = value.trim();
    return {color: `#${hex.slice(1, 7)}`, opacity: Number.parseInt(hex.slice(7), 16) / 255};
  }
  return {color: value, opacity: 1};
}

export default function LinearGradient({
  colors = [],
  locations,
  start = {x: 0, y: 0},
  end = {x: 0, y: 1},
  style,
  children,
  ...rest
}) {
  const id = React.useMemo(() => `snas-gradient-${sequence++}`, []);
  // The native module cannot draw a gradient from fewer than two stops; neither can SVG.
  const stops = colors.length >= 2 ? colors : ['transparent', 'transparent'];
  const offsets = Array.isArray(locations) && locations.length === stops.length ? locations : undefined;
  const from = {x: start?.x ?? 0, y: start?.y ?? 0};
  const to = {x: end?.x ?? 0, y: end?.y ?? 1};

  return (
    <View style={style} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id={id} x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
            {stops.map((value, index) => {
              const {color, opacity} = parseColor(value);
              const offset = offsets ? offsets[index] : index / (stops.length - 1);
              return (
                <Stop
                  key={`${index}-${color}`}
                  offset={`${Math.min(1, Math.max(0, Number(offset) || 0))}`}
                  stopColor={color}
                  stopOpacity={opacity}
                />
              );
            })}
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}
