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

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const PROJECT = 'demo-devfest-cfp';
const DATA_DIR = '.emulator-data';
const FIRESTORE = '127.0.0.1:8080';
const AUTH = '127.0.0.1:9099';
const FUNCTIONS = '127.0.0.1:5001';

const children = [];
let shuttingDown = false;

/**
 * Deliberately not `detached`. It looks like the fix for the orphaned Firestore
 * JVM, but it puts the children outside this process's group — which is also
 * how Playwright tears the stack down after an e2e run. Detaching left the
 * emulators and Vite alive after Playwright killed us, which is worse.
 */
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

/**
 * Every emulator, not just the first. Firestore wins the race on a cold start,
 * and waiting only for it hands out a stack whose auth and functions ports are
 * still closed — which reads as an app bug, not a startup one.
 *
 * Any HTTP response means listening; the functions emulator 404s at the root.
 */
async function waitForEmulators() {
  const wanted = { firestore: FIRESTORE, auth: AUTH, functions: FUNCTIONS };
  await Promise.all(
    Object.entries(wanted).map(async ([name, host]) => {
      for (let i = 0; i < 240; i++) {
        try {
          await fetch(`http://${host}/`);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      throw new Error(`${name} emulator never came up on ${host}`);
    }),
  );
}

/**
 * Clears a previous run's emulators off our ports.
 *
 * A crashed run, a force-quit terminal, or Playwright tearing the stack down
 * after an e2e run can all leave the Firestore JVM listening on 8080 with no
 * visible parent. Without this the next `npm start` fails on a port owned by
 * nothing you can find.
 *
 * Only ever kills a process whose command line is recognisably one of ours;
 * anything else is reported and left alone, because port 8080 is popular.
 */
function reclaimPorts() {
  const ours = /cloud-firestore-emulator|firebase|emulator|[/\\]vite$|[/\\]vite\s/i;

  for (const [name, host] of Object.entries({ firestore: FIRESTORE, auth: AUTH, functions: FUNCTIONS })) {
    const port = host.split(':')[1];
    let pids;
    try {
      pids = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean);
    } catch {
      continue; // nothing listening, or no lsof — let the emulator report it
    }

    for (const pid of pids) {
      let command = '';
      try {
        command = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim();
      } catch {
        continue;
      }
      if (!ours.test(command)) {
        console.error(`Port ${port} (${name}) is held by something that is not ours:\n  ${command}`);
        process.exit(1);
      }
      console.log(`▸ clearing a stale ${name} emulator on ${port} (pid ${pid})`);
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

/** A window comfortably around today, so the form is open on a fresh checkout. */
function devWindow() {
  const day = 24 * 60 * 60 * 1000;
  const iso = (offset) => new Date(Date.now() + offset).toISOString().slice(0, 10);
  return { opens: iso(-30 * day), closes: iso(60 * day) };
}

/**
 * Waits for the children to actually go.
 *
 * Exiting on a fixed timer instead left the firebase CLI mid-shutdown, and the
 * Firestore JVM it had spawned survived holding port 8080 — so the next
 * `npm start` failed on a port belonging to a process with no visible parent.
 */
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  const alive = children.filter((c) => c.exitCode === null);
  for (const child of alive) child.kill('SIGINT');

  // The emulators export their data on the way out, which is not instant.
  for (let i = 0; i < 60 && alive.some((c) => c.exitCode === null); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const child of alive) if (child.exitCode === null) child.kill('SIGKILL');

  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

const javaHome = resolveJava();
if (!javaHome) {
  console.error('No JVM found. Install one (brew install openjdk@21) or set JAVA_HOME.');
  process.exit(1);
}
const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${javaHome}/bin:${process.env.PATH}` };

reclaimPorts();

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
).on('exit', (code) => void shutdown(code ?? 0));

await waitForEmulators();

const { opens, closes } = devWindow();
console.log(`\n▸ seeding config/cfp (${opens} → ${closes})\n`);
await runToCompletion('node', ['scripts/seed-config.mjs', '--opens', opens, '--closes', closes], {
  env: { ...env, FIRESTORE_EMULATOR_HOST: FIRESTORE, GCLOUD_PROJECT: PROJECT },
});

console.log('\n▸ dev server on http://localhost:5173\n');
run('npx', ['vite'], { env }).on('exit', (code) => void shutdown(code ?? 0));
