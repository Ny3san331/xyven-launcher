/* ============================================================
   Peças compartilhadas pelas Edge Functions do Xyven.

   Todas as rotas seguem a mesma forma: recebem o token da
   Minecraft no header `x-mc-token`, perguntam pra Mojang de quem
   é, e só então fazem alguma coisa.

   Por que header próprio em vez de Authorization: o Supabase, por
   padrão, tenta validar um JWT dele no Authorization. Como o nosso
   token é da Microsoft, os dois brigariam. As funções são
   publicadas com --no-verify-jwt e a autenticação é esta aqui.
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MC_PERFIL = 'https://api.minecraftservices.com/minecraft/profile';
const MOJANG_NICK = 'https://api.mojang.com/users/profiles/minecraft/';

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

   O cache vive na memória da instância: some quando a função
   recicla. Isso é aceitável, o pior caso é uma consulta a mais.
   NUNCA guardamos o token em banco — ele serve pra perguntar quem
   é e é descartado.
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
  return data;
}

/* ------------------------------------------------------------
   só dev passa daqui
   ------------------------------------------------------------ */
export async function exigirDev(sb: ReturnType<typeof admin>, quem: Identidade) {
  const { data } = await sb.from('jogadores').select('grupo').eq('uuid', quem.uuid).maybeSingle();
  if (!data || data.grupo !== 'dev') return erro('só quem é dev pode fazer isso.', 403);
  return null;
}

/* ------------------------------------------------------------
   nick -> uuid, pra dar item a quem ainda não abriu o launcher
   ------------------------------------------------------------ */
export async function uuidDoNick(nick: string): Promise<Identidade | null> {
  let r: Response;
  try {
    r = await fetch(MOJANG_NICK + encodeURIComponent(nick));
  } catch {
    return null;
  }
  if (!r.ok) return null;                    /* 404 = nick não existe na Mojang */
  const j = await r.json();
  if (!j?.id) return null;
  return { uuid: String(j.id), nick: String(j.name || nick) };
}

/* ------------------------------------------------------------
   resolve o alvo de um comando: já cadastrado, ou novo pela Mojang
   ------------------------------------------------------------ */
export async function acharAlvo(sb: ReturnType<typeof admin>, nick: string) {
  const { data } = await sb
    .from('jogadores')
    .select('*')
    .ilike('nick', nick)
    .maybeSingle();
  if (data) return data;

  /* Conta pirata não chega aqui: ela não existe na Mojang, então
     não tem UUID. É de propósito — sem identidade verificável,
     qualquer um que digitasse o nick receberia o item. */
  const quem = await uuidDoNick(nick);
  if (!quem) return null;

  const { data: novo, error } = await sb
    .from('jogadores')
    .upsert({ uuid: quem.uuid, nick: quem.nick }, { onConflict: 'uuid' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return novo;
}

/* 'cargo' | 'capa' | null */
export function tipoDoItem(item: string): 'cargo' | 'capa' | null {
  if (CARGOS.includes(item)) return 'cargo';
  if (CAPAS.includes(item)) return 'capa';
  return null;
}
