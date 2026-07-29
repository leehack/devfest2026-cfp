/**
 * Cloud Storage, fetched the first time somebody actually touches a file.
 *
 * It is ~34 KB of SDK, and the only thing in the app that uses it is the image
 * answer on the *confirmation* form — which means an accepted speaker, once,
 * and only if their organiser asked for a photo. Loading it eagerly billed that
 * to every visitor who came to read what the call was about. Nothing on the
 * submission form can reach it any more: image fields are refused there
 * outright, so the audience for this is smaller than it has ever been.
 *
 * The emulator wiring lives here rather than in `firebase.ts` for the same
 * reason the import does — `firebase.ts` must not name this module, or the
 * bundler puts it back in the main chunk and none of the above is true.
 */

import type { FirebaseStorage } from 'firebase/storage';

import { app } from '../firebase';
import { USE_EMULATORS } from './env';

let cached: Promise<FirebaseStorage> | null = null;

/**
 * The one instance, connected to the emulator when there is one. Memoised on
 * the promise rather than the result, so two uploads racing on a slow
 * connection share a single load instead of each starting their own.
 */
export function storage(): Promise<FirebaseStorage> {
  cached ??= (async () => {
    const { connectStorageEmulator, getStorage } = await import('firebase/storage');
    const instance = getStorage(app);
    if (USE_EMULATORS) {
      connectStorageEmulator(instance, '127.0.0.1', 9199);
    }
    return instance;
  })();
  return cached;
}
