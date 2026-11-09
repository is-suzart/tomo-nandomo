#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const bundlePath = resolve(appDir, 'dist', 'bundle.js');

if (!existsSync(bundlePath)) {
  console.error('[tomo] bundle.js não encontrado. Execute `pnpm run build` primeiro.');
  process.exit(1);
}

const child = spawn(process.execPath, [bundlePath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BRIDGE_GTK_HOST_PATH:
      process.env.BRIDGE_GTK_HOST_PATH ??
      resolve(appDir, 'host', 'target', 'release', 'bridge-gtk-host'),
    GDK_BACKEND:
      process.env.GDK_BACKEND ??
      (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11'),
  },
});

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
