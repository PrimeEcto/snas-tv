/**
 * Metro for the Fire OS (Android) build.
 *
 * The app source lives one directory up and is shared with the Vega build, so this config watches
 * the parent and redirects the few specifiers whose Android implementation differs from the Vega
 * one: `snas-player` resolves to the ExoPlayer surface here, `snas-tv` and `snas-focus` to the
 * Android adapters, and `react-native-linear-gradient` to the local SVG shim.
 *
 * It also forces a single copy of React and React Native for the whole graph. npm installed its own
 * copies of those in the parent project, and Metro's `extraNodeModules` is only a fallback, so the
 * shared screens would otherwise bundle the parent's React while React Native itself uses this
 * project's — two Reacts, and every hook called from the shared screens reads a null dispatcher.
 * (`TypeError: Cannot read property 'useState' of null` is exactly that failure.)
 */
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const project = __dirname;
const local = name => path.resolve(project, 'node_modules', name);

/** Specifiers resolved for the whole graph from this project's node_modules, never the parent's. */
const SINGLETON = /^(react|react-native|react-native-[a-z0-9-]+|@react-native-async-storage\/[a-z0-9-]+)(\/.*)?$/;

const aliases = {
  'snas-player': path.resolve(project, 'player/android.tsx'),
  'snas-tv': path.resolve(project, 'tv/android.ts'),
  'snas-focus': path.resolve(project, 'focus/android.ts'),
  'react-native-linear-gradient': path.resolve(project, 'shims/linear-gradient'),
};

module.exports = mergeConfig(getDefaultConfig(project), {
  watchFolders: [path.resolve(project, '..')],
  resolver: {
    nodeModulesPaths: [path.resolve(project, 'node_modules')],
    extraNodeModules: {
      react: local('react'),
      'react-native': local('react-native'),
      'react-native-svg': local('react-native-svg'),
      'react-native-video': local('react-native-video'),
      '@react-native-async-storage/async-storage': local('@react-native-async-storage/async-storage'),
      ...aliases,
    },
    resolveRequest: (context, moduleName, platform) => {
      const alias = aliases[moduleName];
      if (alias) return {type: 'sourceFile', filePath: require.resolve(alias)};
      // Resolve singletons as if they were imported by this project's entry, so nothing under
      // ../src can pull in the parent's copy of React or React Native.
      const origin = context.originModulePath ?? '';
      const insideProject = origin === project || origin.startsWith(project + path.sep);
      if (!insideProject && SINGLETON.test(moduleName)) {
        return context.resolveRequest({...context, originModulePath: path.join(project, 'index.js')}, moduleName, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
