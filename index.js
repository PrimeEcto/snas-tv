import { AppRegistry } from 'react-native';
import { App } from './src/App';
import { setPackageFormat } from './src/update';
import { name as appName } from './app.json';

// This entry produces a Vega package, so a release that carries both an APK and a .vpkg must
// resolve to the .vpkg. The Fire OS entry keeps the default ('apk'), which is the asset that
// build can install.
setPackageFormat('vpkg');

AppRegistry.registerComponent(appName, () => App);
