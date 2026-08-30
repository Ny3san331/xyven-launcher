import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'electron/main.ts'),
      formats: ['cjs'],
      fileName: 'main',
    },
    outDir: '.vite/build',
    emptyOutDir: false,
    rollupOptions: {
      external: [
        'electron',
        /^node:/,
        'path', 'fs', 'fs/promises', 'crypto', 'child_process',
        'zlib', 'stream', 'stream/promises', 'os', 'util', 'events',
        /* ping dos servidores: TCP cru + SRV */
        'net', 'dns', 'dns/promises'
      ],
    },
  },
});