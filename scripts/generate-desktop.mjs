import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tomoAppMeta, generateDesktopEntry } from '../src/meta.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopPath = resolve(__dirname, '..', 'tomo.desktop');

const content = generateDesktopEntry(tomoAppMeta);
writeFileSync(desktopPath, content, 'utf8');
console.log(`[desktop] Gerado tomo.desktop com sucesso a partir do AppMeta: ${tomoAppMeta.name} v${tomoAppMeta.version}`);
