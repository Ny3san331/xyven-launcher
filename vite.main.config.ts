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

/* Chave `anon` do Supabase: publica por natureza, so le, e o RLS e
   quem manda. Vem de .env pra nao ficar no git — nao por ser
   segredo, mas pra quem clonar o projeto apontar pro banco dele.
   Sem ela o launcher funciona; so perde o aviso em tempo real. */
let anon = process.env.SUPABASE_ANON_KEY || '';
if (!anon) {
  try {
    const env = readFileSync(resolve(__dirname, '.env'), 'utf8');
    const achou = env.match(/^\s*SUPABASE_ANON_KEY\s*=\s*(.+)\s*$/m);
    if (achou) anon = achou[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* sem .env: segue sem tempo real */ }
}
if (!anon) console.warn('[build] sem SUPABASE_ANON_KEY — tempo real desligado nesta build');

export default defineConfig({
  define: {
    __VERSAO__: JSON.stringify(versao),
    __ANON__: JSON.stringify(anon)
  },
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