// nandomo · reader · XHTML → Pango markup + sentences.
//
// EPUB chapters are XHTML. GTK renders text with Pango markup, which is
// a much smaller language than HTML: no block elements, no CSS, almost
// no attributes. So the chapter is walked once and flattened into Pango
// tags.
//
// The walk produces *runs* — a piece of text plus the Pango tags that
// surround it. Both the display markup and the spoken text are built
// from the same runs, so a sentence offset in the text maps exactly onto
// the same characters in the markup. That is what makes the TTS
// highlight possible: the current sentence is re-emitted wrapped in a
// background span.

import { parse, type HTMLElement, type Node as HtmlNode } from 'node-html-parser';

export interface TagPair {
  readonly open: string;
  readonly close: string;
}

export interface MarkupRun {
  /** Raw text, not escaped. */
  readonly text: string;
  /** Pango tags open around this run, outermost first. */
  readonly tags: readonly TagPair[];
}

export interface ChapterContent {
  readonly runs: readonly MarkupRun[];
  /** Pango markup for the whole chapter. */
  readonly markup: string;
  /** Decoded plain text for the whole chapter. */
  readonly text: string;
}

/** Escape a text run so Pango treats it as literal text. */
export function escapePango(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SKIP = new Set(['script', 'style', 'head', 'meta', 'link', 'title', 'svg', 'nav']);

/** Elements whose text is not part of the reading flow. */
const DROP_TEXT = new Set(['figcaption', 'caption']);

const TAGS: Record<string, TagPair> = {
  b: { open: '<b>', close: '</b>' },
  strong: { open: '<b>', close: '</b>' },
  i: { open: '<i>', close: '</i>' },
  em: { open: '<i>', close: '</i>' },
  cite: { open: '<i>', close: '</i>' },
  u: { open: '<u>', close: '</u>' },
  s: { open: '<s>', close: '</s>' },
  strike: { open: '<s>', close: '</s>' },
  del: { open: '<s>', close: '</s>' },
  code: { open: '<tt>', close: '</tt>' },
  kbd: { open: '<tt>', close: '</tt>' },
  samp: { open: '<tt>', close: '</tt>' },
  tt: { open: '<tt>', close: '</tt>' },
  a: { open: '<span underline="single">', close: '</span>' },
  // Pango rejects `indent` on <span> and then drops the whole markup string,
  // which leaves the TextView empty. Blockquotes stay plain instead.
  blockquote: { open: '<i>', close: '</i>' },
  h1: { open: '<big><big><b>', close: '</b></big></big>' },
  h2: { open: '<big><b>', close: '</b></big>' },
  h3: { open: '<b>', close: '</b>' },
  h4: { open: '<b>', close: '</b>' },
  h5: { open: '<b>', close: '</b>' },
  h6: { open: '<b>', close: '</b>' },
};

const BLOCK = /^(p|div|section|article|header|footer|h[1-6]|ul|ol|dl|table|tr|blockquote|pre|figure|aside|main)$/;

interface WalkState {
  readonly runs: MarkupRun[];
  stack: TagPair[];
  /** Text ends with whitespace — the next run must not add another space. */
  space: boolean;
  /** Depth of `<pre>` — inside it whitespace is significant. */
  pre: number;
}

function pushRun(state: WalkState, raw: string): void {
  if (raw.length === 0) return;
  const text = state.pre > 0 ? raw : raw.replace(/\s+/g, ' ');
  if (text.length === 0) return;
  if (state.space && !text.startsWith(' ')) {
    state.runs.push({ text: ' ', tags: state.stack });
  }
  state.runs.push({ text, tags: state.stack });
  state.space = text.endsWith(' ');
}

function walk(node: HtmlNode, state: WalkState): void {
  if (node.nodeType === 3) {
    const raw = node.rawText ?? '';
    const tag = (node as unknown as { rawTagName?: string }).rawTagName?.toLowerCase() ?? '';
    pushRun(state, DROP_TEXT.has(tag) ? '' : raw);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as HTMLElement;
  const tag = el.rawTagName?.toLowerCase() ?? '';
  if (SKIP.has(tag)) return;

  if (tag === 'br') {
    state.runs.push({ text: '\n', tags: state.stack });
    state.space = true;
    return;
  }
  if (tag === 'hr') {
    state.runs.push({ text: '\n', tags: state.stack });
    state.space = true;
    return;
  }
  if (tag === 'img') {
    const alt = el.getAttribute('alt');
    if (alt) pushRun(state, `[${alt}] `);
    return;
  }

  const isBlock = BLOCK.test(tag);
  if (isBlock && state.runs.length > 0 && !state.space) {
    state.runs.push({ text: '\n', tags: state.stack });
    state.space = true;
  }
  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
    state.runs.push({ text: '\n', tags: state.stack });
    state.space = true;
  }
  if (tag === 'li') {
    state.runs.push({ text: '\n• ', tags: state.stack });
    state.space = false;
  }

  const pair = TAGS[tag];
  if (pair) state.stack = [...state.stack, pair];
  if (tag === 'pre') state.pre += 1;

  for (const child of el.childNodes) walk(child, state);

  if (tag === 'pre') state.pre -= 1;
  if (pair) state.stack = state.stack.slice(0, -1);

  if (isBlock) {
    state.runs.push({ text: '\n', tags: state.stack });
    state.space = true;
  }
}

/** Walk an XHTML chapter into runs. */
export function chapterRuns(html: string): MarkupRun[] {
  const root = parse(html, { comment: false, blockTextElements: { script: false, noscript: false, style: false, pre: true } });
  const state: WalkState = { runs: [], stack: [], space: true, pre: 0 };
  walk(root, state);
  return state.runs;
}

/** Build the Pango markup for a chapter, optionally highlighting a text range. */
export function runsToMarkup(runs: readonly MarkupRun[], highlight?: { start: number; end: number } | null): string {
  const out: string[] = [];
  let offset = 0;
  for (const run of runs) {
    const start = offset;
    const end = offset + run.text.length;
    offset = end;

    const opens = run.tags.map(tag => tag.open).join('');
    const closes = [...run.tags].reverse().map(tag => tag.close).join('');
    const overlapping = highlight && start < highlight.end && end > highlight.start;

    if (!overlapping) {
      out.push(opens + escapePango(run.text) + closes);
      continue;
    }
    // The run straddles the highlight boundary — split it.
    const cutStart = Math.max(0, highlight.start - start);
    const cutEnd = Math.min(run.text.length, highlight.end - start);
    out.push(opens + escapePango(run.text.slice(0, cutStart)));
    out.push('<span background="#E9AC45" foreground="#252321">' + escapePango(run.text.slice(cutStart, cutEnd)) + '</span>');
    out.push(escapePango(run.text.slice(cutEnd)) + closes);
  }
  return out.join('');
}

/** Build the plain spoken text for a chapter. */
export function runsToText(runs: readonly MarkupRun[]): string {
  return runs.map(run => run.text).join('');
}

/**
 * Cut a chapter into fixed-size pages, with the text range each one covers.
 *
 * GTK does not expose its text layout to the client, so page breaks cannot be
 * measured exactly. The estimate uses a fixed characters-per-page budget and
 * prefers to break at a paragraph boundary, which keeps the break points
 * deterministic and stable across re-renders.
 *
 * ponytail: approximate pagination (character budget, not measured layout) —
 * upgrade to a host-side layout probe if exact page breaks ever matter.
 */
export function paginateText(text: string, charsPerPage: number): Array<{ start: number; end: number }> {
  if (charsPerPage <= 0) return text.length ? [{ start: 0, end: text.length }] : [];
  const spans: Array<{ start: number; end: number }> = [];
  let pageStart = 0;
  while (pageStart < text.length) {
    const limit = pageStart + charsPerPage;
    if (limit >= text.length) {
      spans.push({ start: pageStart, end: text.length });
      break;
    }
    // Break at the last paragraph separator inside the budget.
    const breakAt = text.lastIndexOf('\n', limit);
    const pageEnd = breakAt > pageStart ? breakAt : limit;
    spans.push({ start: pageStart, end: pageEnd });
    pageStart = breakAt > pageStart ? breakAt + 1 : limit;
  }
  return spans;
}

/**
 * Markup for a slice of the chapter, keeping the original text offsets so
 * the narration highlight still lands on the right words.
 */
export function runsToMarkupRange(
  runs: readonly MarkupRun[],
  range: { start: number; end: number },
  highlight?: { start: number; end: number } | null,
): string {
  const out: string[] = [];
  let offset = 0;
  for (const run of runs) {
    const start = offset;
    const end = offset + run.text.length;
    offset = end;
    if (end <= range.start || start >= range.end) continue;

    const opens = run.tags.map(tag => tag.open).join('');
    const closes = [...run.tags].reverse().map(tag => tag.close).join('');
    const from = Math.max(start, range.start);
    const to = Math.min(end, range.end);
    const text = run.text.slice(from - start, to - start);
    const overlapping = highlight && from < highlight.end && to > highlight.start;

    if (!overlapping) {
      out.push(opens + escapePango(text) + closes);
      continue;
    }
    const cutStart = Math.max(0, highlight.start - from);
    const cutEnd = Math.min(text.length, highlight.end - from);
    out.push(opens + escapePango(text.slice(0, cutStart)));
    out.push('<span background="#E9AC45" foreground="#252321">' + escapePango(text.slice(cutStart, cutEnd)) + '</span>');
    out.push(escapePango(text.slice(cutEnd)) + closes);
  }
  return out.join('');
}

/** Walk a chapter and produce markup + text in one pass. */
export function renderChapter(html: string): ChapterContent {
  const runs = chapterRuns(html);
  return { runs, markup: runsToMarkup(runs), text: runsToText(runs) };
}

// ─── sentences ───────────────────────────────────────────────────────────────

export interface Sentence {
  readonly text: string;
  /** Offset into the chapter's plain text. */
  readonly start: number;
  readonly end: number;
}

// Abbreviations that end in a period but do not end a sentence.
const ABBREVIATIONS = new Set([
  'sr', 'sra', 'srta', 'dr', 'dra', 'drs', 'prof', 'profa', 'etc', 'p.ex', 'ex', 'vs',
  'nº', 'n°', 'no', 'pág', 'pag', 'vol', 'cap', 'fig', 'il', 'ref', 'art', 'p', 'pp',
  'jan', 'fev', 'mar', 'abr', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez', 'av', 'cf',
]);

/**
 * Split prose into sentences with their offsets.
 *
 * Deliberately simple: a period ends a sentence unless the token before
 * it is a known abbreviation or an initial. Locale-aware segmentation is
 * not worth a dependency here.
 */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;

    // Swallow a run of terminators and any closing quotes.
    let end = i + 1;
    while (end < text.length && /[.!?…]/.test(text[end]!)) end += 1;
    while (end < text.length && /["'»”’)\]]/.test(text[end]!)) end += 1;

    if (ch === '.' && end === i + 1) {
      const before = text.slice(Math.max(0, i - 12), i).toLowerCase();
      const token = before.match(/([\wº°]+)$/)?.[1] ?? '';
      if (ABBREVIATIONS.has(token)) continue;
      // A single capital letter before the period is an initial.
      if (/^[a-z]$/.test(token) && !/^\s+["'«(]?[A-ZÀ-Ý]/.test(text.slice(end))) continue;
      // Decimal number: 3.14
      if (/\d$/.test(before) && /^\s?\d/.test(text.slice(end))) continue;
    }

    const next = text.slice(end);
    if (next.length > 0 && !/^\s/.test(next)) continue;

    const trimmedStart = skipLeadingSpace(text, start);
    if (end > trimmedStart) {
      sentences.push({ text: text.slice(trimmedStart, end), start: trimmedStart, end });
    }
    start = end;
    i = end - 1;
  }
  const trimmedStart = skipLeadingSpace(text, start);
  if (text.length > trimmedStart) {
    sentences.push({ text: text.slice(trimmedStart), start: trimmedStart, end: text.length });
  }
  return sentences;
}

function skipLeadingSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}
