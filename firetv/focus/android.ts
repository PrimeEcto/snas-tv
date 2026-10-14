/**
 * Fire OS focus requests.
 *
 * On Android a view takes focus itself: React Native exposes `focus()` on the host
 * component instance, which is the same call as `View.requestFocus()`. A node that cannot
 * accept focus (or a ref that is still null) must never break a screen transition, so this
 * is total — it either focuses the node or returns.
 */
type FocusableNode = {focus?: () => void};

export function requestFocus(node: unknown): void {
  try {
    (node as FocusableNode | null | undefined)?.focus?.();
  } catch {
    // Nothing to do: focus is best-effort, and the focus scope has already been updated.
  }
}
