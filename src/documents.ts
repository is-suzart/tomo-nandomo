// nandomo · reader · document loading.
//
// Two formats, one shape: a book is a list of chapters, each chapter has
// Pango markup (for display), plain text (for narration), and any
// embedded local images (illustrations, chapter headers, or book cover).
//
// EPUB: a ZIP with `META-INF/container.xml` pointing at the OPF package
// document, which holds the manifest (file → id) and the spine (the
// reading order). Images are unpacked to a session cache directory so
// the GTK host can render them via gtk4::Picture.
//
// PDF: pdf.js extracts the text layer page by page. A page becomes a
// chapter.

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, posix, sep } from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { parse } from 'node-html-parser';
import { chapterRuns, runsToText, type MarkupRun } from './markup.js';
import { workDir } from './speech.js';

export interface Chapter {
  readonly id: string;
  readonly title: string;
  readonly images: readonly string[];
}

export interface BookDocument {
  readonly title: string;
  readonly author: string;
  readonly language: string;
  readonly chapters: readonly Chapter[];
  /** Text runs per chapter id — the display markup is derived from these. */
  readonly runs: ReadonlyMap<string, readonly MarkupRun[]>;
  /** Plain text per chapter id — what the narrator reads. */
  readonly text: ReadonlyMap<string, string>;
  readonly coverImage?: string;
  readonly sourcePath: string;
  readonly format: 'epub' | 'pdf';
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/** Resolve a relative href against the directory of the package document. */
function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0] ?? '';
  if (clean.length === 0) return '';
  return posix.normalize(posix.join(baseDir, decodeURIComponent(clean)));
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  const obj = node as Record<string, unknown>;
  if (typeof obj['#text'] === 'string') return obj['#text'];
  return '';
}

/** First heading of a chapter — used when the book has no table of contents. */
function determineChapterTitle(
  index: number,
  entryPath: string,
  cleanHtml: string,
  navByHref: Map<string, string>,
  coverImage?: string,
): string {
  // 1. From NCX / NAV (both full path and bare path)
  const fromNav = navByHref.get(entryPath);
  if (fromNav && fromNav.trim().length > 0) return fromNav.trim();

  const parsed = parse(cleanHtml);

  // 2. Epigraph detection
  if (parsed.querySelector('.epig, .epigraph, .epigrafe, .cita, .epigraph1, .epig1')) {
    return 'Epígrafe';
  }

  // 3. Meaningful headings
  for (const selector of ['h1', 'h2', 'h3', 'h4', '.title', '.chapter-title', '.titulo', '.subtitulo']) {
    const el = parsed.querySelector(selector);
    const text = el?.text?.trim();
    if (text && text.length >= 2 && text.length <= 80 && !/fimdohomem/i.test(text)) {
      return text;
    }
  }

  // 4. Image-heavy pages
  const images = parsed.querySelectorAll('img, image');
  const rawText = parsed.text.trim();
  if (rawText.length < 60 && images.length > 0) {
    if (index === 0 || /titlepage|cover/i.test(entryPath)) return 'Capa';
    if (index === 1 || /part0000|rosto|apresenta/i.test(entryPath)) return 'Apresentação';
    return 'Ilustração';
  }

  // 5. Strong or bold text if available
  const bold = parsed.querySelector('b, strong')?.text?.trim();
  if (bold && bold.length >= 3 && bold.length <= 60 && !/fimdohomem/i.test(bold)) {
    return bold;
  }

  // 6. First line snippet
  if (rawText.length > 0) {
    const firstLine = rawText.split('\n').map(l => l.trim()).find(l => l.length >= 3);
    if (firstLine && firstLine.length <= 45 && !/fimdohomem/i.test(firstLine)) {
      return firstLine;
    }
  }

  return index === 0 && coverImage ? 'Capa' : `Capítulo ${index + 1}`;
}

// ─── EPUB ────────────────────────────────────────────────────────────────────

interface EpubItem {
  readonly id: string;
  readonly href: string;
  readonly type: string;
  readonly properties: string;
}

interface EpubNavEntry {
  readonly title: string;
  readonly href: string;
}

function readEpubNav(html: string): EpubNavEntry[] {
  const root = parse(html);
  const entries: EpubNavEntry[] = [];
  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    const title = anchor.text.trim();
    if (!title) continue;
    entries.push({ title, href });
  }
  return entries;
}

function readEpubNcx(xmlText: string): EpubNavEntry[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = xml.parse(xmlText) as Record<string, unknown>;
  } catch {
    return [];
  }
  const root = (parsed['ncx'] ?? parsed) as Record<string, unknown>;
  const navMap = (root['navMap'] ?? {}) as Record<string, unknown>;
  const entries: EpubNavEntry[] = [];

  function collectPoints(node: unknown): void {
    if (node == null) return;
    const items = asArray(node as unknown[]);
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const p = item as Record<string, unknown>;
      const label = (p['navLabel'] ?? {}) as Record<string, unknown>;
      const title = textOf(label['text']).trim();
      const content = (p['content'] ?? {}) as Record<string, unknown>;
      const src = typeof content['@src'] === 'string' ? content['@src'] : '';
      if (title && src) {
        entries.push({ title, href: src });
      }
      if (p['navPoint']) {
        collectPoints(p['navPoint']);
      }
    }
  }

  collectPoints(navMap['navPoint']);
  return entries;
}

async function loadEpub(path: string): Promise<BookDocument> {
  const zip = new AdmZip(path);
  const readText = (entry: string): string | null => {
    const found = zip.getEntry(entry);
    if (!found || found.isDirectory) return null;
    return found.getData().toString('utf8');
  };

  // DRM check: only reject if actual content documents (.xhtml, .html) are
  // encrypted. Font obfuscation (IDPF / Adobe algorithm for .ttf/.otf fonts)
  // also creates an encryption.xml file, but does not block reading prose.
  const encryptionXml = readText('META-INF/encryption.xml');
  if (encryptionXml !== null) {
    try {
      const parsed = xml.parse(encryptionXml) as Record<string, unknown>;
      const enc = (parsed['encryption'] ?? parsed) as Record<string, unknown>;
      const encryptedData = asArray(enc['EncryptedData'] as unknown[]);
      const hasEncryptedText = encryptedData.some(item => {
        const obj = item as Record<string, unknown>;
        const cipherData = (obj['CipherData'] ?? {}) as Record<string, unknown>;
        const ref = (cipherData['CipherReference'] ?? {}) as Record<string, unknown>;
        const uri = String(ref['@URI'] ?? '').toLowerCase();
        return uri.endsWith('.xhtml') || uri.endsWith('.html') || uri.endsWith('.htm');
      });
      if (hasEncryptedText) {
        throw new Error('EPUB protegido por DRM — o conteúdo do texto está cifrado');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('DRM')) throw err;
    }
  }

  const containerXml = readText('META-INF/container.xml');
  if (!containerXml) throw new Error('EPUB sem META-INF/container.xml');
  const container = xml.parse(containerXml) as Record<string, unknown>;
  const containerRoot = (container['container'] ?? container) as Record<string, unknown>;
  const rootfiles = asArray(
    ((containerRoot['rootfiles'] ?? {}) as Record<string, unknown>)['rootfile'] as unknown[],
  );
  const first = rootfiles[0] as Record<string, unknown> | undefined;
  const opfPath = typeof first?.['@full-path'] === 'string' ? first['@full-path'] : '';
  if (!opfPath) throw new Error('EPUB sem rootfile no container.xml');

  const opfXml = readText(opfPath);
  if (!opfXml) throw new Error(`EPUB sem pacote em ${opfPath}`);
  const parsed = xml.parse(opfXml) as Record<string, unknown>;
  const opf = (parsed['package'] ?? parsed) as Record<string, unknown>;
  const baseDir = dirname(opfPath);

  const metadata = (opf['metadata'] ?? {}) as Record<string, unknown>;
  const title = textOf(metadata['title']).trim() || basename(path, extname(path));
  const author = textOf(metadata['creator']).trim();
  const language = textOf(metadata['language']).trim() || 'pt-BR';

  const manifest = (opf['manifest'] ?? {}) as Record<string, unknown>;
  const items = new Map<string, EpubItem>();
  for (const raw of asArray(manifest['item'] as unknown[])) {
    const item = raw as Record<string, unknown>;
    const id = typeof item['@id'] === 'string' ? item['@id'] : '';
    const href = typeof item['@href'] === 'string' ? item['@href'] : '';
    if (!id || !href) continue;
    items.set(id, {
      id,
      href,
      type: typeof item['@media-type'] === 'string' ? item['@media-type'] : '',
      properties: typeof item['@properties'] === 'string' ? item['@properties'] : '',
    });
  }

  // Extract all images in zip to disk for GTK to display
  const imagesDir = join(workDir, `epub-images-${Date.now()}`);
  mkdirSync(imagesDir, { recursive: true });
  const imagePathsByZipName = new Map<string, string>();
  let coverImage: string | undefined;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (/\.(jpe?g|png|gif|webp|svg)$/i.test(name)) {
      const targetPath = join(imagesDir, basename(name));
      writeFileSync(targetPath, entry.getData());
      imagePathsByZipName.set(name, targetPath);
      imagePathsByZipName.set(basename(name), targetPath);
      if (/cover/i.test(name) && !coverImage) {
        coverImage = targetPath;
      }
    }
  }

  const spine = (opf['spine'] ?? {}) as Record<string, unknown>;
  const spineRefs = asArray(spine['itemref'] as unknown[])
    .map(raw => (raw as Record<string, unknown>)['@idref'])
    .filter((id): id is string => typeof id === 'string');

  // Table of contents: EPUB 3 nav document, else EPUB 2 NCX, else chapter headings.
  let nav: EpubNavEntry[] = [];
  const navItem = [...items.values()].find(item => item.properties.split(/\s+/).includes('nav'));
  if (navItem) {
    const navHtml = readText(resolveHref(baseDir, navItem.href));
    if (navHtml) nav = readEpubNav(navHtml);
  }
  if (nav.length === 0) {
    const ncxId = typeof spine['@toc'] === 'string' ? spine['@toc'] : '';
    const ncxItem = ncxId ? items.get(ncxId) : undefined;
    if (ncxItem) {
      const ncxXml = readText(resolveHref(baseDir, ncxItem.href));
      if (ncxXml) nav = readEpubNcx(ncxXml);
    }
  }

  const chapters: Chapter[] = [];
  const runs = new Map<string, readonly MarkupRun[]>();
  const text = new Map<string, string>();

  // Map both full href and bare path (without anchor)
  const navByHref = new Map<string, string>();
  for (const entry of nav) {
    const full = resolveHref(baseDir, entry.href);
    const bare = full.split('#')[0]!;
    if (!navByHref.has(full)) navByHref.set(full, entry.title);
    if (!navByHref.has(bare)) navByHref.set(bare, entry.title);
  }

  spineRefs.forEach((idref, index) => {
    const item = items.get(idref);
    if (!item) return;
    if (item.type && !item.type.includes('html')) return;
    const entryPath = resolveHref(baseDir, item.href);
    const html = readText(entryPath);
    if (html == null) return;

    const clean = html
      .replace(/<\?xml[^>]*\?>/gi, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '');

    const chapterId = `ch${index}`;
    const chapterTitle = determineChapterTitle(index, entryPath, clean, navByHref, coverImage);

    // Collect images embedded in this chapter
    const parsedHtml = parse(clean);
    const chapterImages: string[] = [];
    for (const img of parsedHtml.querySelectorAll('img, image')) {
      const src = img.getAttribute('src') || img.getAttribute('xlink:href') || '';
      if (!src) continue;
      const cleanSrc = src.split('#')[0]!;
      const resolved = resolveHref(dirname(entryPath), cleanSrc);
      const local = imagePathsByZipName.get(resolved) || imagePathsByZipName.get(basename(cleanSrc));
      if (local && !chapterImages.includes(local)) {
        chapterImages.push(local);
      }
    }
    // If this is the title/cover page and has no image yet, use the cover image
    if (chapterImages.length === 0 && (index === 0 || /titlepage|cover/i.test(entryPath)) && coverImage) {
      chapterImages.push(coverImage);
    }

    chapters.push({ id: chapterId, title: chapterTitle, images: chapterImages });

    const content = chapterRuns(clean);
    runs.set(chapterId, content);
    text.set(chapterId, runsToText(content));
  });

  if (chapters.length === 0) throw new Error('EPUB sem capítulos legíveis');

  return {
    title,
    author,
    language,
    chapters,
    runs,
    text,
    coverImage: coverImage ?? chapters[0]?.images[0],
    sourcePath: path,
    format: 'epub',
  };
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

async function loadPdf(path: string): Promise<BookDocument> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);

  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const standardFontDataUrl = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + sep;

  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    verbosity: 0,
  }).promise;

  const chapters: Chapter[] = [];
  const runs = new Map<string, readonly MarkupRun[]>();
  const text = new Map<string, string>();

  for (let page = 1; page <= doc.numPages; page++) {
    const pdfPage = await doc.getPage(page);
    const content = await pdfPage.getTextContent();
    const lines: string[] = [];
    let current = '';
    let lastY: number | null = null;

    for (const raw of content.items as PdfTextItem[]) {
      if (typeof raw.str !== 'string') continue;
      const y = raw.transform?.[5];
      if (lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > 1.5) {
        lines.push(current);
        current = '';
      }
      current += raw.str;
      if (raw.hasEOL) {
        lines.push(current);
        current = '';
      }
      if (typeof y === 'number') lastY = y;
    }
    if (current.length > 0) lines.push(current);

    const pageText = lines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
    if (pageText.length === 0) continue;

    const chapterId = `p${page}`;
    chapters.push({ id: chapterId, title: `Página ${page}`, images: [] });
    runs.set(chapterId, [{ text: pageText, tags: [] }]);
    text.set(chapterId, pageText);
  }

  if (chapters.length === 0) throw new Error('PDF sem camada de texto');

  const title = (doc.getMetadata?.() as { info?: { Title?: string } } | undefined)?.info?.Title ?? basename(path, extname(path));
  return {
    title: title.trim() || basename(path, extname(path)),
    author: '',
    language: 'pt-BR',
    chapters,
    runs,
    text,
    sourcePath: path,
    format: 'pdf',
  };
}

/** Load a book from disk, sniffing the format by extension. */
export async function loadBook(path: string): Promise<BookDocument> {
  const extension = extname(path).toLowerCase();
  if (extension === '.epub') return loadEpub(path);
  if (extension === '.pdf') return loadPdf(path);
  throw new Error(`Formato não suportado: ${extension || '(sem extensão)'}`);
}
