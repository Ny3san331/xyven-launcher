/* ============================================================
   Permissões

   O catálogo é fixo: cada entrada corresponde a uma coisa que o
   launcher realmente tranca. Inventar permissão que nada consulta
   só criaria a ilusão de controle — e ninguém descobriria que não
   funciona até precisar.

   Quem manda é o CARGO. Não há mais `grupo` mandando em nada: se a
   pessoa tem o cargo, tem a etiqueta; se tem a etiqueta, tem o que
   o cargo carrega.
   ============================================================ */
import { admin, erro, type Identidade } from './comum.ts';

export const PERMISSOES: { id: string; oque: string }[] = [
  { id: '*',              oque: 'tudo, inclusive o que for criado depois' },
  { id: 'terminal',       oque: 'abrir o terminal (Ctrl+Shift+E)' },
  { id: 'gift',           oque: 'dar e tirar cargo e capa' },
  { id: 'title',          oque: 'mandar recado pra alguém' },
  { id: 'cargos',         oque: 'criar, editar e apagar cargo' },
  { id: 'posts.escrever', oque: 'escrever e editar no mural' },
  { id: 'posts.fixar',    oque: 'fixar e destacar postagem' },
  { id: 'posts.apagar',   oque: 'apagar postagem' }
];

export const permValida = (p: string) => PERMISSOES.some((x) => x.id === p);

export const CORES = ['teal', 'salmon', 'mustard', 'sand', 'ink', 'red', 'muted', 'paper'];

/* id de cargo: 2 a 20, minusculo, sem espaco. Serve de chave e vai
   parar em array no banco, entao nada de virgula nem maiuscula. */
export const idValido = (id: string) => /^[a-z0-9_-]{2,20}$/.test(String(id));

/* Junta as permissoes de uma lista de cargos. Separado de
   permissoesDe porque /consultar ja tem a lista em maos e nao tem
   uuid confiavel pra usar (conta offline). */
export async function permissoesDeCargos(
  sb: ReturnType<typeof admin>,
  ids: string[]
): Promise<string[]> {
  if (!ids || !ids.length) return [];
  const { data } = await sb.from('cargos').select('permissoes').in('id', ids);
  const fora = new Set<string>();
  for (const c of data || []) for (const x of (c.permissoes || [])) fora.add(x);
  return [...fora];
}

/* ------------------------------------------------------------
   O que esta pessoa pode

   Junta as permissoes de todos os cargos dela. Uma consulta so:
   a lista de cargos ja vem na linha do jogador.
   ------------------------------------------------------------ */
export async function permissoesDe(
  sb: ReturnType<typeof admin>,
  quem: Identidade
): Promise<Set<string>> {
  const { data: jogador } = await sb
    .from('jogadores')
    .select('grupo, cargos')
    .eq('uuid', quem.uuid)
    .maybeSingle();

  const fora = new Set<string>();
  if (!jogador) return fora;

  /* Ponte com o modelo antigo.

     Antes de existir a tabela `cargos`, quem mandava era grupo='dev'.
     Sem isto, aplicar a mudanca trancaria o dono do projeto pra fora
     do proprio launcher — e nao haveria como se destrancar, porque
     criar cargo exige permissao. */
  if (jogador.grupo === 'dev') fora.add('*');

  const ids: string[] = jogador.cargos || [];
  if (!ids.length) return fora;

  const { data: cargos } = await sb
    .from('cargos')
    .select('permissoes')
    .in('id', ids);

  for (const c of cargos || []) {
    for (const p of (c.permissoes || [])) fora.add(p);
  }
  return fora;
}

export const pode = (tem: Set<string>, alvo: string) => tem.has('*') || tem.has(alvo);

/* Devolve uma resposta de erro quando NAO pode, ou null quando pode.
   Mesmo formato do antigo exigirDev, pra nao mudar quem chama. */
export async function exigirPerm(
  sb: ReturnType<typeof admin>,
  quem: Identidade,
  alvo: string
) {
  const tem = await permissoesDe(sb, quem);
  if (pode(tem, alvo)) return null;
  return erro('você não tem a permissão "' + alvo + '".', 403);
}
