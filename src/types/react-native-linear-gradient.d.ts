/**
 * `react-native-linear-gradient` is a build-time alias, not a real dependency: Metro resolves it to
 * Amazon's gradient module in the Vega build and to the local SVG shim in the Fire OS build, so no
 * package by that name is ever installed. The type below therefore describes the contract both
 * implementations must satisfy — same props as `@amazon-devices/react-linear-gradient`.
 */
declare module 'react-native-linear-gradient' {
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
}
