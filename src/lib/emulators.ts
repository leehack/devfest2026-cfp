/**
 * Whether this bundle is talking to the emulator suite.
 *
 * Its own module, holding one literal read of the variable, because that read is
 * what lets the bundler drop `devAuth` — and `signInWithCredential` with it —
 * from a real build. Written out in full on purpose: a destructure or a computed
 * lookup is not statically replaced, and the branch would survive.
 */
export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
