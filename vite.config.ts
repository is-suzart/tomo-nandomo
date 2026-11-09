import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: '.',
  resolve: {
    alias: {
      '@nandomo/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@nandomo/bridge-runtime': resolve(__dirname, 'packages/bridge-runtime/src'),
      '@nandomo/bridge-gtk/jsx-runtime': resolve(__dirname, 'packages/bridge-gtk/src/jsx-runtime.ts'),
      '@nandomo/bridge-gtk/gtk': resolve(__dirname, 'packages/bridge-gtk/src/gtk.ts'),
      '@nandomo/bridge-gtk': resolve(__dirname, 'packages/bridge-gtk/src/index.ts'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: false,
    outDir: 'dist',
    emptyOutDir: true,
    ssr: true,
    rollupOptions: {
      input: 'src/main.ts',
      output: { format: 'es', entryFileNames: 'bundle.js' },
    },
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: false,
        useDefineForClassFields: false,
        target: 'es2022',
        jsx: 'react-jsx',
        jsxImportSource: '@nandomo/bridge-gtk',
      },
    },
  },
});
