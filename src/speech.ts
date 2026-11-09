// nandomo · reader · speech.
//
// One engine: local neural TTS (rhasspy/piper). Offline, free, MIT engine.
//
// Piper is the only engine: the reader never talks to a remote service and
// never needs an API key. Voices live on disk as `<lang>_<name>-<quality>.onnx`
// and are grouped by language in the voice picker.
//
// Playback is a separate concern: the reader needs to know when a
// sentence finished so it can advance the highlight, and no system player
// reports word timings. The player is therefore a child process we wait
// on.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SpeechVoice {
  readonly id: string;
  readonly label: string;
  readonly lang: string;
  readonly engine: 'piper';
}

export interface SpeechClip {
  readonly path: string;
  readonly format: 'wav';
  dispose(): void;
}

export interface SpeechEngine {
  readonly id: 'piper';
  readonly label: string;
  readonly available: boolean;
  listVoices(): Promise<SpeechVoice[]>;
  synthesize(text: string, voice: string, rate?: number): Promise<SpeechClip>;
}

export const workDir = mkdtempSync(join(tmpdir(), 'nandomo-reader-'));

function which(binary: string): string | null {
  const probe = spawnSync('sh', ['-lc', `command -v ${binary}`], { encoding: 'utf8' });
  const found = probe.stdout.trim();
  return found.length > 0 ? found : null;
}

// ─── Piper ───────────────────────────────────────────────────────────────────

/** Where the piper binary and its voices live. */
function piperPaths(): { binary: string; voices: string } | null {
  const binary = process.env['PIPER_BIN'] ?? which('piper');
  if (!binary) return null;
  const voices = process.env['PIPER_VOICES'] ?? join(process.env['HOME'] ?? '/tmp', '.local', 'share', 'piper-voices');
  return { binary, voices };
}

/**
 * `pt_BR-faber-medium.onnx` → lang `pt-BR`, label `Faber`.
 * Piper names voices `<lang>_<REGION>-<name>-<quality>`.
 */
function describeVoice(file: string): { id: string; label: string; lang: string } {
  const id = file.replace(/\.onnx$/, '');
  const parts = id.split(/[-_]/);
  const language = (parts[0] ?? '').toLowerCase();
  const region = parts[1] ?? '';
  // `pt_BR-faber` has a region; `pt-faber` does not.
  const hasRegion = /^[A-Z]{2}$/.test(region);
  const lang = hasRegion ? `${language}-${region}` : language;
  const name = hasRegion ? (parts[2] ?? '') : region;
  if (!language || !name) return { id, label: id, lang: id };
  return { id, label: name.charAt(0).toUpperCase() + name.slice(1), lang };
}

export const piperEngine: SpeechEngine = {
  id: 'piper',
  label: 'Piper (offline)',
  available: piperPaths() !== null,
  async listVoices() {
    const paths = piperPaths();
    if (!paths) return [];
    if (!existsSync(paths.voices)) return [];
    const voices: SpeechVoice[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 3) return;
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        if (entry.endsWith('.onnx')) {
          const described = describeVoice(entry);
          voices.push({ ...described, id: full, engine: 'piper' });
        } else if (!entry.includes('.')) {
          walk(full, depth + 1);
        }
      }
    };
    walk(paths.voices, 0);
    // Same language first, then alphabetical: the picker groups by language.
    return voices.sort((a, b) => a.lang.localeCompare(b.lang) || a.label.localeCompare(b.label));
  },
  async synthesize(text: string, voice: string, rate = 0): Promise<SpeechClip> {
    const paths = piperPaths();
    if (!paths) throw new Error('Piper não encontrado (defina PIPER_BIN)');
    const model = voice.endsWith('.onnx') ? voice : join(paths.voices, `${voice}.onnx`);
    if (!existsSync(model)) throw new Error(`Modelo do Piper não encontrado: ${model}`);
    const path = join(workDir, `piper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);

    // Piper's length_scale is inverse to speed: 1.0 is natural, below 1.0 is
    // faster. Map the -50..+100% slider onto a sane 0.6..1.4 range.
    const lengthScale = (1 - Math.max(-50, Math.min(100, rate)) / 400).toFixed(3);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(paths.binary, ['-m', model, '-f', path, '--length_scale', lengthScale], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      // Track the synthesis so stopPlayback() can free its CPU.
      activeSynth = child;
      synthAborted = false;
      let stderr = '';
      child.stderr?.on('data', chunk => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', code => {
        if (activeSynth === child) activeSynth = null;
        if (synthAborted) {
          reject(new Error(SYNTH_ABORTED));
          return;
        }
        if (code === 0 && existsSync(path)) resolve();
        else reject(new Error(`Piper falhou (código ${code}): ${stderr.trim().slice(-400)}`));
      });
      child.stdin.write(text);
      child.stdin.end();
    });

    return {
      path,
      format: 'wav',
      dispose() {
        rmSync(path, { force: true });
      },
    };
  },
};

// ─── playback ────────────────────────────────────────────────────────────────

interface Player {
  readonly name: string;
  run(path: string): Promise<void>;
}

const PLAYERS: readonly Player[] = [
  {
    name: 'ffplay',
    run(path) {
      return runProcess('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', path]);
    },
  },
  {
    name: 'mpv',
    run(path) {
      return runProcess('mpv', ['--no-video', '--really-quiet', path]);
    },
  },
  {
    name: 'mpg123',
    run(path) {
      return runProcess('mpg123', ['-q', path]);
    },
  },
  {
    name: 'paplay',
    run(path) {
      return runProcess('paplay', [path]);
    },
  },
];

import type { ChildProcess } from 'node:child_process';

let activeChild: ChildProcess | null = null;
/** The running Piper process — killing it frees the CPU that caused the lag. */
let activeSynth: ChildProcess | null = null;
/** Set when the user stops the narration, so a killed synthesis is not an error. */
let synthAborted = false;

/** Stop any currently-playing audio process immediately. */
export function stopPlayback(): void {
  if (activeChild) {
    try {
      activeChild.kill('SIGKILL');
    } catch {}
    activeChild = null;
  }
  if (activeSynth) {
    synthAborted = true;
    try {
      activeSynth.kill('SIGKILL');
    } catch {}
    activeSynth = null;
  }
}

function runProcess(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    stopPlayback();
    const child = spawn(binary, args, { stdio: 'ignore' });
    activeChild = child;
    child.on('error', (err) => {
      if (activeChild === child) activeChild = null;
      reject(err);
    });
    child.on('close', () => {
      if (activeChild === child) activeChild = null;
      resolve();
    });
  });
}

let cachedPlayer: Player | null | undefined;

/** Marker for a synthesis the user stopped on purpose. */
export const SYNTH_ABORTED = 'nandomo:synthesis-aborted';

/** Test seam: replace the system player (null restores detection). */
export function setPlayerForTests(player: Player | null): void {
  cachedPlayer = player ?? undefined;
}

/** First available system player. */
export function findPlayer(): Player | null {
  if (cachedPlayer !== undefined) return cachedPlayer;
  cachedPlayer = PLAYERS.find(player => which(player.name) !== null) ?? null;
  return cachedPlayer;
}

/** Play a clip and resolve when it finishes. */
export async function playClip(clip: SpeechClip): Promise<void> {
  const player = findPlayer();
  if (!player) throw new Error('Nenhum player de áudio encontrado (ffplay, mpv, mpg123, paplay)');
  await player.run(clip.path);
}

export function disposeWorkDir(): void {
  rmSync(workDir, { recursive: true, force: true });
}
