/** Runs its arguments with a JVM on PATH. `node scripts/with-java.mjs <cmd> …` */

import { spawn } from 'node:child_process';
import process from 'node:process';

import { javaEnv } from './java.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/with-java.mjs <command> [args…]');
  process.exit(1);
}

spawn(command, args, { stdio: 'inherit', env: javaEnv() }).on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
