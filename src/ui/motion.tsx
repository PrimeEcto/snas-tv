import React, {createContext, useContext, useEffect, useState} from 'react';
import {AccessibilityInfo} from 'react-native';
const MotionContext = createContext(true);
/** One native observer for the entire catalog, rather than one per cover. */
export function MotionProvider({children}: {children: React.ReactNode}) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return (
    <MotionContext.Provider value={reduced}>{children}</MotionContext.Provider>
  );
}
export const useReducedMotion = () => useContext(MotionContext);
