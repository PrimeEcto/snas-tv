import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import {BackHandler, View} from 'react-native';
import {requestFocus} from 'snas-focus';
type Registry = {
  nodes: Map<string, unknown>;
  last: string;
  initial: string;
  active: boolean;
  restore: string;
  autoFocus: boolean;
};
const FocusContext = createContext<Registry | null>(null);
export function FocusScope({
  active = true,
  initial,
  children,
  autoFocus = true,
}: {
  active?: boolean;
  initial: string;
  children: React.ReactNode;
  autoFocus?: boolean;
}) {
  const registry = useRef<Registry>({
    nodes: new Map(),
    last: '',
    initial,
    active: false,
    restore: initial,
    autoFocus,
  });
  const state = registry.current;
  if (active && (!state.active || state.initial !== initial))
    state.restore = state.nodes.has(state.last) ? state.last : initial;
  state.initial = initial;
  state.active = active;
  state.autoFocus = autoFocus;
  useEffect(() => {
    if (!active || !autoFocus) return;
    const restore = registry.current.restore;
    const timer = setTimeout(() => {
      const r = registry.current;
      if (!r.active) return;
      requestFocus(
        r.nodes.get(restore) ||
          r.nodes.get(r.initial) ||
          r.nodes.values().next().value,
      );
    }, 140);
    return () => clearTimeout(timer);
  }, [active, initial, autoFocus]);
  return (
    <FocusContext.Provider value={registry.current}>
      <View
        style={{flex: 1, display: active ? 'flex' : 'none'}}
        pointerEvents={active ? 'auto' : 'none'}
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
        {children}
      </View>
    </FocusContext.Provider>
  );
}
export function useFocusNode(id: string) {
  const context = useContext(FocusContext);
  const ref = useCallback(
    (node: unknown) => {
      if (node) context?.nodes.set(id, node);
      else context?.nodes.delete(id);
    },
    [context, id],
  );
  const remember = () => {
    if (context?.active) context.last = id;
  };
  return {
    ref,
    remember,
    preferred: !!context?.active && context.autoFocus && id === context.restore,
  };
}
export function useFocusTarget() {
  const context = useContext(FocusContext);
  return useCallback(
    (id: string) => {
      if (context?.active) requestFocus(context.nodes.get(id));
    },
    [context],
  );
}
/** Hidden mounted screens must never consume another screen's Back key. */
export function useScopeBack(handler: () => boolean, enabled: boolean) {
  const context = useContext(FocusContext);
  const active = !!context?.active;
  useEffect(() => {
    if (!active || !enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [active, enabled, handler]);
}
