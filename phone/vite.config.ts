import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is bundled into the phone, never loaded from a server. The prompt
// deck is shared with the desktop app from ../src/shared.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
