import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { defineConfig } from 'vite';

/** The home page (optional, not in the open-source edition) is plain static files in public/home; it shares the sky shader with the editor. */
const shareShader = { name: 'share-liquid-shader', buildStart: () => void (fs.existsSync('public/home') && fs.copyFileSync('src/liquid.js', 'public/home/liquid.js')) };

export default defineConfig({
  plugins: [react(), shareShader],
  build: { rollupOptions: { input: { index: 'index.html', render: 'render.html' } } },
});
