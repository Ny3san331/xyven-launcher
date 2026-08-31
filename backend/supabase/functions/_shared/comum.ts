/* ============================================================
   Peças compartilhadas pelas Edge Functions do Xyven.

   Rotas de escrita recebem o token da Minecraft no header
   `x-mc-token`, perguntam pra Mojang de quem é, e só então agem.

   Por que header próprio em vez de Authorization: o Supabase, por
   padrão, tenta validar um JWT dele no Authorization. Como o nosso
   token é da Microsoft, os dois brigariam. As funções são
   publicadas com --no-verify-jwt e a autenticação é esta aqui.
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MC_PERFIL = 'https://api.minecraftservices.com/minecraft/profile';

/* Ids que existem no launcher. Qualquer coisa fora daqui é recusada:
   sem isso, um erro de digitação vira um cargo fantasma que não
   aparece em lugar nenhum e ninguém entende por quê. */
export const CARGOS = ['dev', 'fundador', 'pro', 'beta', 'campeao'];
export const CAPAS = ['caveira', 'moonlight', 'broken', 'enderman'];

export type Identidade = { uuid: string; nick: string };

/* ------------------------------------------------------------
   cliente com service_role: ignora RLS, só existe aqui dentro
   ------------------------------------------------------------ */
export function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

/* ------------------------------------------------------------
   respostas
   ------------------------------------------------------------ */
export const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

export const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);

/* ------------------------------------------------------------
   quem está pedindo

   O token vale ~24h e o launcher chama /identificar a cada boot.
   Guardar o resultado por alguns minutos evita bater na Mojang a
   cada requisição — e a Mojang limita quem insiste.

   O cache vive na memória da instância: some quando ela recicla.
   Aceitável, o pior caso é uma consulta a mais. O token NUNCA é
   gravado: serve pra perguntar quem é, e é descartado.
   ------------------------------------------------------------ */
const cache = new Map<string, { quem: Identidade; ate: number }>();
const CACHE_MS = 5 * 60 * 1000;

async function chaveDe(token: string): Promise<string> {
  /* o token não vira chave direto: se algum log vazar o Map, não
     quero o token legível nele */
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function quemEh(req: Request): Promise<Identidade | Response> {
  const token = req.headers.get('x-mc-token');
  if (!token) return erro('falta o header x-mc-token.', 401);

  const chave = await chaveDe(token);
  const guardado = cache.get(chave);
  if (guardado && guardado.ate > Date.now()) return guardado.quem;

  let r: Response;
  try {
    r = await fetch(MC_PERFIL, { headers: { Authorization: 'Bearer ' + token } });
  } catch {
    /* rede caiu: 503, NUNCA uma resposta vazia. O launcher precisa
       distinguir "não consegui confirmar" de "você não tem nada" —
       senão uma instabilidade da Mojang some com os cargos de todos. */
    return erro('não consegui falar com a Mojang. tente de novo em instantes.', 503);
  }

  if (r.status === 401 || r.status === 403) return erro('token inválido ou expirado.', 401);
  if (!r.ok) return erro('a Mojang respondeu ' + r.status + '.', 503);

  const perfil = await r.json();
  if (!perfil?.id || !perfil?.name) return erro('a Mojang devolveu um perfil sem id.', 503);

  const quem: Identidade = { uuid: String(perfil.id), nick: String(perfil.name) };
  cache.set(chave, { quem, ate: Date.now() + CACHE_MS });
  return quem;
}

/* ------------------------------------------------------------
   só dev passa daqui
   ------------------------------------------------------------ */
export async function exigirDev(sb: ReturnType<typeof admin>, quem: Identidade) {
  const { data } = await sb.from('jogadores').select('grupo').eq('uuid', quem.uuid).maybeSingle();
  if (!data || data.grupo !== 'dev') return erro('só quem é dev pode fazer isso.', 403);
  return null;
}

/* ============================================================
   ALVO DE UM /gift — sempre por NICK, nunca pela Mojang

   Resolver o nick na Mojang parecia certo e não era: nick de conta
   offline costuma existir lá como conta de OUTRA pessoa, e o item
   ia calado pro estranho. Aconteceu de verdade uma vez.

   Agora: se já existe alguém com aquele nick na tabela, o item vai
   pra ele. Se não existe, fica PENDENTE até alguém entrar no
   launcher com aquele nome — premium ou pirata, quem chegar.

   Consequência assumida: nick é reivindicável. Serve pra cosmético.
   Nunca pra permissão — grupo exige conta que já se identificou.
   ============================================================ */
export const chaveNick = (nick: string) => String(nick).trim().toLowerCase();

export const comItem = (lista: string[] | null, item: string) =>
  (lista || []).includes(item) ? [...(lista || [])] : [...(lista || []), item];

export const semItem = (lista: string[] | null, item: string) =>
  (lista || []).filter((x) => x !== item);

export const tipoDoItem = (item: string): 'cargo' | 'capa' | null =>
  CARGOS.includes(item) ? 'cargo' : (CAPAS.includes(item) ? 'capa' : null);

/* Conta offline entra na tabela com uuid sintetico. Serve pra ela
   aparecer na lista e guardar cosmetico; nao vale como identidade. */
export const UUID_PIRATA = (nick: string) => 'pirata:' + chaveNick(nick);
export const ehLinhaPirata = (uuid: string) => String(uuid).startsWith('pirata:');

/* 3 a 16, letras, numeros e _. Barra lixo antes de virar linha no
   banco: /consultar e publico, e sem isto um script encheria a tabela
   com qualquer string. */
export const nickValido = (nick: string) => /^[A-Za-z0-9_]{3,16}$/.test(String(nick).trim());

/* Quem tem este nick. Podem existir dois — o premium de verdade e um
   homonimo offline. O premium ganha: ele provou quem e. */
export async function acharJogador(sb: ReturnType<typeof admin>, nick: string) {
  const { data } = await sb.from('jogadores').select('*').ilike('nick', chaveNick(nick));
  if (!data || !data.length) return null;
  return data.find((j: any) => !ehLinhaPirata(j.uuid)) || data[0];
}

/* cria (ou atualiza a data de) a linha de uma conta offline */
export async function registrarPirata(sb: ReturnType<typeof admin>, nick: string) {
  if (!nickValido(nick)) return null;
  const { data, error } = await sb
    .from('jogadores')
    .upsert(
      { uuid: UUID_PIRATA(nick), nick: String(nick).trim(), grupo: 'player',
        visto_em: new Date().toISOString() },
      { onConflict: 'uuid' }
    )
    .select()
    .single();
  if (error) return null;
  return data;
}

/* ------------------------------------------------------------
   pendentes
   ------------------------------------------------------------ */
export async function lerPendente(sb: ReturnType<typeof admin>, nick: string) {
  const { data } = await sb.from('pendentes').select('*').eq('nick', chaveNick(nick)).maybeSingle();
  return data || null;
}

export async function guardarPendente(
  sb: ReturnType<typeof admin>,
  nick: string,
  item: string,
  tipo: 'cargo' | 'capa',
  acao: 'dar' | 'tirar',
  porUuid: string
) {
  const chave = chaveNick(nick);
  const atual = await lerPendente(sb, chave);
  const coluna = tipo === 'cargo' ? 'cargos' : 'capas';
  const lista = acao === 'dar'
    ? comItem(atual?.[coluna] ?? [], item)
    : semItem(atual?.[coluna] ?? [], item);

  const linha = {
    nick: chave,
    cargos: coluna === 'cargos' ? lista : (atual?.cargos ?? []),
    capas: coluna === 'capas' ? lista : (atual?.capas ?? []),
    por_uuid: porUuid
  };

  /* nada sobrou: some com a linha em vez de deixar registro vazio */
  if (!linha.cargos.length && !linha.capas.length) {
    await sb.from('pendentes').delete().eq('nick', chave);
    return { vazio: true };
  }

  const { error } = await sb.from('pendentes').upsert(linha, { onConflict: 'nick' });
  if (error) throw new Error(error.message);
  return { vazio: false };
}

/* Entrega o que estava guardado e apaga o pendente.
   Chamado quando alguém se identifica com aquele nick. */
export async function reclamarPendentes(
  sb: ReturnType<typeof admin>,
  uuid: string,
  nick: string,
  atual: { cargos?: string[] | null; capas?: string[] | null }
) {
  const p = await lerPendente(sb, nick);
  if (!p) return null;

  const cargos = Array.from(new Set([...(atual.cargos || []), ...(p.cargos || [])]));
  const capas = Array.from(new Set([...(atual.capas || []), ...(p.capas || [])]));

  const { data } = await sb
    .from('jogadores')
    .update({ cargos, capas })
    .eq('uuid', uuid)
    .select()
    .single();

  await sb.from('pendentes').delete().eq('nick', chaveNick(nick));
  return data;
}

/* ------------------------------------------------------------
   garante a linha do jogador e devolve o estado atual
   ------------------------------------------------------------ */
export async function garantirJogador(sb: ReturnType<typeof admin>, quem: Identidade) {
  const { data, error } = await sb
    .from('jogadores')
    .upsert(
      { uuid: quem.uuid, nick: quem.nick, visto_em: new Date().toISOString() },
      { onConflict: 'uuid' }
    )
    .select()
    .single();
  if (error) throw new Error(error.message);

  /* entrou com este nick: leva o que estava esperando por ele */
  const comPendente = await reclamarPendentes(sb, quem.uuid, quem.nick, data);
  return comPendente || data;
}
