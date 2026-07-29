import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * The current value of something, readable from a callback that must not be
 * rebuilt when it changes.
 *
 * This exists for one specific mistake. A loader written as
 * `useCallback(async () => { … } catch { setError(adminError(e, t)) } }, [cfpId, t])`
 * lists the dictionary as a dependency because it reads it — and then re-runs
 * whenever the language changes, refetching and overwriting whatever the person
 * at the keyboard has typed but not yet saved.
 *
 * That was survivable while the locale only changed when somebody pressed the
 * switch. It stopped being survivable when the locale started settling right
 * after mount: the server cannot know it, so the first client render uses the
 * default and the real one arrives a tick later, on every single page load.
 *
 * So: the dictionary is read through here and kept out of the dependency list.
 * The message is built when the error happens, which is the only moment it is
 * needed, and a language switch no longer throws away unsaved work.
 */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
