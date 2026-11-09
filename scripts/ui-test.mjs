// nandomo · reader · UI structure test.
//
// Builds the app's spec tree without a GTK host, so the layout can be
// checked headlessly: the slider, the two-column spread, the grouped voices
// and the i18n strings are all plain data in the tree.
//
//   node --import tsx scripts/ui-test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { ReaderApp } from '../src/app.js';
import { createReader } from '../src/model.js';
import { loadBook } from '../src/documents.js';
import { piperEngine } from '../src/speech.js';

/** A minimal EPUB with three chapters, enough to exercise the reader. */
function buildEpub(path) {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  const chapters = ['Um', 'Dois', 'Três'];
  const items = chapters
    .map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('');
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('');
  zip.addFile(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Livro de Teste</dc:title><dc:language>pt-BR</dc:language><dc:creator>Autor</dc:creator><dc:identifier id="id">tomo-test</dc:identifier></metadata><manifest>${items}</manifest><spine>${spine}</spine></package>`,
  );
  for (const [i, name] of chapters.entries()) {
    const body = Array.from(
      { length: 40 },
      (_, p) => `<p>Capítulo ${name}, parágrafo ${p + 1}. Uma frase de teste para a narração do tomo, com acentuação e pontuação.</p>`,
    ).join('');
    zip.addFile(`OEBPS/c${i}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${name}</h1>${body}</body></html>`);
  }
  zip.writeZip(path);
}

const epubPath = join(mkdtempSync(join(tmpdir(), 'tomo-ui-')), 'teste.epub');
buildEpub(epubPath);

const state = createReader();
await state.open(epubPath);
state.voices.set(await piperEngine.listVoices());
state.voiceId.set(state.voices()[0]?.id ?? '');

/**
 * Depth-first walk over a spec tree, collecting every node.
 * `Show`/`For` from @nandomo/core are dynamic regions: their content is a
 * function, so the walk resolves the visible branch.
 */
function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.__spec) out.push(node);
  if (node.__dialog) {
    out.push(node);
    walk(node.props.children, out);
    return out;
  }
  if (node.__dynamic) {
    if (node.kind === 'show') {
      const shown = node.props.when();
      if (shown) walk(node.props.children(), out);
      else if (node.props.fallback) walk(node.props.fallback(), out);
    } else {
      for (const item of node.props.each()) walk(node.props.children(() => item, () => 0), out);
    }
    return out;
  }
  const children = node.props?.children;
  if (Array.isArray(children)) for (const child of children) walk(child, out);
  else if (children) walk(children, out);
  return out;
}

const tree = ReaderApp({ state });
const nodes = walk(tree);
const kinds = nodes.map(n => n.kind);

console.log('[ui] 1. Estrutura básica...');
assert.ok(kinds.includes('gtk:Window'), 'A janela GTK existe');
assert.ok(kinds.includes('gtk:Slider'), 'O slider de progresso existe');
console.log(`  ✓ ${nodes.length} nós, slider presente`);

console.log('[ui] 2. Modal de opções...');
state.optionsOpen.set(true);
const dialogNodes = walk(ReaderApp({ state }));
const dialogNode = dialogNodes.find(n => n.__dialog);
assert.ok(dialogNode, 'O diálogo de opções é montado quando as opções abrem');
const modalNodes = walk(dialogNode.props.children);
assert.ok(modalNodes.some(n => n.kind === 'gtk:Select'), 'O seletor de voz existe no modal');
state.optionsOpen.set(false);
console.log('  ✓ modal com seletor de voz');

console.log('[ui] 3. Modo páginas tem duas colunas...');
const classesOf = n => (typeof n.props?.cssClasses === 'function' ? n.props.cssClasses() : n.props?.cssClasses) ?? '';
state.readingMode.set('pages');
const pagesTree = ReaderApp({ state });
const pagesNodes = walk(pagesTree);
const pagesFixed = pagesNodes
  .filter(n => n.kind === 'gtk:RichText')
  .filter(n => String(classesOf(n)).includes('reader-page-fixed'));
assert.equal(pagesFixed.length, 2, 'O modo páginas mostra exatamente 2 colunas');
state.readingMode.set('scroll');
const scrollTree = ReaderApp({ state });
const scrollFixed = walk(scrollTree)
  .filter(n => n.kind === 'gtk:RichText')
  .filter(n => String(classesOf(n)).includes('reader-page-fixed'));
assert.equal(scrollFixed.length, 0, 'O modo rolagem não mostra páginas fixas');
assert.ok(walk(scrollTree).some(n => n.kind === 'gtk:RichText'), 'O modo rolagem mostra o texto');
console.log('  ✓ rolagem e páginas são mutuamente exclusivos');

console.log('[ui] 4. Vozes agrupadas por idioma...');
state.optionsOpen.set(true);
const voiceDialog = walk(ReaderApp({ state })).find(n => n.__dialog);
const selectNode = walk(voiceDialog.props.children).find(n => n.kind === 'gtk:Select');
const options = typeof selectNode.props.options === 'function' ? selectNode.props.options() : selectNode.props.options;
const headers = options.filter(o => o.label.startsWith('— '));
assert.ok(headers.length >= 2, 'Há um cabeçalho por idioma');
assert.ok(options.some(o => o.value === ''), 'Os cabeçalhos não são selecionáveis');
state.optionsOpen.set(false);
console.log(`  ✓ ${headers.length} grupos: ${headers.map(o => o.label).join(', ')}`);

console.log('[ui] 5. i18n aplicada...');
// Static check on the source: no user-facing Portuguese may survive outside
// the catalog. Technical strings (css classes, icon names) are not text.
const raw = readFileSync(new URL('../src/app.tsx', import.meta.url), 'utf8');
// Comments are not user-facing text.
const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const UI_WORDS = [
  'Escolher', 'Ler agora', 'Remover do histórico', 'Recentes', 'Configurações',
  'Voz Padrão', 'Narração', 'Tema da Página', 'Tipografia', 'Tamanho da Fonte',
  'Alinhamento', 'Velocidade', 'Concluir', 'Fechar', 'SUMÁRIO', 'Capítulo',
  'Frase anterior', 'Próxima frase', 'Pausar fala', 'Iniciar narração', 'Parar fala',
  'Abrir configurações', 'Personalize', 'Justificado', 'À esquerda', 'Clique em',
  'Biblioteca', 'Opções', 'LIVROS RECENTES', 'leitor autoral', 'Progresso geral',
];
const hardcoded = UI_WORDS.filter(word => source.includes(word));
assert.deepEqual(hardcoded, [], 'Texto de interface em português fora do catálogo: ' + hardcoded.join(', '));
const { catalogs: cat } = await import('../src/i18n.js');
const keys = Object.keys(cat['pt-BR']);
assert.ok(keys.length > 50, 'O catálogo tem conteúdo');
console.log(`  ✓ nenhuma string de UI fora do catálogo (${keys.length} chaves)`);

console.log('\n[ui] TODOS OS TESTES PASSARAM! 🎉');
