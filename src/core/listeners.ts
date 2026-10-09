// Scoped DOM listeners: everything registered through `listen` is removed together when the
// current game view is torn down (switching between the title screen and a game).
let scope = new AbortController();

export function listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): void;
export function listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): void;
export function listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void {
  const o: AddEventListenerOptions = typeof opts === 'boolean' ? { capture: opts } : { ...(opts ?? {}) };
  o.signal = scope.signal;
  target.addEventListener(type, fn as EventListener, o);
}

/** Remove every listener registered since the last reset. */
export function resetListeners(): void {
  scope.abort();
  scope = new AbortController();
}
