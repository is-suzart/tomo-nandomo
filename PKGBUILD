# Maintainer: Igor Suzart <igorarsuzart@gmail.com>
pkgname=tomo-nandomo-git
pkgver=0.1.0
pkgrel=1
pkgdesc="Leitor autoral de EPUB e PDF com narração TTS (Piper), construído com nandomo (GTK4 + TypeScript)"
arch=('x86_64')
url="https://github.com/is-suzart/tomo-nandomo"
license=('MIT')
depends=('gtk4' 'nodejs>=20' 'pango' 'cairo' 'gdk-pixbuf2' 'zenity')
optdepends=(
  'piper: motor de síntese neural de voz local (offline)'
  'mpv: reprodução de áudio'
  'ffplay: reprodução de áudio alternativa (ffmpeg)'
  'paplay: reprodução de áudio via PulseAudio/PipeWire'
)
makedepends=('git' 'rust' 'cargo' 'pnpm')
provides=('tomo')
conflicts=('tomo')
source=("$pkgname::git+https://github.com/is-suzart/tomo-nandomo.git#branch=master")
sha256sums=('SKIP')

prepare() {
  cd "$srcdir/$pkgname"
  pnpm install --frozen-lockfile=false --ignore-scripts
}

build() {
  cd "$srcdir/$pkgname"
  pnpm run build
}

package() {
  cd "$srcdir/$pkgname"

  install -dm755 "$pkgdir/usr/lib/tomo"
  install -dm755 "$pkgdir/usr/bin"
  install -dm755 "$pkgdir/usr/share/applications"
  install -dm755 "$pkgdir/usr/share/icons/hicolor/scalable/apps"
  install -dm755 "$pkgdir/usr/share/icons/hicolor/128x128/apps"
  install -dm755 "$pkgdir/usr/share/icons/hicolor/256x256/apps"

  # App bundle e dependências do Node
  cp -r dist "$pkgdir/usr/lib/tomo/"
  cp -r node_modules "$pkgdir/usr/lib/tomo/"
  cp package.json "$pkgdir/usr/lib/tomo/"

  # Host binário GTK4 compilado em Rust
  install -Dm755 host/target/release/bridge-gtk-host "$pkgdir/usr/lib/tomo/bridge-gtk-host"

  # Executável wrapper em /usr/bin/tomo
  cat > "$pkgdir/usr/bin/tomo" << 'EOF'
#!/bin/sh
export BRIDGE_GTK_HOST_PATH=/usr/lib/tomo/bridge-gtk-host
exec node /usr/lib/tomo/dist/bundle.js "$@"
EOF
  chmod 755 "$pkgdir/usr/bin/tomo"

  # Desktop entry gerado a partir do AppMeta
  install -Dm644 tomo.desktop "$pkgdir/usr/share/applications/tomo.desktop"

  # Ícones do aplicativo
  install -Dm644 assets/tomo.svg "$pkgdir/usr/share/icons/hicolor/scalable/apps/tomo.svg"
  install -Dm644 assets/tomo.png "$pkgdir/usr/share/icons/hicolor/128x128/apps/tomo.png"
  install -Dm644 assets/tomo-256.png "$pkgdir/usr/share/icons/hicolor/256x256/apps/tomo.png"
}
