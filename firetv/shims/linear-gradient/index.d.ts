/**
 * Types for the SVG gradient shim. They must match the shared declaration in
 * `src/types/react-native-linear-gradient.d.ts` (and Amazon's own module), because the shared
 * screens are typechecked against whichever build is resolving this specifier.
 */
import * as React from 'react';
import * as ReactNative from 'react-native';

export interface LinearGradientProps extends ReactNative.ViewProps {
  colors: ReactNative.ColorValue[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  locations?: number[];
  useAngle?: boolean;
  angleCenter?: { x: number; y: number };
  angle?: number;
}

export const LinearGradient: React.ComponentType<LinearGradientProps>;
export default LinearGradient;
