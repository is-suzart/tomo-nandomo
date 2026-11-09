// nandomo · reader · native file picker.
//
// Uses the system's native file chooser (via zenity, which routes through
// the XDG Desktop Portal on modern Linux/Wayland environments).
// This gives a complete, full-featured file manager dialog with folder
// navigation, search, and .epub / .pdf filtering.

import { spawn } from 'node:child_process';

export async function pickFile(): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawn(
      'zenity',
      [
        '--file-selection',
        '--title=Escolha um livro (EPUB ou PDF)',
        '--file-filter=Livros digitais (*.epub, *.pdf) | *.epub *.pdf *.EPUB *.PDF',
        '--file-filter=Todos os arquivos | *',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.on('error', () => {
      resolve(null);
    });

    child.on('close', code => {
      const selected = stdout.trim();
      resolve(code === 0 && selected.length > 0 ? selected : null);
    });
  });
}
