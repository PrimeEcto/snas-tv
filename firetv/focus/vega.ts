/**
 * Vega OS focus requests.
 *
 * Kepler deprecates `ref.current.focus()` with an explicit warning ("use requestTVFocus
 * instead") and exposes `requestTVFocus()` on the host component instance — the same
 * FocusManager focus command, reached without a tag lookup. The older `focus()` is kept as
 * a fallback for views that never picked up that method, and the whole call is guarded
 * because focusing a node that has already unmounted must not break a screen transition.
 */
type FocusableNode = {requestTVFocus?: () => void; focus?: () => void};

export function requestFocus(node: unknown): void {
  try {
    const view = node as FocusableNode | null | undefined;
    if (typeof view?.requestTVFocus === 'function') {
      view.requestTVFocus();
      return;
    }
    view?.focus?.();
  } catch {
    // Nothing to do: focus is best-effort, and the focus scope has already been updated.
  }
}
