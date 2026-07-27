/**
 * The emulators need a JVM, and a Mac with Homebrew openjdk does not put one on
 * PATH. Failing here with a clear message beats the emulator's own
 * "java: command not found" three screens later.
 *
 * Shared by `npm start` and `npm run test:rules`, which both start emulators.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export function resolveJava() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;

  const brew = '/opt/homebrew/opt';
  if (!existsSync(brew)) return undefined;

  return readdirSync(brew)
    .filter((name) => name.startsWith('openjdk'))
    .sort()
    .reverse()
    .map((name) => join(brew, name, 'libexec/openjdk.jdk/Contents/Home'))
    .find(existsSync);
}

/** Exits rather than returning a broken environment — every caller needs one. */
export function javaEnv() {
  const javaHome = resolveJava();
  if (!javaHome) {
    console.error('No JVM found. Install one (brew install openjdk@21) or set JAVA_HOME.');
    process.exit(1);
  }
  return { ...process.env, JAVA_HOME: javaHome, PATH: `${javaHome}/bin:${process.env.PATH}` };
}
