import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { builtinModules } from 'module';

/* A versao vem daqui, nao de app.getVersion().

   Rodando `electron arquivo.js` em desenvolvimento, o Electron nao
   encontra o package.json do app e devolve a versao DELE (28.3.3).
   Com isso a checagem de atualizacao concluia "ja esta na mais nova"
   sempre — e nunca dava pra testar isso sem empacotar.

   Empacotado o valor e o mesmo que app.getVersion() devolveria. */
const pacote = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
const versao = pacote.version;

/* TODA dependencia fica fora do bundle, e nao so as que ja morderam.

   O electron-builder ja copia node_modules pra dentro do .exe, entao
   o require do Node acha tudo em tempo de execucao. Empacotar traz
   so risco: foi assim que o `ws` perdeu a funcao `mask` (o Rollup
   converte errado `module.exports = {}` seguido de reatribuicao) e
   foi assim que o helper de namespace engasgou em estatico herdado.

   As deps do renderer aparecem nesta lista tambem e nao faz mal: o
   main nao importa nenhuma delas, entao nunca viram require. */
const dependencias = Object.keys(pacote.dependencies || {});

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
  /* Isto e codigo de Node (processo principal do Electron), nao de
     navegador. Por padrao o Vite tenta o campo `browser` do
     package.json primeiro, e o `ws` aponta esse campo pra um arquivo
     de tres linhas que so lanca "ws does not work in the browser".
     Era ele que ia dentro do .exe no lugar da implementacao real, e o
     tempo real morria com esse erro. */
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext', 'main'],
    conditions: ['node', 'require', 'default']
  },
  /* ssr: e o jeito canonico de dizer "isto roda em Node".
     Sozinho ja evitaria o campo `browser` do package.json das deps —
     que foi o que trocou o `ws` de verdade por um stub de tres linhas
     cujo unico conteudo era lancar um erro. O mainFields abaixo fica
     como cinto e suspensorio. */
  ssr: true,
  build: {
    lib: {
      entry: resolve(__dirname, 'electron/main.ts'),
      formats: ['cjs'],
      fileName: 'main',
    },
    outDir: '.vite/build',
    emptyOutDir: false,
    rollupOptions: {
      /* TODO modulo nativo do Node fica externo, e nao uma lista
         escrita a mao.

         A lista a mao esquecia justamente o que uma dependencia nova
         fosse precisar: o `ws` usa http, https, tls e url, nenhum
         deles estava aqui, e o Vite deixou stub vazio no lugar. O
         erro que saia era "Right-hand side of 'instanceof' is not an
         object", que nao aponta pra nada. */
      external: [
        'electron',
        /^node:/,
        ...builtinModules,
        ...dependencias,
      ],
    },
  },
});