// nandomo · reader · application state.
//
// Everything the reader knows lives here: the open book, the reading
// settings, the narration state, and the library of recently opened books.
// The UI is a pure function of these signals, and the GTK target is only
// a renderer.
//
// Two rules keep the GTK bridge happy:
//
//   1. Values that change often (the narrated sentence, the font size)
//      are read inside *function props*, never during tree construction.
//
//   2. Structural signals (which chapter is open, library vs reader) are
//      read in the spec on purpose.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { computed, signal, type Computed, type Signal } from '@nandomo/core';
import { loadBook, type BookDocument } from './documents.js';
import { runsToMarkup, runsToMarkupRange, paginateText, splitSentences, type Sentence } from './markup.js';
import { piperEngine, playClip, stopPlayback, SYNTH_ABORTED, type SpeechVoice } from './speech.js';
import { t } from './i18n.js';

export type PageFilter = 'system' | 'dark' | 'light' | 'sepia';
/** Theme of the app chrome, independent of the book page theme. */
export type AppTheme = 'system' | 'light' | 'dark';
/** Scroll reads like a web page; pages reads like a book. */
export type ViewMode = 'reader' | 'library';
export type ReadingMode = 'scroll' | 'pages';

/** How long the slider must rest on a chapter before it loads. */
export const SEEK_SETTLE_MS = 150;

/**
 * Characters that fit on one A4 page at the current font size.
 *
 * A4 at 96dpi is 794x1123px; the reading area keeps 54px margins, so the text
 * column is ~686px wide and ~980px tall. At ~0.5em average glyph width that
 * is ~76 characters per line and ~27 lines per page.
 *
 * ponytail: estimated from font metrics, not measured by GTK — the host does
 * not expose its text layout, so exact page breaks would need a host change.
 */
export function charsPerPage(
  fontSize: number,
  lineHeight: number,
  columns: 1 | 2 = 1,
  view: { width: number; height: number } = { width: 1180, height: 820 },
  sidebar = true,
): number {
  // Page box = window minus the chrome around it: topbar (~56) + transport
  // footer (~110) + spread/frame/page paddings (~120); horizontally the
  // sidebar (260) and the spread + text margins.
  const height = Math.max(240, view.height - 290);
  const usable = Math.max(320, view.width - (sidebar ? 260 : 0) - 60);
  const columnWidth = Math.max(240, (columns === 2 ? (usable - 20) / 2 : usable) - 88);
  // ~0.48em average glyph width for book serifs; 0.94 keeps a safety margin
  // because a page that overflows hides text, while a short one only wastes space.
  const perLine = Math.max(20, Math.floor(columnWidth / (fontSize * 0.48)));
  const lines = Math.max(6, Math.floor(height / (fontSize * lineHeight)));
  return Math.max(200, Math.floor(perLine * lines * 0.94));
}

export interface FontFamilyOption {
  readonly id: string;
  readonly label: string;
  readonly family: string;
}

export const FONT_OPTIONS: readonly FontFamilyOption[] = [
  { id: 'liberation', label: 'Editorial (estilo Anthropic / Tiempos)', family: 'Liberation Serif' },
  { id: 'dejavu', label: 'Livro Clássico (DejaVu Serif)', family: 'DejaVu Serif' },
  { id: 'dmsans', label: 'DM Sans (Moderna & Aconchegante)', family: 'DM Sans' },
  { id: 'nunito', label: 'Nunito (Arredondada & Afetiva)', family: 'Nunito' },
  { id: 'roman', label: 'Roman Tradicional (Nimbus Roman)', family: 'Nimbus Roman' },
];

export interface ReaderSettings {
  readonly filter: PageFilter;
  readonly theme: AppTheme;
  readonly fontId: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly pageWidth: number;
  readonly justify: boolean;
  readonly pageColumns?: 'auto' | 1 | 2;
  readonly readingMode?: ReadingMode;
  readonly voiceId?: string;
  readonly rate?: number;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  filter: 'system',
  theme: 'system',
  fontId: 'liberation',
  fontFamily: 'Liberation Serif',
  fontSize: 18,
  lineHeight: 1.6,
  pageWidth: 68,
  justify: true,
  pageColumns: 'auto',
  readingMode: 'scroll',
  voiceId: '',
  rate: 0,
};

export interface RecentBook {
  readonly path: string;
  readonly title: string;
  readonly author: string;
  readonly format: 'epub' | 'pdf';
  readonly openedAt: number;
  readonly lastChapterId?: string;
  readonly progressPercent?: number;
}

const RECENT_FILE = join(homedir(), '.config', 'nandomo-reader', 'recent.json');
const SETTINGS_FILE = join(homedir(), '.config', 'nandomo-reader', 'settings.json');

function loadRecentBooks(): RecentBook[] {
  try {
    if (!existsSync(RECENT_FILE)) return [];
    const text = readFileSync(RECENT_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentBooks(books: readonly RecentBook[]): void {
  try {
    mkdirSync(dirname(RECENT_FILE), { recursive: true });
    writeFileSync(RECENT_FILE, JSON.stringify(books.slice(0, 30), null, 2), 'utf8');
  } catch {
    // Non-critical persistence failure
  }
}

/** Reading preferences survive restarts; unknown keys fall back to the default. */
function loadSettings(base: ReaderSettings): ReaderSettings {
  try {
    if (!existsSync(SETTINGS_FILE)) return base;
    const stored = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as Partial<ReaderSettings>;
    return { ...base, ...stored };
  } catch {
    return base;
  }
}

function saveSettings(settings: ReaderSettings): void {
  try {
    mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // Non-critical persistence failure
  }
}

export interface ReaderState {
  readonly viewMode: Signal<ViewMode>;
  readonly readingMode: Signal<ReadingMode>;
  readonly book: Signal<BookDocument | null>;
  readonly chapterId: Signal<string | null>;
  readonly status: Signal<string>;
  readonly error: Signal<string | null>;
  readonly playing: Signal<boolean>;
  readonly sentenceIndex: Signal<number>;
  readonly voices: Signal<SpeechVoice[]>;
  readonly voiceId: Signal<string>;
  readonly rate: Signal<number>;
  readonly settings: Signal<ReaderSettings>;
  readonly sidebarOpen: Signal<boolean>;
  /** Window size reported by the host; drives pagination. */
  readonly viewport: Signal<{ width: number; height: number }>;
  /** Chapter start positions in percent of the book, for slider marks. */
  readonly chapterMarks: Computed<number[]>;
  readonly optionsOpen: Signal<boolean>;
  readonly recentBooks: Signal<RecentBook[]>;

  /** Sentences of the open chapter. */
  readonly sentences: Computed<Sentence[]>;
  /** Pango markup of the open chapter, with the narrated sentence marked. */
  readonly markup: Computed<string>;
  /** The sentence being narrated right now. */
  readonly currentSentence: Computed<string>;
  readonly currentSentenceOffset: Computed<number>;

  readonly currentChapterIndex: Computed<number>;
  readonly hasNextChapter: Computed<boolean>;
  readonly hasPreviousChapter: Computed<boolean>;
  readonly nextChapterTitle: Computed<string>;
  readonly readingProgress: Computed<number>;

  /** Page currently shown in pages mode (0-based). */
  readonly pageIndex: Signal<number>;
  /** Total pages of the current chapter in pages mode. */
  readonly pageCount: Computed<number>;
  readonly pageSpansCount: Computed<number>;
  /** Markup of the current page (pages mode) — empty in scroll mode. */
  readonly pageMarkup: Computed<string>;
  /** Markup of the right-hand page of the spread (empty when there is none). */
  readonly rightPageMarkup: Computed<string>;
  readonly effectivePageColumns: Computed<1 | 2>;

  open(path: string): Promise<void>;
  closeBook(): void;
  selectChapter(id: string): void;
  selectChapterByIndex(index: number): void;
  nextChapter(): void;
  previousChapter(): void;
  jumpToChar(charOffset: number, slotName?: string): void;
  play(): void;
  pause(): void;
  stop(): void;
  nextSentence(): void;
  previousSentence(): void;
  /** Jump to a reading percentage (0-100) — the slider's job. */
  /** Jump to a chapter checkpoint (0-based) from the progress slider. */
  /** Jump to a position in percent of the whole book (debounced). */
  seekTo(percent: number): void;
  jumpToSentence(index: number): void;
  goToPage(pageIdx: number): void;
  nextPage(): void;
  previousPage(): void;
  toggleReadingMode(): void;
  setVoice(voiceId: string): void;
  setRate(rate: number): void;
  update(patch: Partial<ReaderSettings>): void;
  setFont(fontId: string): void;
  toggleSidebar(): void;
  toggleOptions(): void;
  removeRecent(path: string): void;
  dispose(): void;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createReader(initialSettings: ReaderSettings = DEFAULT_SETTINGS): ReaderState {
  const stored = loadSettings(initialSettings);
  const viewMode = signal<ViewMode>('library');
  const readingMode = signal<ReadingMode>(stored.readingMode ?? 'scroll');
  const book = signal<BookDocument | null>(null);
  const chapterId = signal<string | null>(null);
  const status = signal(t('status.pickBook'));
  const error = signal<string | null>(null);
  const playing = signal(false);
  const sentenceIndex = signal(0);
  const pageIndex = signal(0);
  const voices = signal<SpeechVoice[]>([]);
  const voiceId = signal(stored.voiceId ?? '');
  const rate = signal(stored.rate ?? 0);
  const current = signal<ReaderSettings>(stored);
  const sidebarOpen = signal(true);
  const viewport = signal({ width: 1180, height: 820 });
  const optionsOpen = signal(false);
  const recentBooks = signal<RecentBook[]>(loadRecentBooks());

  const sentences = computed<Sentence[]>(() => {
    const doc = book();
    const id = chapterId();
    if (!doc || !id) return [];
    const text = doc.text.get(id) ?? '';
    return splitSentences(text);
  });

  const markup = computed<string>(() => {
    const doc = book();
    const id = chapterId();
    if (!doc || !id) return '';
    const runs = doc.runs.get(id) ?? [];
    const list = sentences();
    const index = sentenceIndex();
    const sentence = index >= 0 && index < list.length ? list[index] : undefined;
    return runsToMarkup(runs, sentence ? { start: sentence.start, end: sentence.end } : null);
  });

  const currentSentence = computed<string>(() => {
    const list = sentences();
    const index = sentenceIndex();
    return index >= 0 && index < list.length ? list[index]!.text : '';
  });

  const currentSentenceOffset = computed<number>(() => {
    const list = sentences();
    const index = sentenceIndex();
    if (index >= 0 && index < list.length) {
      return list[index]!.start;
    }
    return 0;
  });

  const currentChapterIndex = computed<number>(() => {
    const doc = book();
    const id = chapterId();
    if (!doc || !id) return -1;
    return doc.chapters.findIndex(c => c.id === id);
  });

  const hasNextChapter = computed<boolean>(() => {
    const doc = book();
    const idx = currentChapterIndex();
    if (!doc || idx < 0) return false;
    return idx < doc.chapters.length - 1;
  });

  const hasPreviousChapter = computed<boolean>(() => {
    const idx = currentChapterIndex();
    return idx > 0;
  });

  const nextChapterTitle = computed<string>(() => {
    const doc = book();
    const idx = currentChapterIndex();
    if (!doc || idx < 0 || idx >= doc.chapters.length - 1) return '';
    return doc.chapters[idx + 1]?.title ?? '';
  });

  /** Characters before each chapter; progress and seeking work in characters. */
  const chapterOffsets = computed<number[]>(() => {
    const doc = book();
    if (!doc) return [0];
    const offsets = [0];
    for (const ch of doc.chapters) offsets.push(offsets[offsets.length - 1]! + (doc.text.get(ch.id)?.length ?? 0));
    return offsets;
  });

  /** Reading position as a fraction (0..1) of the whole book's text. */
  const bookFraction = computed<number>(() => {
    const offsets = chapterOffsets();
    const total = offsets[offsets.length - 1] ?? 0;
    const idx = currentChapterIndex();
    if (total <= 0 || idx < 0) return 0;
    const sentence = sentences()[sentenceIndex()];
    return Math.min(1, ((offsets[idx] ?? 0) + (sentence?.start ?? 0)) / total);
  });

  const readingProgress = computed<number>(() => Math.round(bookFraction() * 100));

  const chapterMarks = computed<number[]>(() => {
    const offsets = chapterOffsets();
    const total = offsets[offsets.length - 1] ?? 0;
    if (total <= 0) return [];
    // A mark per chapter would be noise in huge books; keep chapters >= 0.5%.
    return offsets.slice(1, -1).map(o => (o / total) * 100).filter((p, i, all) => i === 0 || p - all[i - 1]! >= 0.5);
  });

  // ─── pages mode (Google Play Books style) ─────────────────────────────────

  const effectivePageColumns = computed<1 | 2>(() => {
    const pref = current().pageColumns ?? 'auto';
    if (pref === 1) return 1;
    if (pref === 2) return 2;
    // 'auto': se a barra lateral do sumário estiver aberta, usa 1 coluna
    // para não espremer o texto; se estiver fechada, usa 2 colunas!
    return sidebarOpen() ? 1 : 2;
  });

  /**
   * The chapter split into pages, with the text range each page covers. The
   * offsets keep the narration highlight aligned with the words on screen.
   */
  const pageSpans = computed<Array<{ start: number; end: number }>>(() => {
    const doc = book();
    const id = chapterId();
    if (!doc || !id) return [];
    const text = doc.text.get(id) ?? '';
    if (!text) return [];
    const cols = effectivePageColumns();
    const budget = charsPerPage(current().fontSize, current().lineHeight, cols, viewport(), sidebarOpen());
    return paginateText(text, budget);
  });

  const pageSpansCount = computed<number>(() => pageSpans().length);

  /** A spread shows two pages side by side when 2 columns, or 1 page when single column. */
  const pageCount = computed<number>(() => {
    const spans = pageSpans();
    if (spans.length === 0) return 0;
    return effectivePageColumns() === 2 ? Math.ceil(spans.length / 2) : spans.length;
  });

  const safePageIndex = computed<number>(() => {
    const count = pageCount();
    if (count <= 0) return 0;
    return Math.max(0, Math.min(pageIndex(), count - 1));
  });

  /** Markup of one page of the current spread, with the narration highlighted. */
  const markupForPage = (idx: number): string => {
    if (readingMode() !== 'pages') return '';
    const doc = book();
    const id = chapterId();
    if (!doc || !id) return '';
    const spans = pageSpans();
    if (spans.length === 0) return '';
    const safeIdx = Math.max(0, Math.min(idx, spans.length - 1));
    const span = spans[safeIdx];
    if (!span) return '';
    const list = sentences();
    const index = sentenceIndex();
    const sentence = index >= 0 && index < list.length ? list[index] : undefined;
    const highlight = sentence ? { start: sentence.start, end: sentence.end } : null;
    return runsToMarkupRange(doc.runs.get(id) ?? [], span, highlight);
  };

  const pageMarkup = computed<string>(() => {
    const pIdx = safePageIndex();
    const idx = effectivePageColumns() === 2 ? pIdx * 2 : pIdx;
    return markupForPage(idx);
  });

  /** Markup of the right-hand page of the current spread (empty when single column). */
  const rightPageMarkup = computed<string>(() => {
    if (effectivePageColumns() !== 2) return '';
    const pIdx = safePageIndex();
    const spans = pageSpans();
    if (pIdx * 2 + 1 >= spans.length) return '';
    return markupForPage(pIdx * 2 + 1);
  });

  function syncSentenceWithPage(): void {
    const spans = pageSpans();
    const pIdx = safePageIndex();
    const idx = effectivePageColumns() === 2 ? pIdx * 2 : pIdx;
    const span = spans[idx];
    if (!span) return;
    const list = sentences();
    const found = list.findIndex(s => s.start >= span.start);
    if (found >= 0) {
      sentenceIndex.set(found);
    }
  }

  function syncPageWithSentence(sentStart: number, always = false): void {
    if (!always && readingMode() !== 'pages') return;
    const spans = pageSpans();
    const spanIdx = spans.findIndex(s => sentStart >= s.start && sentStart < s.end);
    if (spanIdx >= 0) {
      const target = effectivePageColumns() === 2 ? Math.floor(spanIdx / 2) : spanIdx;
      if (target !== pageIndex()) {
        pageIndex.set(target);
      }
    }
  }

  /**
   * Switching the reading mode while the voice is playing must not leave the
   * narration pointing at the old layout. The audio stops and the voice
   * re-anchors on the new page/chapter.
   */
  function applyReadingMode(next: ReadingMode): void {
    if (readingMode() === next) return;
    const wasPlaying = playing();
    readingMode.set(next);
    pageIndex.set(0);
    update({ readingMode: next });
    if (wasPlaying) {
      generation += 1;
      stopPlayback();
      if (next === 'pages') syncSentenceWithPage();
      void narrate();
    }
  }

  function saveCurrentProgress(): void {
    const doc = book();
    if (!doc) return;
    const progress = readingProgress();
    const currentChap = chapterId() ?? undefined;
    const updated = recentBooks().map(b =>
      b.path === doc.sourcePath
        ? { ...b, lastChapterId: currentChap, progressPercent: progress, openedAt: Date.now() }
        : b,
    );
    recentBooks.set(updated);
    saveRecentBooks(updated);
  }

  // ─── narration ─────────────────────────────────────────────────────────────

  let generation = 0;

  async function speak(text: string): Promise<void> {
    const voice = voiceId();
    if (!voice) throw new Error(t('status.noEngine'));

    const clip = await piperEngine.synthesize(text, voice, rate());
    try {
      await playClip(clip);
    } finally {
      clip.dispose();
    }
    error.set(null);
  }

  async function narrate(): Promise<void> {
    const gen = ++generation;
    while (playing() && gen === generation) {
      const list = sentences();
      const index = sentenceIndex();
      if (index >= list.length) {
        // End of chapter: keep reading into the next one, like an audiobook.
        if (!hasNextChapter()) {
          playing.set(false);
          status.set(t('status.endOfBook'));
          break;
        }
        enterChapter(currentChapterIndex() + 1);
        continue;
      }
      const sentence = list[index]!;
      syncPageWithSentence(sentence.start);
      status.set(t('status.narrating', { current: index + 1, total: list.length }));
      try {
        await speak(sentence.text);
      } catch (cause) {
        const msg = errorText(cause);
        // The synthesis was killed on purpose (page/mode change). The caller
        // restarts the narration, so this loop just ends.
        if (msg === SYNTH_ABORTED) break;
        error.set(t('status.speechFailed', { message: msg }));
        setTimeout(() => {
          if (error()?.includes(msg)) error.set(null);
        }, 5000);
        playing.set(false);
        break;
      }
      if (gen !== generation) return;
      sentenceIndex.set(index + 1);
    }
  }

  // ─── actions ───────────────────────────────────────────────────────────────

  async function open(path: string): Promise<void> {
    error.set(null);
    status.set(t('status.opening', { path }));
    try {
      const doc = await loadBook(path);
      book.set(doc);
      // If user read this book before, restore the last chapter; otherwise find first chapter with prose
      const existingRecent = recentBooks().find(b => b.path === doc.sourcePath);
      const savedChapter = existingRecent?.lastChapterId ? doc.chapters.find(c => c.id === existingRecent.lastChapterId) : undefined;
      const first = savedChapter ?? doc.chapters.find(ch => (doc.text.get(ch.id)?.length ?? 0) > 400) ?? doc.chapters[0];
      chapterId.set(first?.id ?? null);
      sentenceIndex.set(0);
      viewMode.set('reader');

      const chapters = t(doc.chapters.length === 1 ? 'reader.chapterCount' : 'reader.chaptersCount', { count: doc.chapters.length });
      status.set(t('status.bookLoaded', { title: doc.title, chapters }));

      // Add to recent books
      const existing = recentBooks().find(b => b.path === doc.sourcePath);
      const updated = [
        {
          path: doc.sourcePath,
          title: doc.title,
          author: doc.author,
          format: doc.format,
          openedAt: Date.now(),
          lastChapterId: chapterId() ?? undefined,
          progressPercent: existing?.progressPercent ?? 0,
        },
        ...recentBooks().filter(b => b.path !== doc.sourcePath),
      ];
      recentBooks.set(updated);
      saveRecentBooks(updated);
    } catch (cause) {
      error.set(errorText(cause));
      status.set(t('status.cannotOpen'));
    }
  }

  function closeBook(): void {
    stop();
    book.set(null);
    chapterId.set(null);
    viewMode.set('library');
    status.set(t('status.library'));
  }

  function selectChapter(id: string): void {
    if (chapterId() === id) return;
    stop();
    chapterId.set(id);
    sentenceIndex.set(0);
    pageIndex.set(0);
    saveCurrentProgress();
  }

  /** Move to a chapter without stopping the narration loop. */
  function enterChapter(index: number): void {
    const chapter = book()?.chapters[index];
    if (!chapter) return;
    chapterId.set(chapter.id);
    sentenceIndex.set(0);
    pageIndex.set(0);
    saveCurrentProgress();
  }

  function nextChapter(): void {
    const doc = book();
    const idx = currentChapterIndex();
    if (!doc || idx < 0 || idx >= doc.chapters.length - 1) return;
    selectChapterByIndex(idx + 1);
  }

  function previousChapter(): void {
    const idx = currentChapterIndex();
    if (idx <= 0) return;
    selectChapterByIndex(idx - 1);
  }

  function selectChapterByIndex(index: number): void {
    const doc = book();
    if (!doc) return;
    const chapter = doc.chapters[index];
    if (chapter) selectChapter(chapter.id);
  }

  function jumpToChar(charOffset: number, slotName = ''): void {
    let absoluteOffset = charOffset;

    if (readingMode() === 'pages') {
      const spans = pageSpans();
      const pIdx = safePageIndex();
      const pageNum = slotName === 'page-right' ? pIdx * 2 + 1 : (effectivePageColumns() === 2 ? pIdx * 2 : pIdx);
      const span = spans[pageNum];
      if (span) {
        absoluteOffset = span.start + charOffset;
      }
    }

    const list = sentences();
    const target = list.findIndex(s => s.start <= absoluteOffset && absoluteOffset <= s.end);
    if (target >= 0) {
      stopPlayback();
      sentenceIndex.set(target);
      saveCurrentProgress();
      if (playing()) {
        generation += 1;
        void narrate();
      }
    }
  }

  function play(): void {
    if (!book()) return;
    if (readingMode() === 'pages') {
      // Inicia a leitura a partir da página atualmente visível na tela
      const spans = pageSpans();
      const pIdx = safePageIndex();
      const pageNum = effectivePageColumns() === 2 ? pIdx * 2 : pIdx;
      const span = spans[pageNum];
      if (span) {
        const list = sentences();
        const curSentence = list[sentenceIndex()];
        // Se a frase atual estiver fora do span da página visível, ajusta para a primeira frase dela
        if (!curSentence || curSentence.start < span.start || curSentence.start >= span.end) {
          const firstInPage = list.findIndex(s => s.start >= span.start);
          if (firstInPage >= 0) {
            sentenceIndex.set(firstInPage);
          }
        }
      }
    } else {
      if (sentenceIndex() >= sentences().length) sentenceIndex.set(0);
    }
    error.set(null);
    playing.set(true);
    void narrate();
  }

  function pause(): void {
    stopPlayback();
    playing.set(false);
    saveCurrentProgress();
    generation += 1;
  }

  function stop(): void {
    stopPlayback();
    playing.set(false);
    saveCurrentProgress();
    generation += 1;
    sentenceIndex.set(0);
  }

  function nextSentence(): void {
    stopPlayback();
    const list = sentences();
    const next = Math.min(sentenceIndex() + 1, list.length - 1);
    sentenceIndex.set(next);
    saveCurrentProgress();
    if (playing()) {
      generation += 1;
      void narrate();
    }
  }

  function previousSentence(): void {
    stopPlayback();
    const previous = Math.max(0, sentenceIndex() - 1);
    sentenceIndex.set(previous);
    saveCurrentProgress();
    if (playing()) {
      generation += 1;
      void narrate();
    }
  }

  function update(patch: Partial<ReaderSettings>): void {
    const next = { ...current(), ...patch };
    current.set(next);
    saveSettings(next);
  }

  /**
   * The progress slider moves freely over the whole book (in percent of its
   * text). Dragging emits many values; only the one the hand rests on loads,
   * so the reading surface is rebuilt once per seek instead of once per pixel.
   */
  let seekTimer: ReturnType<typeof setTimeout> | null = null;

  function seekTo(percent: number): void {
    if (!book()) return;
    if (seekTimer) clearTimeout(seekTimer);
    seekTimer = setTimeout(() => {
      seekTimer = null;
      const offsets = chapterOffsets();
      const total = offsets[offsets.length - 1] ?? 0;
      if (total <= 0) return;
      const target = (Math.min(100, Math.max(0, percent)) / 100) * total;
      let index = offsets.findIndex((o, i) => i > 0 && o > target) - 1;
      if (index < 0) index = offsets.length - 2;
      const chapter = book()?.chapters[index];
      if (!chapter) return;
      const wasPlaying = playing();
      if (chapterId() !== chapter.id) {
        stopPlayback();
        generation += 1;
        chapterId.set(chapter.id);
      }
      const within = target - (offsets[index] ?? 0);
      const list = sentences();
      const found = list.findIndex(s => s.end > within);
      sentenceIndex.set(found >= 0 ? found : Math.max(0, list.length - 1));
      syncPageWithSentence(list[sentenceIndex()]?.start ?? 0, true);
      saveCurrentProgress();
      if (wasPlaying) {
        generation += 1;
        void narrate();
      }
    }, SEEK_SETTLE_MS);
  }

  /**
   * Move the narration to the given page and keeps the voice in sync with it.
   * The audio is stopped first, otherwise the voice keeps reading the old
   * sentence while the screen already shows the new page.
   */
  function moveToPage(pageIdx: number): void {
    const total = pageCount();
    if (total === 0) return;
    const target = Math.max(0, Math.min(pageIdx, total - 1));
    if (target === pageIndex()) return;
    pageIndex.set(target);
    syncSentenceWithPage();
    saveCurrentProgress();
    // Re-anchor the voice on the page the reader is now looking at.
    if (playing()) {
      // Order matters: the generation bump ends the old loop, then the audio
      // stops, then the new loop starts on the new page.
      generation += 1;
      stopPlayback();
      void narrate();
    }
  }

  function nextPage(): void {
    const total = pageCount();
    if (pageIndex() < total - 1) {
      moveToPage(pageIndex() + 1);
      return;
    }
    // Chegou ao fim do capítulo atual: passa para o próximo capítulo suavemente!
    if (hasNextChapter()) {
      nextChapter();
      pageIndex.set(0);
      saveCurrentProgress();
      if (playing()) {
        stopPlayback();
        generation += 1;
        void narrate();
      }
    }
  }

  function previousPage(): void {
    if (pageIndex() > 0) {
      moveToPage(pageIndex() - 1);
      return;
    }
    // Chegou ao início do capítulo atual: volta para o capítulo anterior!
    if (hasPreviousChapter()) {
      previousChapter();
      const total = pageCount();
      moveToPage(Math.max(0, total - 1));
    }
  }

  function jumpToSentence(index: number): void {
    const list = sentences();
    if (list.length === 0) return;
    const target = Math.max(0, Math.min(index, list.length - 1));
    stopPlayback();
    sentenceIndex.set(target);
    saveCurrentProgress();
    if (playing()) {
      generation += 1;
      void narrate();
    }
  }

  function goToPage(pageIdx: number): void {
    moveToPage(pageIdx);
  }

  function setVoice(id: string): void {
    voiceId.set(id);
    update({ voiceId: id });
  }

  function setRate(r: number): void {
    rate.set(r);
    update({ rate: r });
  }

  function toggleReadingMode(): void {
    applyReadingMode(readingMode() === 'pages' ? 'scroll' : 'pages');
  }

  function setFont(fontId: string): void {
    const option = FONT_OPTIONS.find(f => f.id === fontId);
    if (option) {
      current.set({ ...current(), fontId: option.id, fontFamily: option.family });
    }
  }

  function toggleSidebar(): void {
    const list = sentences();
    const sIdx = sentenceIndex();
    const curStart = sIdx >= 0 && sIdx < list.length ? list[sIdx]!.start : null;

    sidebarOpen.set(!sidebarOpen());

    // Se houver sentença lida, sincroniza a página imediatamente para o novo layout de colunas
    if (curStart !== null) {
      syncPageWithSentence(curStart, true);
    } else {
      const count = pageCount();
      if (pageIndex() >= count) {
        pageIndex.set(Math.max(0, count - 1));
      }
    }
  }

  function toggleOptions(): void {
    optionsOpen.set(!optionsOpen());
  }

  function removeRecent(path: string): void {
    const updated = recentBooks().filter(b => b.path !== path);
    recentBooks.set(updated);
    saveRecentBooks(updated);
  }

  function dispose(): void {
    if (seekTimer) clearTimeout(seekTimer);
    stopPlayback();
    playing.set(false);
    saveCurrentProgress();
    generation += 1;
  }

  return {
    viewMode,
    readingMode,
    book,
    chapterId,
    status,
    error,
    playing,
    sentenceIndex,
    voices,
    voiceId,
    rate,
    settings: current,
    sidebarOpen,
    optionsOpen,
    recentBooks,
    currentChapterIndex,
    hasNextChapter,
    hasPreviousChapter,
    nextChapterTitle,
    readingProgress,
    pageIndex,
    pageCount,
    pageSpansCount,
    pageMarkup,
    rightPageMarkup,
    effectivePageColumns,
    viewport,
    chapterMarks,
    sentences,
    markup,
    currentSentence,
    currentSentenceOffset,
    open,
    closeBook,
    selectChapter,
    selectChapterByIndex,
    nextChapter,
    previousChapter,
    jumpToChar,
    play,
    pause,
    stop,
    nextSentence,
    previousSentence,
    seekTo,
    jumpToSentence,
    goToPage,
    nextPage,
    previousPage,
    toggleReadingMode,
    setVoice,
    setRate,
    update,
    setFont,
    toggleSidebar,
    toggleOptions,
    removeRecent,
    dispose,
  };
}
