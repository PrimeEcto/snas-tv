/**
 * The on-disk half of `playback-attempt`, kept separate so the logic stays testable without a
 * platform: nothing in `playback-attempt.ts` imports React Native, and this file is the only place
 * an AsyncStorage call appears.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {AttemptStorage} from './playback-attempt';

export const attemptStorage: AttemptStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
