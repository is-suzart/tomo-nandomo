// nandomo · reader · bocchi design system & appearance.
//
// Identidade visual oficial da marca bocchi (/home/savunma/Code/bocchi/marca):
//   • Preto suave: #252321 (texto, estrutura, modo escuro acolhedor)
//   • Creme:       #FFF9F0 (papel de leitura, respiro e aconchego)
//   • Coral:       #F78175 (afeto, destaque primário, botão de reprodução)
//   • Dourado:     #E9AC45 (descoberta, estrelas, highlight da narração)
//
// Tipografia:
//   • Nunito (800, 900)  -> Títulos, logos, botões e chamadas
//   • DM Sans (400, 600) -> Texto de interface, navegação e leitura limpa

import type { AppTheme, PageFilter, ReaderSettings } from './model.js';

export const BOCCHI = {
  preto: '#252321',
  creme: '#FFF9F0',
  coral: '#F78175',
  dourado: '#E9AC45',
  cremeCard: '#FAF2E6',
  cremeProfundo: '#F3E7D6',
  pretoCard: '#2F2C29',
  textoSecundario: '#57524E',
  coralSuave: 'rgba(247, 129, 117, 0.16)',
  douradoSuave: 'rgba(233, 172, 69, 0.20)',
} as const;

export interface PageColors {
  readonly bg: string;
  readonly fg: string;
  readonly muted: string;
}

const PAGES: Record<PageFilter, PageColors> = {
  system: { bg: '@theme_base_color', fg: '@theme_text_color', muted: 'alpha(@theme_text_color, 0.55)' },
  dark: { bg: '#252321', fg: '#FFF9F0', muted: '#A8A29E' }, // Noite Suave da Bocchi
  light: { bg: '#FFF9F0', fg: '#252321', muted: '#78716C' }, // Creme Aconchegante Oficial Bocchi
  sepia: { bg: '#F3E7D6', fg: '#3E3935', muted: '#857A70' }, // Papel Antigo Bocchi
};

export function pageColors(filter: PageFilter): PageColors {
  return PAGES[filter] ?? PAGES.system;
}

/**
 * Colors of the app chrome. The app theme is the user's choice (light/dark),
 * not the desktop's: the reader is a full-screen reading surface.
 */
export function chrome(theme: AppTheme): PageColors {
  if (theme === 'light') return { bg: '#FFF9F0', fg: '#252321', muted: '#78716C' };
  if (theme === 'dark') return { bg: '#252321', fg: '#FFF9F0', muted: '#A8A29E' };
  return { bg: '@theme_bg_color', fg: '@theme_fg_color', muted: 'alpha(@theme_fg_color, 0.55)' };
}

/** GTK stylesheet for the reader shell with Bocchi brand identity. */
export function gtkStyles(settings: ReaderSettings): string {
  const page = pageColors(settings.filter);
  const family = settings.fontFamily.includes(' ') ? `"${settings.fontFamily}"` : settings.fontFamily;
  return `
/* ── Bocchi Reader Global Styles ── */
window.reader {
  background-color: ${chrome(settings.theme).bg};
  color: ${chrome(settings.theme).fg};
  font-family: 'DM Sans', -apple-system, sans-serif;
}
.reader-root {
  background-color: ${chrome(settings.theme).bg};
  color: ${chrome(settings.theme).fg};
  font-family: 'DM Sans', -apple-system, sans-serif;
}

/* ── Topbar ── */
.reader-topbar {
  background-color: ${chrome(settings.theme).bg};
  padding: 6px 14px;
  border-bottom: 1px solid alpha(${chrome(settings.theme).fg}, 0.08);
  min-height: 48px;
}
.tomo-brand-badge-top,
.tomo-brand-btn {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 0.95em;
  color: #F78175;
  padding: 3px 12px;
  border-radius: 999px;
  background-color: alpha(#F78175, 0.12);
  border: 1px solid alpha(#F78175, 0.25);
}
.tomo-brand-btn:hover {
  background-color: alpha(#F78175, 0.22);
  border-color: #F78175;
}
.reader-topbar-center {
  padding: 0 16px;
}
.reader-title {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 1.05em;
  letter-spacing: -0.01em;
}
.reader-subtitle {
  color: alpha(${chrome(settings.theme).fg}, 0.55);
  font-size: 0.84em;
  font-family: 'DM Sans', sans-serif;
}

/* ── Sidebar (Sumário) ── */
.reader-sidebar {
  background-color: alpha(${chrome(settings.theme).fg}, 0.02);
  padding: 12px 8px;
  border-right: 1px solid alpha(${chrome(settings.theme).fg}, 0.08);
}
.reader-sidebar-title {
  font-family: 'Nunito', sans-serif;
  font-size: 0.72em;
  font-weight: 900;
  letter-spacing: 0.12em;
  color: alpha(${chrome(settings.theme).fg}, 0.45);
  padding: 0 10px 8px 10px;
}
.reader-chapter {
  padding: 8px 12px;
  border-radius: 10px;
  border: none;
  background-color: transparent;
  color: ${chrome(settings.theme).fg};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.92em;
  min-height: 32px;
}
.reader-chapter:hover {
  background-color: alpha(${chrome(settings.theme).fg}, 0.07);
}
.reader-chapter.is-active {
  background-color: alpha(#F78175, 0.16);
  color: #F78175;
  font-weight: 700;
}

/* ── Reading Surface ── */
.reader-surface {
  background-color: ${page.bg};
}
.reader-page {
  background-color: ${page.bg};
  color: ${page.fg};
  font-family: ${family};
  font-size: ${settings.fontSize}px;
  padding: 32px 0 32px 0;
}
/* Modo páginas estilo Google Play Books: folha elegante e contida */
.reader-spread-scroll {
  background-color: alpha(${chrome(settings.theme).fg}, 0.03);
}
.reader-spread {
  padding: 16px 20px;
}
.reader-page-frame {
  background-color: ${page.bg};
  border-radius: 8px;
  box-shadow: 0 4px 24px alpha(#000000, 0.22);
  border: 1px solid alpha(${chrome(settings.theme).fg}, 0.08);
}
.reader-page-fixed {
  padding: 24px 0 10px 0;
  background-color: ${page.bg};
}
.reader-page-footer {
  padding: 6px 36px 14px 36px;
  border-top: 1px solid alpha(${chrome(settings.theme).fg}, 0.06);
}
.reader-page-num {
  font-size: 0.78em;
  color: alpha(${page.fg}, 0.45);
  font-family: 'DM Sans', sans-serif;
  font-weight: 500;
}
.reader-image-frame {
  margin: 16px 0;
  padding: 0;
}
.reader-next-card {
  margin: 28px 54px 48px 54px;
  padding: 18px 24px;
  border-radius: 16px;
  background-color: alpha(${chrome(settings.theme).fg}, 0.04);
  border: 1px solid alpha(${chrome(settings.theme).fg}, 0.1);
}
.reader-next-card:hover {
  background-color: alpha(#F78175, 0.08);
  border-color: alpha(#F78175, 0.3);
}
.reader-next-label {
  font-family: 'Nunito', sans-serif;
  font-size: 0.76em;
  font-weight: 900;
  letter-spacing: 0.1em;
  color: #F78175;
  text-transform: uppercase;
}
.reader-next-title {
  font-family: 'Nunito', sans-serif;
  font-size: 1.15em;
  font-weight: 800;
  margin-top: 4px;
}

/* ── Transport Footer (Altura fixa e botões pílula táteis da Bocchi) ── */
.reader-transport-wrap {
  background-color: ${chrome(settings.theme).bg};
  border-top: 1px solid alpha(${chrome(settings.theme).fg}, 0.08);
  padding: 4px 16px 6px 16px;
}
.reader-progress-row {
  padding: 2px 0;
}
.reader-progress-row slider {
  min-height: 18px;
}
.reader-transport {
  background-color: ${chrome(settings.theme).bg};
  min-height: 48px;
}
.reader-button {
  min-height: 34px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid alpha(${chrome(settings.theme).fg}, 0.16);
  background-color: transparent;
  color: ${chrome(settings.theme).fg};
  font-family: 'DM Sans', sans-serif;
  font-weight: 600;
  font-size: 0.9em;
}
.reader-button:hover {
  background-color: alpha(${chrome(settings.theme).fg}, 0.06);
  border-color: alpha(${chrome(settings.theme).fg}, 0.35);
}
.reader-button.is-active {
  background-color: alpha(#F78175, 0.16);
  border-color: #F78175;
  color: #F78175;
  font-weight: 700;
}

/* Botão de Play / Destaque com o Coral oficial da Bocchi */
.reader-primary {
  background-color: #F78175;
  color: #FFF9F0;
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  border: none;
  box-shadow: 0 2px 8px alpha(#F78175, 0.35);
}
.reader-primary:hover {
  background-color: #f86f62;
  box-shadow: 0 4px 12px alpha(#F78175, 0.45);
}

.reader-nav-step {
  min-width: 34px;
  min-height: 34px;
  padding: 0;
  border-radius: 999px;
}
.reader-error {
  color: #F78175;
  font-size: 0.88em;
  padding: 4px 16px;
  font-family: 'DM Sans', sans-serif;
}
.reader-narration {
  color: alpha(${chrome(settings.theme).fg}, 0.72);
  font-style: italic;
  font-size: 0.88em;
  font-family: 'DM Sans', sans-serif;
}
.reader-label {
  color: alpha(${chrome(settings.theme).fg}, 0.6);
  font-size: 0.84em;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
}

/* ── Progress Pill & Badge ── */
.reader-percent-pill {
  font-family: 'Nunito', sans-serif;
  font-size: 0.82em;
  font-weight: 900;
  padding: 3px 10px;
  border-radius: 999px;
  background-color: alpha(#E9AC45, 0.18);
  color: #E9AC45;
}
.reader-progress-badge {
  font-family: 'Nunito', sans-serif;
  font-size: 0.8em;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  background-color: alpha(#E9AC45, 0.16);
  color: #E9AC45;
}
.reader-progress-complete {
  background-color: alpha(#10b981, 0.18);
  color: #10b981;
}

/* ── Library Homepage (bocchi reader) ── */
.reader-library {
  background-color: ${chrome(settings.theme).bg};
  padding: 40px 54px;
}
.reader-library-head {
  padding-bottom: 24px;
  border-bottom: 1px solid alpha(${chrome(settings.theme).fg}, 0.08);
  margin-bottom: 24px;
}
.tomo-eyebrow {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 0.76em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #F78175;
}
.reader-library-title {
  font-family: 'Nunito', sans-serif;
  font-size: 2.1em;
  font-weight: 900;
  letter-spacing: -0.025em;
}
.reader-library-sub {
  color: alpha(${chrome(settings.theme).fg}, 0.58);
  font-size: 0.98em;
  font-family: 'DM Sans', sans-serif;
  margin-top: 4px;
}
.reader-dropzone {
  padding: 28px;
  border-radius: 20px;
  border: 2px dashed alpha(${chrome(settings.theme).fg}, 0.15);
  background-color: alpha(${chrome(settings.theme).fg}, 0.018);
}
.reader-pick-btn {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 1.05em;
  padding: 12px 28px;
  min-height: 46px;
  border-radius: 999px;
}
.reader-card {
  padding: 16px 22px;
  border-radius: 16px;
  background-color: alpha(${chrome(settings.theme).fg}, 0.035);
  border: 1px solid alpha(${chrome(settings.theme).fg}, 0.08);
  margin-bottom: 10px;
}
.reader-card:hover {
  background-color: alpha(${chrome(settings.theme).fg}, 0.065);
  border-color: alpha(#F78175, 0.25);
}
.reader-card-title {
  font-family: 'Nunito', sans-serif;
  font-size: 1.1em;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.reader-card-meta {
  font-size: 0.85em;
  color: alpha(${chrome(settings.theme).fg}, 0.52);
  margin-top: 3px;
  font-family: 'DM Sans', sans-serif;
}

/* ── Options Modal (Bocchi Dialog) ── */
window.reader-dialog,
.reader-dialog-window {
  background-color: ${chrome(settings.theme).bg};
  color: ${chrome(settings.theme).fg};
}
.reader-modal {
  background-color: ${chrome(settings.theme).bg};
  padding: 26px 30px;
  min-width: 460px;
  font-family: 'DM Sans', sans-serif;
}
.reader-modal-title {
  font-family: 'Nunito', sans-serif;
  font-size: 1.3em;
  font-weight: 900;
  letter-spacing: -0.01em;
}
.reader-modal-subtitle {
  font-size: 0.85em;
  color: alpha(${chrome(settings.theme).fg}, 0.5);
  margin-top: 2px;
  font-family: 'DM Sans', sans-serif;
}
.reader-modal-section {
  padding: 12px 0;
  border-top: 1px solid alpha(${chrome(settings.theme).fg}, 0.08);
}
.reader-modal-label {
  font-family: 'Nunito', sans-serif;
  font-size: 0.92em;
  font-weight: 800;
  color: ${chrome(settings.theme).fg};
}
.reader-modal-desc {
  font-size: 0.8em;
  color: alpha(${chrome(settings.theme).fg}, 0.5);
  font-family: 'DM Sans', sans-serif;
}
`;
}
