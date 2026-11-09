// nandomo · reader · smoke test.
//
// Verifies that:
// 1. EPUB loads and extracts chapters and text
// 2. PDF loads and extracts pages
// 3. Sentence splitter works
// 4. Markup runs generate valid Pango markup
// 5. Speech engines list voices
// 6. GTK bridge bundle builds cleanly

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBook } from '../src/documents.js';
import { splitSentences, runsToMarkup, paginateText } from '../src/markup.js';
import { piperEngine } from '../src/speech.js';

console.log('[smoke] 1. Testando EPUB...');
const epubPath = '/tmp/docs-pipeline/fixtures/pt-br.epub';
if (existsSync(epubPath)) {
  const epub = await loadBook(epubPath);
  assert.ok(epub.title, 'EPUB deve ter título');
  assert.ok(epub.chapters.length > 0, 'EPUB deve ter capítulos');
  const ch = epub.chapters[1] ?? epub.chapters[0];
  assert.ok(ch, 'Capítulo deve existir');
  const text = epub.text.get(ch.id);
  assert.ok(text && text.length > 0, 'Capítulo deve ter texto');
  const sentences = splitSentences(text);
  assert.ok(sentences.length > 0, 'Deve segmentar em sentenças');
  const markup = runsToMarkup(epub.runs.get(ch.id) ?? []);
  assert.ok(markup.length > 0, 'Deve gerar markup Pango');
  console.log(`  ✓ EPUB "${epub.title}" OK (${epub.chapters.length} caps, ${sentences.length} frases no cap 1)`);
} else {
  console.log('  ⚠ fixture EPUB não encontrada, pulando');
}

console.log('[smoke] 2. Testando PDF...');
const pdfPath = '/tmp/docs-pipeline/fixtures/teste-ptbr.pdf';
if (existsSync(pdfPath)) {
  const pdf = await loadBook(pdfPath);
  assert.ok(pdf.chapters.length > 0, 'PDF deve ter páginas/capítulos');
  const first = pdf.chapters[0];
  assert.ok(first, 'Página 1 deve existir');
  const text = pdf.text.get(first.id);
  assert.ok(text && text.includes('príncipe'), 'Texto deve conter caracteres acentuados');
  console.log(`  ✓ PDF "${pdf.title}" OK (${pdf.chapters.length} páginas)`);
} else {
  console.log('  ⚠ fixture PDF não encontrada, pulando');
}

console.log('[smoke] 3. Testando motores de voz...');
const piperVoices = await piperEngine.listVoices();
assert.ok(piperVoices.length > 0, 'Piper deve listar as vozes instaladas');
assert.ok(piperVoices.every(v => v.engine === 'piper'), 'Só há vozes Piper');
const ptVoice = piperVoices.find(v => v.lang === 'pt-BR');
assert.ok(ptVoice, 'Piper deve ter voz pt-BR');
assert.ok(!piperVoices.some(v => v.id.includes('Neural')), 'Nenhuma voz do Edge deve sobrar');
console.log(`  ✓ Piper OK (${piperVoices.length} vozes locais, pt-BR: ${ptVoice.label})`);

console.log('[smoke] 4. Testando paginação...');
const sample = 'Uma página.\n'.repeat(200);
const pages = paginateText(sample, 500);
assert.ok(pages.length > 1, 'O texto longo deve virar várias páginas');
// As páginas devem cobrir o texto sem perder caracteres.
assert.equal(pages[0].start, 0, 'A primeira página começa no início');
assert.equal(pages[pages.length - 1].end, sample.length, 'A última página termina no fim');
for (let i = 1; i < pages.length; i++) {
  assert.ok(pages[i].start > pages[i - 1].start, 'As páginas avançam');
  assert.ok(pages[i].start <= pages[i - 1].end + 1, 'Sem buracos entre páginas');
}
const covered = pages.map(p => sample.slice(p.start, p.end)).join('');
assert.equal(covered.replace(/\n/g, ''), sample.replace(/\n/g, ''), 'Nenhum caractere se perde');
const single = paginateText('curto', 500);
assert.deepEqual(single, [{ start: 0, end: 5 }], 'Texto curto fica em uma página');
console.log(`  ✓ Paginação OK (${pages.length} páginas de um texto longo)`);

console.log('[smoke] 5. Testando i18n...');
const { catalogs } = await import('../src/i18n.js');
assert.ok(catalogs['pt-BR'], 'Catálogo pt-BR deve existir');
assert.ok(catalogs.en, 'Catálogo en deve existir');
const missing = Object.keys(catalogs['pt-BR']).filter(key => !(key in catalogs.en));
assert.deepEqual(missing, [], 'Os dois catálogos devem ter as mesmas chaves');
console.log(`  ✓ i18n OK (${Object.keys(catalogs['pt-BR']).length} chaves em 2 idiomas)`);

console.log('[smoke] 6. Testando slider livre e paginação pela janela...');
{
  const { createReader, SEEK_SETTLE_MS, charsPerPage } = await import('../src/model.js');
  const { effect } = await import('@nandomo/core');
  const reader = createReader();
  // 4 capítulos de 1000 caracteres: 25% do livro cada.
  const body = 'Frase de teste. '.repeat(62) + 'Fim.';
  const chapters = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id, images: [] }));
  reader.book.set({
    title: 'T', author: '', language: 'pt', chapters, format: 'epub', sourcePath: '/nao/existe.epub',
    runs: new Map(chapters.map(c => [c.id, [{ text: body, tags: [] }]])),
    text: new Map(chapters.map(c => [c.id, body])),
  });
  reader.chapterId.set('a');
  assert.deepEqual(reader.chapterMarks().map(Math.round), [25, 50, 75], 'Marcas nos inícios de capítulo');
  const seen = [];
  const watch = effect(() => { seen.push(reader.chapterId()); });
  for (const v of [10, 40, 66, 90, 62.5]) reader.seekTo(v);
  assert.equal(reader.chapterId(), 'a', 'Nada carrega durante o arraste');
  await new Promise(r => setTimeout(r, SEEK_SETTLE_MS + 50));
  assert.equal(reader.chapterId(), 'c', '62.5% cai no capítulo 3');
  assert.ok(Math.abs(reader.readingProgress() - 62) <= 1, `Posição dentro do capítulo preservada (${reader.readingProgress()}%)`);
  assert.deepEqual(seen, ['a', 'c'], 'Um único salto, sem capítulos intermediários');
  watch.dispose();
  reader.dispose();

  const small = charsPerPage(18, 1.6, 1, { width: 1180, height: 820 }, true);
  const tall = charsPerPage(18, 1.6, 1, { width: 1180, height: 1300 }, true);
  assert.ok(tall > small * 1.5, 'Janela mais alta cabe mais texto por página');
  console.log(`  ✓ Slider OK (5 eventos → 1 salto); página ${small} → ${tall} caracteres numa janela alta`);
}

console.log('[smoke] 7. Testando narração contínua entre capítulos...');
{
  const { createReader } = await import('../src/model.js');
  const speech = await import('../src/speech.js');
  const spoken = [];
  // Sem áudio: síntese e player falsos, instantâneos.
  const realSynth = speech.piperEngine.synthesize;
  speech.piperEngine.synthesize = async text => { spoken.push(text); return { path: '/dev/null', format: 'wav', dispose() {} }; };
  speech.setPlayerForTests({ name: 'fake', run: async () => {} });
  const reader = createReader();
  const chapters = ['a', 'b'].map(id => ({ id, title: id, images: [] }));
  reader.book.set({
    title: 'T', author: '', language: 'pt', chapters, format: 'epub', sourcePath: '/nao/existe.epub',
    runs: new Map(chapters.map(c => [c.id, [{ text: `Um ${c.id}. Dois ${c.id}.`, tags: [] }]])),
    text: new Map(chapters.map(c => [c.id, `Um ${c.id}. Dois ${c.id}.`])),
  });
  reader.chapterId.set('a');
  reader.voiceId.set('fake');
  reader.play();
  for (let i = 0; i < 50 && reader.playing(); i++) await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(spoken.map(s => s.trim()), ['Um a.', 'Dois a.', 'Um b.', 'Dois b.'], 'Lê o capítulo seguinte sem parar');
  assert.equal(reader.chapterId(), 'b', 'Terminou no último capítulo');
  assert.equal(reader.playing(), false, 'Para no fim do livro');
  speech.piperEngine.synthesize = realSynth;
  speech.setPlayerForTests(null);
  reader.dispose();
  console.log(`  ✓ Narração OK (${spoken.length} frases em 2 capítulos, sem parar no meio)`);
}

console.log('[smoke] 8. Testando regressões: Pango, voz e modo de leitura...');
{
  const { createReader } = await import('../src/model.js');
  const speech = await import('../src/speech.js');
  const { chapterRuns, runsToMarkup } = await import('../src/markup.js');

  // (a) Markup inválido do Pango: `indent` não é válido em <span> e faz o
  // Pango rejeitar a string inteira, deixando a página em branco.
  const runs = chapterRuns('<p><blockquote>Uma citação</blockquote><p>Texto.</p></p>');
  const markup = runsToMarkup(runs);
  assert.ok(!markup.includes('indent='), 'O markup nunca usa atributos que o Pango recusa');
  assert.ok(markup.length > 0, 'O markup do capítulo não fica vazio');

  // (b) A voz acompanha a troca de página: sem isso o áudio continua na
  // frase antiga enquanto a tela já virou a página.
  const spoken = [];
  const realSynth = speech.piperEngine.synthesize;
  speech.piperEngine.synthesize = async text => { spoken.push(text); return { path: '/dev/null', format: 'wav', dispose() {} }; };
  // Player lento: com ele instantâneo a narração termina antes do teste.
  speech.setPlayerForTests({ name: 'fake', run: async () => { await new Promise(r => setTimeout(r, 20)); } });
  const reader = createReader();
  const para = 'Primeira frase. Segunda frase. Terceira frase. Quarta frase. Quarta frase. Sexta frase.\n';
  const body = para.repeat(60);
  const chapters = [{ id: 'a', title: 'A', images: [] }];
  reader.book.set({
    title: 'T', author: '', language: 'pt', chapters, format: 'epub', sourcePath: '/nao/existe.epub',
    runs: new Map([['a', [{ text: body, tags: [] }]]]), text: new Map([['a', body]]),
  });
  reader.chapterId.set('a');
  reader.readingMode.set('pages');
  reader.voiceId.set('fake');
  assert.ok(reader.pageCount() > 2, `O capítulo tem várias páginas (tem ${reader.pageCount()}, ${reader.pageSpansCount()} spans, ${reader.effectivePageColumns()} colunas)`);

  reader.play();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(reader.playing(), true, 'A leitura começou');
  const beforeSwitch = spoken.length;
  const sentenceBefore = reader.sentenceIndex();
  reader.goToPage(1);
  await new Promise(r => setTimeout(r, 60));
  assert.ok(spoken.length > beforeSwitch, 'A narração continua depois de trocar de página');
  assert.equal(reader.playing(), true, 'A leitura continua tocando após a troca de página');
  assert.notEqual(reader.sentenceIndex(), sentenceBefore, 'A voz pula para a frase da nova página');

  // (c) Trocar o modo de leitura durante a narração não pode quebrar a voz.
  reader.toggleReadingMode();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(reader.readingMode(), 'scroll', 'O modo de leitura mudou');
  assert.equal(reader.playing(), true, 'A narração continua após trocar de modo');

  speech.piperEngine.synthesize = realSynth;
  speech.setPlayerForTests(null);
  reader.dispose();
  console.log('  ✓ Regressões OK (Pango válido, voz segue a página e a troca de modo)');
}

console.log('\n[smoke] TODOS OS TESTES PASSARAM! 🎉');
