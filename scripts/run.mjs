// Runner for the reader example.
//
//   node scripts/run.mjs [arquivo.epub|arquivo.pdf]
//
// Builds are expected to exist already (`pnpm --filter @nandomo/example-reader build`).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const exampleDir = resolve(import.meta.dirname, '..');
const bundlePath = resolve(exampleDir, 'dist', 'bundle.js');

if (!existsSync(bundlePath)) {
  console.error(`[reader] ${bundlePath} ausente — rode \`pnpm --filter @nandomo/example-reader build\` primeiro`);
  process.exit(2);
}

const child = spawn(process.execPath, [bundlePath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GDK_BACKEND:
      process.env.GDK_BACKEND ??
      (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'),
  },
});

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
