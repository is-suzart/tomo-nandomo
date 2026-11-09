// nandomo · reader · entry point.
//
//   node dist/bundle.js [arquivo.epub|arquivo.pdf]
//
// Sem argumentos, abre na Biblioteca de Livros (com os recentes salvos).
// Com um caminho de arquivo, abre diretamente o livro no leitor.

import { render } from '@nandomo/bridge-gtk';
import { ReaderApp } from './app.js';
import { createReader } from './model.js';
import { piperEngine } from './speech.js';

const state = createReader();

const handle = render(() => ReaderApp({ state }));

// Listen for dropped files (drag & drop from file manager directly onto the window)
handle.host.transport.onEvent(event => {
  if (event.event === 'change' && event.signal === 'file-drop') {
    const filePath = String(event.value);
    if (filePath) {
      void state.open(filePath);
    }
  }
});

// Listen for cursor clicks in the rich text view to jump narration
handle.host.transport.onEvent(event => {
  if (event.event === 'change' && event.signal === 'cursor-position') {
    let offset = 0;
    let slotName = '';
    if (typeof event.value === 'number') {
      offset = event.value;
    } else if (event.value && typeof event.value === 'object') {
      offset = Number((event.value as { offset?: number }).offset ?? 0);
      slotName = String((event.value as { name?: string }).name ?? '');
    }
    if (Number.isFinite(offset)) {
      state.jumpToChar(offset, slotName);
    }
  }
});

// The window size drives pagination: pages fill the real space.
handle.host.transport.onEvent(event => {
  if (event.event === 'change' && event.signal === 'window-size') {
    const size = event.value as { width: number; height: number };
    if (size.width > 0 && size.height > 0) state.viewport.set(size);
  }
});

// Listen for keyboard navigation (arrow keys ← →, PageUp, PageDown, Space)
handle.host.transport.onEvent(event => {
  if (event.event === 'change' && event.signal === 'key-pressed') {
    if (event.value === 'next') {
      state.nextPage();
    } else if (event.value === 'previous') {
      state.previousPage();
    }
  }
});

// Voices: the local Piper ones, grouped by language in the picker.
void (async () => {
  const voices = await piperEngine.listVoices();
  state.voices.set(voices);
  const savedVoice = state.settings().voiceId;
  const exists = savedVoice && voices.some(v => v.id === savedVoice);
  if (exists) {
    state.voiceId.set(savedVoice);
  } else {
    // Default to the first pt-BR voice so the reader speaks the book's language.
    const preferred = voices.find(v => v.lang.startsWith('pt')) ?? voices[0];
    if (preferred) state.setVoice(preferred.id);
  }
})();

// Optional file on the command line
const path = process.argv[2];
if (path) {
  void state.open(path);
}

// Keep Node alive — the child GTK host owns the UI.
process.stdin.resume();
