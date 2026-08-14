/**
 * One command for the whole local stack: emulators, seeded config, dev server.
 *
 * Four separate steps in the right order, each of which fails silently if you
 * skip it — no `functions` emulator makes every callable look broken, and with
 * no CFP seeded the home page is an empty list on a perfectly good build.
 *
 *   npm start                  # everything, data kept between runs
 *   npm start -- --fresh       # discard the emulator data first
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import process from 'node:process';

import { javaEnv } from './java.mjs';

const PROJECT = 'demo-devfest-cfp';
const DATA_DIR = process.env.CFP_EMULATOR_DATA_DIR || '.emulator-data';
const FIRESTORE = '127.0.0.1:8080';
const AUTH = '127.0.0.1:9099';
const FUNCTIONS = '127.0.0.1:5001';
const STORAGE = '127.0.0.1:9199';
/** The one seeded locally. The same id the e2e specs use. */
const DEV_CFP = 'devfest-mtl-2026';

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
 * Every emulator, not just the first. Firestore wins the race on a cold start,
 * and waiting only for it hands out a stack whose auth and functions ports are
 * still closed — which reads as an app bug, not a startup one.
 *
 * Any HTTP response means listening; the functions emulator 404s at the root.
 */
async function waitForPorts() {
  const wanted = { firestore: FIRESTORE, auth: AUTH, functions: FUNCTIONS, storage: STORAGE };
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
 * A listening functions port is not a working one: the emulator accepts
 * connections about four seconds before it finishes discovering the code, and
 * every callable 404s in between. Nothing downstream can tell that window from
 * a genuinely missing function — Playwright's readiness check is the Vite port,
 * so an e2e run that opens with a callable used to fail its first two tests.
 *
 * So probe a real callable and wait for it to answer as itself. Unauthenticated
 * is the expected reply here, and it means the code is loaded.
 */
async function waitForCallables() {
  const url = `http://${FUNCTIONS}/${PROJECT}/northamerica-northeast1/claimRole`;
  for (let i = 0; i < 240; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"data":{}}',
      });
      if (!(await response.text()).includes('does not exist')) return;
    } catch {
      // Port not up yet; waitForPorts reports that failure.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('functions emulator never registered its callables');
}

async function waitForEmulators() {
  await waitForPorts();
  await waitForCallables();
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
  const ours = /cloud-firestore-emulator|firebase|emulator|[/\\]vite$|[/\\]vite\s|next-server|[/\\]next\s|next dev/i;

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

const env = javaEnv();

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
    'auth,firestore,functions,storage',
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

await runToCompletion(
  'node',
  ['scripts/seed-demo-data.mjs'],
  {
    env: {
      ...env,
      FIRESTORE_EMULATOR_HOST: FIRESTORE,
      FIREBASE_AUTH_EMULATOR_HOST: AUTH,
      GCLOUD_PROJECT: PROJECT,
    },
  },
);

console.log(`\n▸ dev server on http://localhost:5173/c/${DEV_CFP}\n`);
run('npx', ['next', 'dev', '-p', '5173'], {
  env: {
    ...env,
    /*
     * The dev server renders the public pages, so it needs Firestore too — and
     * unlike the browser it has no `connectFirestoreEmulator` call to redirect
     * it. These two are what the admin SDK reads instead: with the host set it
     * skips credentials entirely, which is why `next dev` needs no service
     * account.
     */
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    GCLOUD_PROJECT: 'demo-devfest-cfp',
    SITE_ORIGIN: 'http://localhost:5173',
  },
}).on('exit', (code) => void shutdown(code ?? 0));
