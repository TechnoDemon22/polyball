import { useCallback, useState } from 'react';
import { MAX_NAME_LENGTH, sanitizeName } from '@polyball/shared';

const STORAGE_KEY = 'polyball.name.v1';

/** Strip control characters and cap the length while the user is still typing. */
const asDraft = (value: string): string =>
  Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && !(code >= 0x7f && code <= 0x9f);
    })
    .join('')
    .slice(0, MAX_NAME_LENGTH);

/**
 * Display name, persisted between visits.
 *
 * The draft keeps whatever the user is typing (so spaces work), while the value
 * written to storage and handed to the game goes through the shared
 * `sanitizeName`, which is exactly what the server will enforce later.
 */
export function usePlayerName(): [string, (value: string) => void] {
  const [name, setName] = useState<string>(() => {
    try {
      return asDraft(window.localStorage.getItem(STORAGE_KEY) ?? '');
    } catch {
      return '';
    }
  });

  const update = useCallback((value: string): void => {
    const draft = asDraft(value);
    setName(draft);
    try {
      window.localStorage.setItem(STORAGE_KEY, sanitizeName(draft));
    } catch {
      // Ignore: private browsing just means the name is per-session.
    }
  }, []);

  return [name, update];
}
