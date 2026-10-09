import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  server: process.env.NO_HMR ? { hmr: false, watch: { ignored: ['**/*'] } } : {},
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: mode === 'single' ? { output: { inlineDynamicImports: true } } : {},
  },
}));
