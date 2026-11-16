import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is the part of the app the person sees. It is built to plain
// files that the desktop window loads from disk, so nothing is served over a
// network.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
