# tomo (nandomo edition)

Leitor autoral de **EPUB** e **PDF** com narração em voz alta (**TTS offline** via Piper), construído com o framework nativo **nandomo** (TypeScript + JSX reativo renderizado nativamente em **GTK4** via host em Rust).

## Características

- **EPUB & PDF**: Carregamento instantâneo com descompactação e parsing de capítulos/sumário recursivo (NCX e NAV).
- **TTS Integrado (Piper)**: Voz neural local e privada com destaque sincronizado da frase em leitura.
- **Modos de Leitura**: Rolagem contínua ou páginas lado a lado (1 ou 2 colunas com suporte a telas ultrawide).
- **Design Bocchi / Tomo**: Tipografia balanceada (Nunito + DM Sans), paleta suave (Preto Suave, Creme, Coral, Dourado) e temas Claro, Escuro e Sépia.
- **Slider Adaptativo**: Navegação macro (livro inteiro com marcas de capítulo) ou micro (páginas/parágrafos do capítulo).
- **Teclado & Atalhos**: Navegação suave com setas `←` / `→` e `PageUp` / `PageDown`.

## Desenvolvimento

```bash
# Instalar dependências
pnpm install

# Compilar o host GTK em Rust e o bundle Vite
pnpm run build

# Executar
pnpm start
# ou abrindo um livro direto:
node bin/tomo.mjs ~/Downloads/livro.epub
```

## Instalação no Arch Linux (PKGBUILD)

Você pode empacotar e instalar no Arch diretamente com `makepkg`:

```bash
makepkg -si
```

O comando irá:
1. Compilar o host GTK4 em Rust e o frontend em TSX
2. Instalar o aplicativo em `/usr/lib/tomo`
3. Disponibilizar o comando `tomo` no `/usr/bin`
4. Registrar o aplicativo `.desktop` no menu do sistema para abrir arquivos `.epub` e `.pdf`.
