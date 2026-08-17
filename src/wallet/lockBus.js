// RootNavigator owns the app's `locked` boolean (it's the thing deciding
// whether to render LockScreen vs the real navigator stack), but the
// "Log out" action lives in SettingsScreen, several component layers away.
// Rather than thread a callback down through every screen's props, screens
// that want to force an immediate lock call requestLock(); RootNavigator
// is the sole subscriber and flips its own state in response.
const listeners = new Set();

export function requestLock() {
  listeners.forEach((fn) => fn());
}

export function onLockRequested(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
