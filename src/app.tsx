/** @jsxImportSource @nandomo/bridge-gtk */
import { Dialog, For, Show } from '@nandomo/core';
import { gtk } from '@nandomo/bridge-gtk/gtk';
import { gtkStyles } from './appearance.js';
import { FONT_OPTIONS, type PageFilter, type ReaderState, type AppTheme, type ReadingMode } from './model.js';
import { pickFile } from './picker.js';
import { t, languageName } from './i18n.js';
import { tomoAppMeta } from './meta.js';

export interface ReaderAppProps {
  readonly state: ReaderState;
}

const FILTERS: ReadonlyArray<{ id: PageFilter; label: string }> = [
  { id: 'system', label: t('options.pageThemeSystem') },
  { id: 'light', label: t('options.pageThemeLight') },
  { id: 'dark', label: t('options.pageThemeDark') },
  { id: 'sepia', label: t('options.pageThemeSepia') },
];

const THEMES: ReadonlyArray<{ id: AppTheme; label: string }> = [
  { id: 'system', label: t('library.appearanceSystem') },
  { id: 'light', label: t('library.appearanceLight') },
  { id: 'dark', label: t('library.appearanceDark') },
];

export function ReaderApp(props: ReaderAppProps): unknown {
  const { state } = props;
  const settings = (): ReturnType<ReaderState['settings']> => state.settings();

  const currentChapter = (): import('./documents.js').Chapter | undefined => {
    const doc = state.book();
    const id = state.chapterId();
    if (!doc || !id) return undefined;
    return doc.chapters.find(c => c.id === id);
  };

  const isLibrary = state.viewMode() === 'library' || !state.book();

  /** Voices grouped by language, so the picker reads like a menu, not a dump. */
  const voiceGroups = (): Array<{ lang: string; label: string; options: Array<{ value: string; label: string }> }> => {
    const groups = new Map<string, Array<{ value: string; label: string }>>();
    for (const voice of state.voices()) {
      const list = groups.get(voice.lang) ?? [];
      list.push({ value: voice.id, label: voice.label });
      groups.set(voice.lang, list);
    }
    return Array.from(groups.entries()).map(([lang, options]) => ({
      lang,
      label: languageName(lang),
      options,
    }));
  };

  /** Flat list with a group header per language — GtkComboBoxText has no groups. */
  const voiceOptions = (): Array<{ value: string; label: string }> => {
    const out: Array<{ value: string; label: string }> = [];
    for (const group of voiceGroups()) {
      out.push({ value: '', label: `— ${group.label} —` });
      out.push(...group.options);
    }
    return out;
  };

  return (
    <gtk.Window
      objectName="reader"
      title={() => (isLibrary ? tomoAppMeta.name : t('reader.bookTitle', { title: state.book()?.title ?? '' }))}
      icon_name="tomo"
      default_width={1180}
      default_height={820}
      width_request={960}
      height_request={640}
      styleSheet={() => gtkStyles(settings())}
    >
      <gtk.Box orientation="vertical" cssClasses="reader-root" vexpand>
        {isLibrary ? (
          /* ═══════════════════════════════════════════════════════════════
             TELA 1: BIBLIOTECA / HOMEPAGE (bocchi reader)
             ═══════════════════════════════════════════════════════════════ */
          <gtk.ScrollView hexpand vexpand>
            <gtk.Box orientation="vertical" cssClasses="reader-library" spacing={20} hexpand>
              {/* Cabeçalho da marca bocchi */}
              <gtk.Box orientation="vertical" cssClasses="reader-library-head" spacing={6}>
                <gtk.Label text={t('library.eyebrow')} cssClasses="tomo-eyebrow" />
                <gtk.Label text="tomo" cssClasses="reader-library-title" />
                <gtk.Label text={t('library.subtitle')} cssClasses="reader-library-sub" />
              </gtk.Box>

              {/* Botão de File Picker nativo do sistema + Drag & Drop */}
              <gtk.Box orientation="vertical" cssClasses="reader-dropzone" spacing={10} hexpand>
                <gtk.Button
                  icon_name="document-open-symbolic"
                  label={t('library.pick')}
                  cssClasses="reader-button reader-primary reader-pick-btn"
                  onClick={async () => {
                    const file = await pickFile();
                    if (file) void state.open(file);
                  }}
                />
                <gtk.Label text={t('library.dropHint')} cssClasses="reader-subtitle" />
              </gtk.Box>

              {/* Tema da interface — separado do tema da página do livro */}
              <gtk.Box orientation="vertical" cssClasses="reader-modal-section" spacing={6}>
                <gtk.Box orientation="vertical" hexpand spacing={2}>
                  <gtk.Label text={t('library.appearance')} cssClasses="reader-modal-label" />
                  <gtk.Label text={t('library.appearanceHint')} cssClasses="reader-modal-desc" />
                </gtk.Box>
                <gtk.Box orientation="horizontal" spacing={6}>
                  {THEMES.map(theme => (
                    <gtk.Button
                      label={theme.label}
                      cssClasses={() =>
                        'reader-button' + (settings().theme === theme.id ? ' is-active' : '')
                      }
                      onClick={() => state.update({ theme: theme.id })}
                    />
                  ))}
                </gtk.Box>
              </gtk.Box>

              {/* Mensagem de erro se houver */}
              <Show when={() => state.error()}>
                {() => <gtk.Label text={() => state.error() ?? ''} cssClasses="reader-error" />}
              </Show>

              {/* Livros recentes */}
              <gtk.Box orientation="vertical" spacing={8} hexpand>
                <gtk.Label text={t('library.recents')} cssClasses="reader-sidebar-title" />
                {state.recentBooks().length === 0 ? (
                  <gtk.Label text={t('library.empty')} cssClasses="reader-subtitle" />
                ) : (
                  <For each={() => state.recentBooks()} by={book => book.path}>
                    {book => (
                      <gtk.Box orientation="horizontal" cssClasses="reader-card" spacing={12} hexpand>
                        <gtk.Box orientation="vertical" hexpand spacing={2}>
                          <gtk.Label text={() => book().title} cssClasses="reader-card-title" />
                          <gtk.Label
                            text={() =>
                              `${book().author ? book().author + ' · ' : ''}${book().format.toUpperCase()} · ${book().path}`
                            }
                            cssClasses="reader-card-meta"
                            ellipsize="end"
                          />
                        </gtk.Box>
                        {/* Porcentagem lida */}
                        <gtk.Label
                          text={() => t('library.percentRead', { percent: book().progressPercent ?? 0 })}
                          cssClasses={() =>
                            'reader-progress-badge' +
                            ((book().progressPercent ?? 0) >= 100 ? ' reader-progress-complete' : '')
                          }
                        />
                        <gtk.Button
                          icon_name="media-playback-start-symbolic"
                          label={t('library.readNow')}
                          cssClasses="reader-button reader-primary"
                          onClick={() => void state.open(book().path)}
                        />
                        <gtk.Button
                          icon_name="window-close-symbolic"
                          tooltip_text={t('library.removeRecent')}
                          cssClasses="reader-button"
                          onClick={() => state.removeRecent(book().path)}
                        />
                      </gtk.Box>
                    )}
                  </For>
                )}
              </gtk.Box>
            </gtk.Box>
          </gtk.ScrollView>
        ) : (
          /* ═══════════════════════════════════════════════════════════════
             TELA 2: LEITOR DO LIVRO
             ═══════════════════════════════════════════════════════════════ */
          <gtk.Box orientation="vertical" hexpand vexpand>
            {/* ── Barra superior limpa, equilibrada e centralizada ─────────────── */}
            <gtk.Box orientation="horizontal" spacing={8} cssClasses="reader-topbar" hexpand>
              {/* 1. Botão da marca tomo (primeiro de tudo, volta para a biblioteca) */}
              <gtk.Button
                label="tomo"
                tooltip_text={t('reader.backToLibrary')}
                cssClasses="tomo-brand-btn"
                onClick={() => state.closeBook()}
              />

              {/* 2. Hambúrguer para alternar o sumário da barra lateral */}
              <gtk.Button
                icon_name="open-menu-symbolic"
                tooltip_text={t('reader.toggleToc')}
                cssClasses={() => 'reader-button reader-nav-step' + (state.sidebarOpen() ? ' is-active' : '')}
                onClick={() => state.toggleSidebar()}
              />

              {/* 3. Navegação direta entre capítulos */}
              <gtk.Button
                icon_name="go-previous-symbolic"
                tooltip_text={t('reader.previousChapter')}
                disabled={() => !state.hasPreviousChapter()}
                cssClasses="reader-button reader-nav-step"
                onClick={() => state.previousChapter()}
              />
              <gtk.Button
                icon_name="go-next-symbolic"
                tooltip_text={t('reader.nextChapter')}
                disabled={() => !state.hasNextChapter()}
                cssClasses="reader-button reader-nav-step"
                onClick={() => state.nextChapter()}
              />

              {/* Espaçador para empurrar o título para o centro */}
              <gtk.Box hexpand />

              {/* 4. Bloco centralizado: Título do capítulo em cima, livro e capítulo embaixo */}
              <gtk.Box orientation="vertical" spacing={2} cssClasses="reader-topbar-center">
                {/* Linha de cima: Título do capítulo atual destacado */}
                <gtk.Label
                  text={() => currentChapter()?.title ?? state.book()?.title ?? ''}
                  cssClasses="reader-title"
                  xalign={0.5}
                  ellipsize="end"
                />
                {/* Linha de baixo: Livro · Formato · Capítulo X de Y (Z%) */}
                <gtk.Label
                  text={() => {
                    const doc = state.book();
                    if (!doc) return '';
                    const idx = state.currentChapterIndex();
                    const num =
                      idx >= 0
                        ? t('reader.chapterOf', {
                            current: idx + 1,
                            total: doc.chapters.length,
                            percent: state.readingProgress(),
                          })
                        : t('reader.chaptersCount', { count: doc.chapters.length });
                    return `${doc.title} · ${doc.format.toUpperCase()} · ${num}`;
                  }}
                  cssClasses="reader-subtitle"
                  xalign={0.5}
                  ellipsize="end"
                />
              </gtk.Box>

              {/* Espaçador para equilibrar o centro */}
              <gtk.Box hexpand />

              {/* 5. Status / Narração à direita */}
              <gtk.Label text={() => state.status()} cssClasses="reader-subtitle" />
            </gtk.Box>

            {/* ── Corpo principal (Sumário + Leitura) ───────────────────── */}
            <gtk.Box orientation="horizontal" hexpand vexpand>
              {/* Sumário lateral */}
              <gtk.Box
                orientation="vertical"
                spacing={4}
                width_request={260}
                cssClasses="reader-sidebar"
                visible={() => state.sidebarOpen()}
              >
                <gtk.Label text={t('reader.toc')} cssClasses="reader-sidebar-title" />
                <gtk.ScrollView hexpand vexpand>
                  <gtk.Box orientation="vertical" spacing={2}>
                    <For each={() => state.book()?.chapters ?? []} by={chapter => chapter.id}>
                      {chapter => (
                        <gtk.Button
                          label={() => chapter().title}
                          labelAlign="start"
                          cssClasses={() =>
                            'reader-chapter' + (state.chapterId() === chapter().id ? ' is-active' : '')
                          }
                          onClick={() => state.selectChapter(chapter().id)}
                          scrollIntoView={() => state.sidebarOpen() && state.chapterId() === chapter().id}
                        />
                      )}
                    </For>
                  </gtk.Box>
                </gtk.ScrollView>
              </gtk.Box>

              {/* Superfície de leitura: rolagem contínua ou páginas estilo Google Play Books */}
              <gtk.Box orientation="vertical" hexpand vexpand>
                <Show when={() => state.readingMode() === 'pages'}>
                  {() => (
                    /* Modo páginas: contido em ScrollView para garantir que o footer nunca seja empurrado para fora da tela */
                    <gtk.ScrollView hexpand vexpand cssClasses="reader-surface reader-spread-scroll">
                      <gtk.Box orientation="horizontal" spacing={20} cssClasses="reader-spread" hexpand vexpand>
                        {/* Página 1 (ou página única responsiva) */}
                        <gtk.Box orientation="vertical" cssClasses="reader-page-frame" hexpand vexpand>
                          <gtk.RichText
                            name="page-left"
                            markup={() => state.pageMarkup()}
                            cssClasses="reader-page reader-page-fixed"
                            lineHeight={() => settings().lineHeight}
                            justify={() => (settings().justify ? 'fill' : 'left')}
                            left_margin={44}
                            right_margin={44}
                            hexpand
                            vexpand
                          />
                          <gtk.Box orientation="horizontal" cssClasses="reader-page-footer">
                            <gtk.Label
                              text={() => {
                                const cur = Math.min(state.pageIndex(), Math.max(0, state.pageCount() - 1));
                                return state.effectivePageColumns() === 2
                                  ? `Página ${Math.min(cur * 2 + 1, Math.max(1, state.pageSpansCount()))} de ${Math.max(1, state.pageSpansCount())}`
                                  : `Página ${cur + 1} de ${Math.max(1, state.pageCount())}`;
                              }}
                              cssClasses="reader-page-num"
                            />
                            <gtk.Box hexpand />
                            <gtk.Label
                              text={() => `${state.readingProgress()}%`}
                              cssClasses="reader-page-num"
                            />
                          </gtk.Box>
                        </gtk.Box>

                        {/* Página 2 (apenas se 2 colunas ativas e houver texto) */}
                        <Show when={() => state.effectivePageColumns() === 2 && Boolean(state.rightPageMarkup())}>
                          {() => (
                            <gtk.Box orientation="vertical" cssClasses="reader-page-frame" hexpand vexpand>
                              <gtk.RichText
                                name="page-right"
                                markup={() => state.rightPageMarkup()}
                                cssClasses="reader-page reader-page-fixed"
                                lineHeight={() => settings().lineHeight}
                                justify={() => (settings().justify ? 'fill' : 'left')}
                                left_margin={44}
                                right_margin={44}
                                hexpand
                                vexpand
                              />
                              <gtk.Box orientation="horizontal" cssClasses="reader-page-footer">
                                <gtk.Label
                                  text={() => {
                                    const cur = Math.min(state.pageIndex(), Math.max(0, state.pageCount() - 1));
                                    return `Página ${Math.min(cur * 2 + 2, Math.max(1, state.pageSpansCount()))} de ${Math.max(1, state.pageSpansCount())}`;
                                  }}
                                  cssClasses="reader-page-num"
                                />
                                <gtk.Box hexpand />
                                <gtk.Label
                                  text={() => `${state.readingProgress()}%`}
                                  cssClasses="reader-page-num"
                                />
                              </gtk.Box>
                            </gtk.Box>
                          )}
                        </Show>
                      </gtk.Box>
                    </gtk.ScrollView>
                  )}
                </Show>
                <Show when={() => state.readingMode() !== 'pages'}>
                  {() => (
                    /* Keyed by chapter: a new chapter gets a fresh ScrollView, so it
                       always starts at the top instead of inheriting the old offset. */
                    <For each={() => (state.chapterId() ? [state.chapterId()!] : [])} by={id => id}>
                      {() => (
                    <gtk.ScrollView hexpand vexpand cssClasses="reader-surface">
                      <gtk.Box orientation="vertical" hexpand vexpand>
                        <For each={() => currentChapter()?.images ?? []} by={img => img}>
                          {img => (
                            <gtk.Box orientation="vertical" cssClasses="reader-image-frame" hexpand>
                              <gtk.Picture src={() => img()} contentFit="contain" height_request={440} hexpand />
                            </gtk.Box>
                          )}
                        </For>

                        <gtk.RichText
                          markup={() => state.markup()}
                          cssClasses="reader-page"
                          lineHeight={() => settings().lineHeight}
                          justify={() => (settings().justify ? 'fill' : 'left')}
                          left_margin={54}
                          right_margin={54}
                          scrollToChar={() => state.currentSentenceOffset()}
                          hexpand
                          vexpand
                        />

                        <Show when={() => state.hasNextChapter()}>
                          {() => (
                            <gtk.Button cssClasses="reader-next-card" onClick={() => state.nextChapter()}>
                              <gtk.Box orientation="vertical" hexpand spacing={3}>
                                <gtk.Label text={t('reader.nextChapterCard')} cssClasses="reader-next-label" />
                                <gtk.Label text={() => `${state.nextChapterTitle()}  →`} cssClasses="reader-next-title" />
                              </gtk.Box>
                            </gtk.Button>
                          )}
                        </Show>
                      </gtk.Box>
                    </gtk.ScrollView>
                      )}
                    </For>
                  )}
                </Show>

                {/* ── Barra de transporte minimalista e ultra limpa ────────── */}
                <gtk.Box orientation="vertical" cssClasses="reader-transport-wrap" spacing={4}>
                  {/* Barra inteligente: discorre sobre o livro todo quando a sidebar está aberta,
                      e foca no capítulo atual (páginas ou parágrafos) quando fechada */}
                  <gtk.Box orientation="horizontal" spacing={8} cssClasses="reader-progress-row" hexpand>
                    {/* Caso A: Sidebar aberta -> visão macro de todo o livro (0..100%, marcas de capítulos) */}
                    <Show when={() => state.sidebarOpen()}>
                      {() => (
                        <>
                          <gtk.Slider
                            min={0}
                            max={100}
                            step={0.1}
                            value={() => state.readingProgress()}
                            marks={() => state.chapterMarks()}
                            drawValue={false}
                            hexpand
                            tooltip_text={() => currentChapter()?.title ?? ''}
                            onChange={(value: number) => state.seekTo(value)}
                          />
                          <gtk.Label
                            text={() => `${state.readingProgress()}%`}
                            cssClasses="reader-percent-pill"
                            tooltip_text={t('reader.progress')}
                          />
                        </>
                      )}
                    </Show>

                    {/* Caso B: Sidebar fechada + Modo Páginas -> discorre pelas páginas do capítulo atual */}
                    <Show when={() => !state.sidebarOpen() && state.readingMode() === 'pages'}>
                      {() => (
                        <>
                          <gtk.Slider
                            min={1}
                            max={Math.max(1, state.pageCount())}
                            step={1}
                            digits={0}
                            value={() => Math.min(state.pageCount(), Math.max(1, state.pageIndex() + 1))}
                            drawValue={false}
                            hexpand
                            tooltip_text={() => `Página ${Math.min(state.pageCount(), Math.max(1, state.pageIndex() + 1))} de ${Math.max(1, state.pageCount())}`}
                            onChange={(value: number) => state.goToPage(Math.round(value) - 1)}
                          />
                          <gtk.Label
                            text={() => `${Math.min(state.pageCount(), state.pageIndex() + 1)}/${Math.max(1, state.pageCount())} pág`}
                            cssClasses="reader-percent-pill"
                            tooltip_text="Página atual do capítulo"
                          />
                        </>
                      )}
                    </Show>

                    {/* Caso C: Sidebar fechada + Modo Rolagem -> discorre pelos parágrafos do capítulo atual */}
                    <Show when={() => !state.sidebarOpen() && state.readingMode() !== 'pages'}>
                      {() => (
                        <>
                          <gtk.Slider
                            min={1}
                            max={Math.max(1, state.sentences().length)}
                            step={1}
                            digits={0}
                            value={() => Math.min(state.sentences().length, Math.max(1, state.sentenceIndex() + 1))}
                            drawValue={false}
                            hexpand
                            tooltip_text={() => state.sentences()[state.sentenceIndex()]?.text ?? ''}
                            onChange={(value: number) => state.jumpToSentence(Math.round(value) - 1)}
                          />
                          <gtk.Label
                            text={() => `${Math.min(state.sentences().length, state.sentenceIndex() + 1)}/${Math.max(1, state.sentences().length)} §`}
                            cssClasses="reader-percent-pill"
                            tooltip_text="Parágrafo atual do capítulo"
                          />
                        </>
                      )}
                    </Show>
                  </gtk.Box>

                  <gtk.Box orientation="horizontal" spacing={6} cssClasses="reader-transport">
                    <gtk.Button
                      icon_name="media-skip-backward-symbolic"
                      tooltip_text={t('reader.previousSentence')}
                      cssClasses="reader-button reader-nav-step"
                      onClick={() => state.previousSentence()}
                    />
                    <gtk.Button
                      icon_name={() => (state.playing() ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic')}
                      tooltip_text={(() => (state.playing() ? t('reader.pauseSpeech') : t('reader.startSpeech'))) as unknown as string}
                      cssClasses="reader-button reader-primary reader-nav-step"
                      onClick={() => (state.playing() ? state.pause() : state.play())}
                    />
                    <gtk.Button
                      icon_name="media-playback-stop-symbolic"
                      tooltip_text={t('reader.stopSpeech')}
                      cssClasses="reader-button reader-nav-step"
                      onClick={() => state.stop()}
                    />
                    <gtk.Button
                      icon_name="media-skip-forward-symbolic"
                      tooltip_text={t('reader.nextSentence')}
                      cssClasses="reader-button reader-nav-step"
                      onClick={() => state.nextSentence()}
                    />

                    {/* Navegação horizontal limpa por página (só no modo páginas) */}
                    <Show when={() => state.readingMode() === 'pages'}>
                      {() => (
                        <gtk.Box orientation="horizontal" spacing={4}>
                          <gtk.Button
                            icon_name="go-previous-symbolic"
                            tooltip_text={t('reader.previousPage')}
                            disabled={() => state.pageIndex() <= 0 && !state.hasPreviousChapter()}
                            cssClasses="reader-button reader-nav-step"
                            onClick={() => state.previousPage()}
                          />
                          <gtk.Label
                            text={() => {
                              const cur = Math.min(state.pageIndex(), Math.max(0, state.pageCount() - 1)) + 1;
                              return t('reader.pageOf', { current: cur, total: Math.max(1, state.pageCount()) });
                            }}
                            cssClasses="reader-label"
                          />
                          <gtk.Button
                            icon_name="go-next-symbolic"
                            tooltip_text={t('reader.nextPage')}
                            disabled={() => state.pageIndex() >= state.pageCount() - 1 && !state.hasNextChapter()}
                            cssClasses="reader-button reader-nav-step"
                            onClick={() => state.nextPage()}
                          />
                        </gtk.Box>
                      )}
                    </Show>

                    {/* Botão de Opções: abre o Modal de Configurações (só ícone) */}
                    <gtk.Button
                      icon_name="preferences-system-symbolic"
                      tooltip_text={t('reader.options')}
                      cssClasses={() => 'reader-button' + (state.optionsOpen() ? ' is-active' : '')}
                      onClick={() => state.toggleOptions()}
                    />

                    <gtk.Box hexpand />

                    {/* Frase em narração limpa em 1 linha */}
                    <gtk.Label
                      text={() => {
                        const sentence = state.currentSentence().replace(/\s+/g, ' ').trim();
                        if (!sentence) return t('reader.clickToJump');
                        return sentence.length > 72 ? `${sentence.slice(0, 72)}…` : sentence;
                      }}
                      cssClasses="reader-narration"
                      hexpand
                      ellipsize="end"
                      max_width_chars={42}
                    />
                  </gtk.Box>
                </gtk.Box>

                {/* Mensagem de erro se houver */}
                <Show when={() => state.error()}>
                  {() => <gtk.Label text={() => state.error() ?? ''} cssClasses="reader-error" />}
                </Show>
              </gtk.Box>
            </gtk.Box>
          </gtk.Box>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            MODAL DE CONFIGURAÇÕES / SETTINGS (usando nativo Dialog)
           ═══════════════════════════════════════════════════════════════ */}
        <Show when={() => state.optionsOpen()}>
          {() => (
            <Dialog
              open={state.optionsOpen}
              title={t('options.title')}
              objectName="reader-options-dialog"
              closeOnEscape={true}
              onCloseRequest={() => state.optionsOpen.set(false)}
            >
              <gtk.Box orientation="vertical" cssClasses="reader-modal" spacing={14} width_request={460}>
                {/* Topo do modal */}
                <gtk.Box orientation="horizontal" spacing={8} hexpand>
                  <gtk.Box orientation="vertical" hexpand spacing={2}>
                    <gtk.Label text={t('options.heading')} cssClasses="reader-modal-title" />
                    <gtk.Label text={t('options.subtitle')} cssClasses="reader-modal-subtitle" />
                  </gtk.Box>
                  <gtk.Button
                    icon_name="window-close-symbolic"
                    tooltip_text={t('options.close')}
                    cssClasses="reader-button"
                    onClick={() => state.optionsOpen.set(false)}
                  />
                </gtk.Box>

                {/* 1. Tema da interface */}
                <gtk.Box orientation="vertical" cssClasses="reader-modal-section" spacing={6}>
                  <gtk.Label text={t('library.appearance')} cssClasses="reader-modal-label" />
                  <gtk.Box orientation="horizontal" spacing={6}>
                    {THEMES.map(theme => (
                      <gtk.Button
                        label={theme.label}
                        cssClasses={() =>
                          'reader-button' + (settings().theme === theme.id ? ' is-active' : '')
                        }
                        onClick={() => state.update({ theme: theme.id })}
                      />
                    ))}
                  </gtk.Box>
                </gtk.Box>

                {/* 2. Tema da página */}
                <gtk.Box orientation="vertical" cssClasses="reader-modal-section" spacing={6}>
                  <gtk.Label text={t('options.pageTheme')} cssClasses="reader-modal-label" />
                  <gtk.Box orientation="horizontal" spacing={6}>
                    {FILTERS.map(filter => (
                      <gtk.Button
                        label={filter.label}
                        cssClasses={() =>
                          'reader-button' + (settings().filter === filter.id ? ' is-active' : '')
                        }
                        onClick={() => state.update({ filter: filter.id })}
                      />
                    ))}
                  </gtk.Box>
                </gtk.Box>

                {/* 3. Modo de leitura */}
                <gtk.Box orientation="horizontal" cssClasses="reader-modal-section" spacing={8}>
                  <gtk.Box orientation="vertical" hexpand spacing={2}>
                    <gtk.Label text={t('reader.viewMode')} cssClasses="reader-modal-label" />
                    <gtk.Label text={t('reader.viewPagesHint')} cssClasses="reader-modal-desc" />
                  </gtk.Box>
                  <gtk.Box orientation="horizontal" spacing={4}>
                    <gtk.Button
                      label={t('reader.viewScroll')}
                      cssClasses={() =>
                        'reader-button' + (state.readingMode() === 'scroll' ? ' is-active' : '')
                      }
                      onClick={() => state.toggleReadingMode()}
                    />
                    <gtk.Button
                      label={t('reader.viewPages')}
                      cssClasses={() =>
                        'reader-button' + (state.readingMode() === 'pages' ? ' is-active' : '')
                      }
                      onClick={() => state.toggleReadingMode()}
                    />
                  </gtk.Box>
                </gtk.Box>

                {/* 3b. Colunas no modo páginas */}
                <Show when={() => state.readingMode() === 'pages'}>
                  {() => (
                    <gtk.Box orientation="horizontal" cssClasses="reader-modal-section" spacing={8}>
                      <gtk.Box orientation="vertical" hexpand spacing={2}>
                        <gtk.Label text="Páginas por tela" cssClasses="reader-modal-label" />
                        <gtk.Label text="1 coluna confortável ou 2 como livro aberto" cssClasses="reader-modal-desc" />
                      </gtk.Box>
                      <gtk.Box orientation="horizontal" spacing={4}>
                        <gtk.Button
                          label="Automático"
                          cssClasses={() =>
                            'reader-button' + ((settings().pageColumns ?? 'auto') === 'auto' ? ' is-active' : '')
                          }
                          onClick={() => state.update({ pageColumns: 'auto' })}
                        />
                        <gtk.Button
                          label="1 Página"
                          cssClasses={() =>
                            'reader-button' + (settings().pageColumns === 1 ? ' is-active' : '')
                          }
                          onClick={() => state.update({ pageColumns: 1 })}
                        />
                        <gtk.Button
                          label="2 Páginas"
                          cssClasses={() =>
                            'reader-button' + (settings().pageColumns === 2 ? ' is-active' : '')
                          }
                          onClick={() => state.update({ pageColumns: 2 })}
                        />
                      </gtk.Box>
                    </gtk.Box>
                  )}
                </Show>

                {/* 4. Voz Padrão — agrupada por idioma */}
                <gtk.Box orientation="vertical" cssClasses="reader-modal-section" spacing={6}>
                  <gtk.Box orientation="vertical" spacing={2}>
                    <gtk.Label text={t('options.voice')} cssClasses="reader-modal-label" />
                    <gtk.Label text={t('options.voiceHint')} cssClasses="reader-modal-desc" />
                  </gtk.Box>
                  <gtk.Select
                    options={voiceOptions}
                    value={() => state.voiceId()}
                    onChange={(value: string) => {
                      if (!value) return; // group headers are not selectable
                      state.setVoice(value);
                    }}
                  />
                </gtk.Box>

                {/* 5. Tipografia (5 fontes selecionadas) */}
                <gtk.Box orientation="vertical" cssClasses="reader-modal-section" spacing={6}>
                  <gtk.Label text={t('options.typography')} cssClasses="reader-modal-label" />
                  <gtk.Select
                    options={FONT_OPTIONS.map(f => ({ value: f.id, label: f.label }))}
                    value={() => settings().fontId}
                    onChange={(fontId: string) => state.setFont(fontId)}
                  />
                </gtk.Box>

                {/* 6. Tamanho da Fonte */}
                <gtk.Box orientation="horizontal" cssClasses="reader-modal-section" spacing={8}>
                  <gtk.Box orientation="vertical" hexpand spacing={2}>
                    <gtk.Label text={t('options.fontSize')} cssClasses="reader-modal-label" />
                    <gtk.Label text={t('options.fontSizeHint')} cssClasses="reader-modal-desc" />
                  </gtk.Box>
                  <gtk.Box orientation="horizontal" spacing={4}>
                    <gtk.Button
                      label="−"
                      cssClasses="reader-button"
                      onClick={() => state.update({ fontSize: Math.max(12, settings().fontSize - 1) })}
                    />
                    <gtk.Label text={() => `${settings().fontSize}px`} cssClasses="reader-label" />
                    <gtk.Button
                      label="+"
                      cssClasses="reader-button"
                      onClick={() => state.update({ fontSize: Math.min(36, settings().fontSize + 1) })}
                    />
                  </gtk.Box>
                </gtk.Box>

                {/* 7. Alinhamento */}
                <gtk.Box orientation="horizontal" cssClasses="reader-modal-section" spacing={8}>
                  <gtk.Box orientation="vertical" hexpand spacing={2}>
                    <gtk.Label text={t('options.alignment')} cssClasses="reader-modal-label" />
                    <gtk.Label text={t('options.alignmentHint')} cssClasses="reader-modal-desc" />
                  </gtk.Box>
                  <gtk.Button
                    label={() => (settings().justify ? t('options.justified') : t('options.left'))}
                    cssClasses={() => 'reader-button' + (settings().justify ? ' is-active' : '')}
                    onClick={() => state.update({ justify: !settings().justify })}
                  />
                </gtk.Box>

                {/* 8. Velocidade da Narração */}
                <gtk.Box orientation="horizontal" cssClasses="reader-modal-section" spacing={8}>
                  <gtk.Box orientation="vertical" hexpand spacing={2}>
                    <gtk.Label text={t('options.rate')} cssClasses="reader-modal-label" />
                    <gtk.Label text={t('options.rateHint')} cssClasses="reader-modal-desc" />
                  </gtk.Box>
                  <gtk.Box orientation="horizontal" spacing={4}>
                    <gtk.Button
                      label="−"
                      cssClasses="reader-button"
                      onClick={() => state.setRate(Math.max(-50, state.rate() - 10))}
                    />
                    <gtk.Label text={() => `${state.rate() > 0 ? '+' : ''}${state.rate()}%`} cssClasses="reader-label" />
                    <gtk.Button
                      label="+"
                      cssClasses="reader-button"
                      onClick={() => state.setRate(Math.min(100, state.rate() + 10))}
                    />
                  </gtk.Box>
                </gtk.Box>

                {/* Botão de Concluir */}
                <gtk.Button
                  label={t('options.done')}
                  cssClasses="reader-button reader-primary"
                  onClick={() => state.optionsOpen.set(false)}
                />
              </gtk.Box>
            </Dialog>
          )}
        </Show>
      </gtk.Box>
    </gtk.Window>
  );
}
