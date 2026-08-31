import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/* A versao vem daqui, nao de app.getVersion().

   Rodando `electron arquivo.js` em desenvolvimento, o Electron nao
   encontra o package.json do app e devolve a versao DELE (28.3.3).
   Com isso a checagem de atualizacao concluia "ja esta na mais nova"
   sempre — e nunca dava pra testar isso sem empacotar.

   Empacotado o valor e o mesmo que app.getVersion() devolveria. */
const versao = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  define: { __VERSAO__: JSON.stringify(versao) },
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