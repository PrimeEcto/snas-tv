/**
 * Metro for the Vega OS build (the root project).
 *
 * One source tree serves two platforms, so the specifiers whose implementation genuinely
 * differs are redirected here instead of being branched on inside shared screens: `snas-tv`
 * (remote-key events), `snas-focus` (focus requests) and `snas-player` (the media surface)
 * resolve to the Vega adapters, and the gradient primitive resolves to Amazon's native
 * module, which is the one installed for this target. The Fire OS build redirects the same
 * specifiers to its own adapters under `firetv/`.
 *
 * maxWorkers stays capped: builds here share the machine with the Vega device tooling.
 *
 * @type {import('metro-config').MetroConfig}
 */
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const packageDir = (name) => path.dirname(require.resolve(`${name}/package.json`));

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  maxWorkers: 2,
  resolver: {
    extraNodeModules: {
      'snas-tv': path.resolve(__dirname, 'firetv/tv/vega.ts'),
      'snas-focus': path.resolve(__dirname, 'firetv/focus/vega.ts'),
      'snas-player': path.resolve(__dirname, 'firetv/player/vega.tsx'),
      'react-native-linear-gradient': packageDir('@amazon-devices/react-linear-gradient'),
    },
  },
});
