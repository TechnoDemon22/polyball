import { useCallback, useEffect, useState } from 'react';

/**
 * Hand-rolled router supporting root hosting and subpath hosting (e.g. GitHub Pages).
 *
 *   /               landing
 *   /practice       browser-only practice match
 *   /join/ABCD12    join room link
 *   /room/ABCD12    active online room
 */
export type Route =
  | { name: 'landing' }
  | { name: 'practice' }
  | { name: 'join'; code: string }
  | { name: 'room'; code: string };

const NAVIGATION_EVENT = 'polyball:navigate';

/** Only the unambiguous room-code characters are accepted from the URL. */
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,8}$/;

function getBasePath(): string {
  if (typeof window === 'undefined') return '';
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length > 0 && parts[0] === 'polyball') {
    return '/polyball';
  }
  return '';
}

export function parseRoute(pathname: string): Route {
  let parts = pathname.split('/').filter(Boolean);
  // Strip subpath prefix if hosted on GitHub Pages (e.g. /polyball/...)
  if (parts.length > 0 && parts[0] === 'polyball') {
    parts = parts.slice(1);
  }
  if (parts.length === 0) return { name: 'landing' };
  if (parts[0] === 'practice') return { name: 'practice' };
  if (parts[0] === 'join') {
    const code = (parts[1] ?? '').toUpperCase();
    return ROOM_CODE_PATTERN.test(code) ? { name: 'join', code } : { name: 'landing' };
  }
  if (parts[0] === 'room') {
    const code = (parts[1] ?? '').toUpperCase();
    return ROOM_CODE_PATTERN.test(code) ? { name: 'room', code } : { name: 'landing' };
  }
  return { name: 'landing' };
}

export function navigate(to: string, replace = false): void {
  if (typeof window === 'undefined') return;
  const base = getBasePath();
  const target = base && !to.startsWith(base) ? `${base}${to.startsWith('/') ? '' : '/'}${to}` : to;

  if (replace) window.history.replaceState({}, '', target);
  else window.history.pushState({}, '', target);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function useRoute(): { route: Route; go: (to: string, replace?: boolean) => void } {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(typeof window === 'undefined' ? '/' : window.location.pathname),
  );

  useEffect(() => {
    const sync = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATION_EVENT, sync);
    };
  }, []);

  const go = useCallback((to: string, replace = false): void => navigate(to, replace), []);
  return { route, go };
}
