/* ============================================================
   API do Xyven (Supabase Edge Functions)

   Guarda cargos e capas num lugar só, pra que dar um item pra
   alguém valha no launcher DAQUELA pessoa, em qualquer PC.

   Autenticação: o token da Minecraft vai no header `x-mc-token`.
   A função pergunta pra Mojang de quem é aquele token e confia no
   UUID que voltar. Não há chave do Supabase aqui — as funções são
   publicadas sem verificação de JWT, e a segurança inteira está na
   verificação com a Mojang, do lado do servidor.
   ============================================================ */
const BASE = 'https://oxuseyipoicgwolbjyzt.supabase.co/functions/v1';

/* 8s: a função dorme no plano grátis e a primeira chamada do dia
   demora. Menos que isso derrubaria justo o primeiro boot. */
const LIMITE_MS = 8000;

export type Conta = {
  uuid: string;
  nick: string;
  grupo: string;
  cargos: string[];
  capas: string[];
};

export type Resposta<T> =
  | { ok: true; dados: T }
  /* `fora` separa "o servidor disse não" de "não consegui falar com ele".
     Sem essa distinção, uma queda de rede pareceria remoção de cargo. */
  | { ok: false; erro: string; fora?: boolean };

async function chamar<T>(rota: string, token: string, corpo?: unknown): Promise<Resposta<T>> {
  if (!token) return { ok: false, erro: 'sem sessão da Microsoft.', fora: true };
  /* rota publica: manda o header mesmo assim, ela ignora */

  const parar = new AbortController();
  const relogio = setTimeout(() => parar.abort(), LIMITE_MS);

  try {
    const r = await fetch(BASE + '/' + rota, {
      method: 'POST',
      headers: { 'x-mc-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo || {}),
      signal: parar.signal
    });

    const texto = await r.text();
    let j: any = null;
    try { j = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

    if (!r.ok) {
      const msg = (j && j.erro) || ('a API respondeu ' + r.status + '.');
      /* 5xx é problema do servidor ou da Mojang, não resposta sobre a conta */
      return { ok: false, erro: msg, fora: r.status >= 500 };
    }
    return { ok: true, dados: j as T };
  } catch (e: any) {
    const abortou = e?.name === 'AbortError';
    return {
      ok: false,
      erro: abortou ? 'a API demorou demais pra responder.' : 'não consegui falar com a API.',
      fora: true
    };
  } finally {
    clearTimeout(relogio);
  }
}

export const identificar = (token: string) => chamar<Conta>('identificar', token);

/* Leitura publica, sem token: e o unico jeito de uma conta pirata
   descobrir o que ganhou. Ela nao tem o que provar pra Mojang, entao
   /identificar nunca funcionaria pra ela. */
export const consultar = (nick: string, registrar = false) =>
  chamar<Conta>('consultar', 'sem-token', { nick, registrar });

export const gift = (token: string, alvo: string, item: string, acao: 'dar' | 'tirar' = 'dar') =>
  chamar<{
    nick: string; item: string; tipo: string;
    jaTinha?: boolean; naoTinha?: boolean; pendente?: boolean; recado?: string;
  }>('gift', token, { alvo, item, acao });

export const title = (token: string, alvo: string, titulo: string, texto: string) =>
  chamar<{ nick: string; aviso: { id: number; titulo: string; texto: string } }>(
    'title', token, { alvo, titulo, texto });

export type Post = {
  id: number; titulo: string; corpo: string; tag: string;
  fixado: boolean; destaque: boolean; autor_nick: string;
  criado_em: string; editado_em: string | null;
};

/* Leitura publica: o mural aparece pra quem nao e dev, e pra conta
   pirata, que nao tem token pra provar nada. */
export const listarPosts = () =>
  chamar<{ posts: Post[] }>('posts', 'sem-token', { acao: 'listar' });

export const post = (token: string, corpo: Record<string, unknown>) =>
  chamar<{ post?: Post; id?: number }>('posts', token, corpo);

export type Cargo = {
  id: string; nome: string; cor: string; permissoes: string[]; criado_em: string;
};

/* Leitura publica: o launcher precisa do nome e da cor de todo cargo
   pra desenhar a etiqueta de qualquer jogador, inclusive sem login. */
export const listarCargos = () =>
  chamar<{ cargos: Cargo[] }>('cargo', 'sem-token', { acao: 'listar' });

export const cargo = (token: string, corpo: Record<string, unknown>) =>
  chamar<{ cargo?: Cargo; id?: string; tirados?: number }>('cargo', token, corpo);

export const grupo = (token: string, alvo: string, grupo: string) =>
  chamar<{ nick: string; grupo: string }>('grupo', token, { alvo, grupo });
