/* ============================================================
   Campainha em tempo real

   Quando um dev usa /gift ou /title, a Edge Function carimba
   `mudou_em` na linha do alvo em `jogadores`. Aqui escutamos a
   linha DAQUELA conta e avisamos o renderer, que refaz a consulta
   normal — a mesma que ele já faz no boot.

   O evento não carrega conteúdo. Ele diz "olha de novo", e ponto.
   Foi de propósito: escutar `avisos` direto exigiria deixar aquela
   tabela pública, e aí qualquer um com a chave anon leria todo
   recado privado já enviado. `jogadores` já é pública por decisão
   (nick, cargos, capas não são segredo de ninguém).

   A chave `anon` vai dentro do .exe. Isso é normal e previsto: ela
   é a chave PÚBLICA do projeto, só lê, e o RLS é quem manda. Nada
   de service_role aqui — essa nunca sai do servidor.
   ============================================================ */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
/* O processo principal do Electron 28 roda Node 18.18, que NAO tem
   WebSocket global — so chegou no Node 22. O supabase-js procura o
   global, nao acha e LANCA. O erro morria dentro do ipcMain.handle e
   o renderer engolia no .catch(), entao o tempo real simplesmente
   nao existia e nada aparecia em lugar nenhum.

   Testar com `node` nao pegava isso: o Node novo tem o global. */
import { createRequire } from 'module';

/* Carregado com createRequire, e nao com import.

   O processo principal do Electron 28 roda Node 18.18, que nao tem
   WebSocket global — so chegou no Node 22. Sem isso o supabase-js
   lanca e o tempo real nunca sobe.

   Mas `import * as WS from 'ws'` tambem nao serve: o helper de
   interop do Vite percorre `for..in` (que anda pelo prototipo) e
   pergunta getOwnPropertyDescriptor (que so ve propriedade propria).
   Como a classe do ws herda estaticos do EventEmitter, o descritor
   vem undefined e o app morria antes de abrir, com "Cannot read
   properties of undefined (reading 'get')".

   createRequire nao gera helper nenhum: e o require do Node, cru. */
const exigir = createRequire(__filename);
const WebSocketNode: any = exigir('ws');

const URL = 'https://oxuseyipoicgwolbjyzt.supabase.co';

/* preenchida no build (vite.main.config.ts, a partir de SUPABASE_ANON_KEY) */
declare const __ANON__: string;
const ANON = typeof __ANON__ === 'string' ? __ANON__ : '';

let cliente: SupabaseClient | null = null;
let canal: RealtimeChannel | null = null;
let escutando = '';

/* Sem chave o launcher continua funcionando: ele só volta a
   descobrir as novidades no próximo boot, como era antes. */
export const ligado = () => !!ANON;

function conectar(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        params: { eventsPerSecond: 2 },
        transport: WebSocketNode
      }
    });
  }
  return cliente;
}

/* ------------------------------------------------------------
   Passa a escutar a conta `nick`. Chamar de novo com o mesmo nick
   não faz nada — o renderer chama isto a cada sincronização.
   ------------------------------------------------------------ */
export function seguir(nick: string, aoMudar: () => void) {
  const alvo = String(nick || '').trim().toLowerCase();
  if (!ANON || !alvo) return;
  if (alvo === escutando && canal) return;

  parar();
  escutando = alvo;

  let sb: SupabaseClient;
  try {
    sb = conectar();
  } catch (e: any) {
    /* Falar alto: a versao anterior falhava aqui em silencio e o
       sintoma era "o tempo real nao funciona", sem nenhuma pista. */
    console.error('[xyven] realtime nao subiu:', e?.message || e);
    escutando = '';
    return;
  }

  canal = sb
    .channel('conta:' + alvo)
    .on(
      'postgres_changes',
      /* Sem filtro do servidor de propósito: ele é exato e sensível
         a maiúscula, e o nick vem gravado como a pessoa digitou —
         "_Xvu" na tabela nunca casaria com "_xvu" aqui. Comparar do
         lado de cá custa nada e nunca erra.

         Não vaza nada: `jogadores` já é de leitura pública, e o que
         chega é nick, cargos e capas — o mesmo que qualquer um lê
         com /account info. */
      { event: 'UPDATE', schema: 'public', table: 'jogadores' },
      (ev: any) => {
        const quem = String(ev?.new?.nick || '').trim().toLowerCase();
        if (quem === escutando) aoMudar();
      }
    )
    /* Logar o status era o que faltava pra enxergar. Sem isto a falha
       era invisivel: o canal ficava em CHANNEL_ERROR e a tela so
       parecia "nao atualizar sozinha", sem nenhuma pista de onde
       olhar. SUBSCRIBED = vivo; CLOSED e CHANNEL_ERROR = nao chega
       nada. */
    .subscribe((estado, erro) => {
      console.log('[realtime] conta ' + alvo + ': ' + estado +
        (erro ? ' — ' + (erro.message || erro) : ''));
    });
}

/* ------------------------------------------------------------
   Mural do Lado B.

   Canal separado do da conta: este nao depende de quem esta logado,
   entao nao precisa ser refeito a cada troca de conta.

   Aqui escutamos a tabela DIRETO, sem campainha intermediaria — dá
   pra fazer porque `postagens` tem leitura publica de propósito: é
   mural. O que chega pelo WebSocket é o mesmo que qualquer um lê
   pedindo a lista.
   ------------------------------------------------------------ */
let canalPosts: RealtimeChannel | null = null;

export function seguirPosts(aoMudar: () => void) {
  if (!ANON || canalPosts) return;
  let sb: SupabaseClient;
  try {
    sb = conectar();
  } catch (e: any) {
    console.error('[realtime] mural nao subiu:', e?.message || e);
    return;
  }
  canalPosts = sb
    .channel('postagens')
    .on(
      'postgres_changes',
      /* '*' pega INSERT, UPDATE e DELETE: fixar, destacar e apagar
         precisam chegar tanto quanto escrever */
      { event: '*', schema: 'public', table: 'postagens' },
      () => aoMudar()
    )
    /* cargo criado, editado ou apagado muda a etiqueta de todo mundo */
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cargos' },
      () => aoMudar()
    )
    /* item ou categoria nova aparece pra todo mundo na hora */
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cosmeticos' },
      () => aoMudar()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'categorias' },
      () => aoMudar()
    )
    .subscribe((estado, erro) => {
      console.log('[realtime] mural: ' + estado +
        (erro ? ' — ' + (erro.message || erro) : ''));
    });
}

export function parar() {
  if (canal && cliente) {
    try { cliente.removeChannel(canal); } catch { /* já caiu */ }
  }
  canal = null;
  escutando = '';
}
