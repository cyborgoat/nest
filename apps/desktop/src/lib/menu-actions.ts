/**
 * Let Radix finish dismissing a menu before opening another modal layer or
 * native picker. Opening both in the same selection event can leave the old
 * layer intercepting pointer input in desktop webviews.
 */
export function afterMenuClose(action: () => void): void {
  globalThis.setTimeout(action, 0);
}
