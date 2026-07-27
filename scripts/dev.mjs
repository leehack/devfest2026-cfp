/**
 * One command for the whole local stack: emulators, seeded config, dev server.
 *
 * Four separate steps in the right order, each of which fails silently if you
 * skip it — no `functions` emulator makes every callable look broken, and no
 * `config/cfp` renders "the CFP is not open yet" on a perfectly good build.
 *
 *   npm start                  # everything, data kept between runs
 *   npm start -- --fresh       # discard the emulator data first
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const PROJECT = 'demo-devfest-cfp';
const DATA_DIR = '.emulator-data';
const FIRESTORE = '127.0.0.1:8080';

const children = [];
let shuttingDown = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.push(child);
  return child;
}

function runToCompletion(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    run(command, args, options).on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

/**
 * The emulators need a JVM and this machine has none on PATH, so look where
 * Homebrew puts them. Failing here with a clear message beats the emulator's
 * own "java: command not found" three screens later.
 */
function resolveJava() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;

  const brew = '/opt/homebrew/opt';
  const candidates = existsSync(brew)
    ? readdirSync(brew)
        .filter((name) => name.startsWith('openjdk'))
        .sort()
        .reverse()
        .map((name) => join(brew, name, 'libexec/openjdk.jdk/Contents/Home'))
        .filter(existsSync)
    : [];

  return candidates[0];
}

async function waitForFirestore() {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`http://${FIRESTORE}/`);
      if (response.ok || response.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Firestore emulator never came up on ${FIRESTORE}`);
}

/** A window comfortably around today, so the form is open on a fresh checkout. */
function devWindow() {
  const day = 24 * 60 * 60 * 1000;
  const iso = (offset) => new Date(Date.now() + offset).toISOString().slice(0, 10);
  return { opens: iso(-30 * day), closes: iso(60 * day) };
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGINT');
  setTimeout(() => process.exit(code), 2000);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const javaHome = resolveJava();
if (!javaHome) {
  console.error('No JVM found. Install one (brew install openjdk@21) or set JAVA_HOME.');
  process.exit(1);
}
const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${javaHome}/bin:${process.env.PATH}` };

if (process.argv.includes('--fresh')) rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });

// The emulator serves functions/lib, not functions/src.
console.log('\n▸ building functions\n');
await runToCompletion('npm', ['--prefix', 'functions', 'run', 'build'], { env });

console.log('\n▸ starting emulators\n');
run(
  'npx',
  [
    'firebase',
    'emulators:start',
    '--only',
    'auth,firestore,functions',
    '--project',
    PROJECT,
    '--import',
    DATA_DIR,
    '--export-on-exit',
    DATA_DIR,
  ],
  { env },
).on('exit', (code) => shutdown(code ?? 0));

await waitForFirestore();

const { opens, closes } = devWindow();
console.log(`\n▸ seeding config/cfp (${opens} → ${closes})\n`);
await runToCompletion('node', ['scripts/seed-config.mjs', '--opens', opens, '--closes', closes], {
  env: { ...env, FIRESTORE_EMULATOR_HOST: FIRESTORE, GCLOUD_PROJECT: PROJECT },
});

console.log('\n▸ dev server on http://localhost:5173\n');
run('npx', ['vite'], { env }).on('exit', (code) => shutdown(code ?? 0));
