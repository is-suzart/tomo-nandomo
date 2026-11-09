import { defineAppMeta, defineProject, type AppMeta } from '@nandomo/core';

/**
 * Metadados declarativos oficiais do tomo definidos via `defineAppMeta`.
 * Utilizados para gerar manifestos, .desktop, títulos e identidades de plataforma.
 */
export const tomoAppMeta: AppMeta = defineAppMeta({
  id: 'dev.bocchi.tomo',
  name: 'tomo',
  shortName: 'tomo',
  version: '0.1.0',
  description: 'Leitor autoral de EPUB e PDF com narração em voz alta (TTS Piper)',
  color: '#252321', // Preto Suave Bocchi
  icons: {
    svg: 'assets/tomo.svg',
    png_192: 'assets/tomo.png',
    png_512: 'assets/tomo-256.png',
  },
  platforms: {
    linux: {
      categories: ['Office', 'Viewer', 'AudioVideo', 'Audio'],
      terminal: false,
      mimeType: ['application/epub+zip', 'application/pdf'],
    },
    web: {
      display: 'standalone',
      orientation: 'any',
      ogType: 'book',
    },
  },
});

export const tomoProject = defineProject({
  targets: ['gtk', 'html'],
  app: tomoAppMeta,
});

/**
 * Utilitário que gera a entrada `.desktop` do Linux compatível com as especificações do FreeDesktop
 * a partir do AppMeta definido.
 */
export function generateDesktopEntry(meta: AppMeta = tomoAppMeta, execPath = 'tomo %F'): string {
  const linux = meta.platforms.linux;
  const categories = linux?.categories ? linux.categories.join(';') + ';' : 'Office;Viewer;Audio;';
  const mimeTypes = linux?.mimeType ? linux.mimeType.join(';') + ';' : 'application/epub+zip;application/pdf;';
  const terminal = linux?.terminal ? 'true' : 'false';

  return `[Desktop Entry]
Type=Application
Name=${meta.name}
Comment=${meta.description ?? meta.name}
Exec=${execPath}
Icon=tomo
Terminal=${terminal}
Categories=${categories}
MimeType=${mimeTypes}
StartupNotify=true
`;
}
