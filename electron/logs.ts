/* ============================================================
   LOGS DAS SESSOES

   O jogo ja grava um arquivo por sessao em <gameDir>/logs, com o
   nome xyven-<carimbo>.log, e o minecraft.ts guarda os 10 mais
   recentes. Aqui e so a leitura: listar e abrir.

   O CENSOR e a parte que importa.

   A terceira linha de todo log e `# args:`, e dentro dela vai o
   --accessToken da sessao — a chave que entra na conta da pessoa.
   Quem manda um log pedindo ajuda esta mandando isso junto, e ja
   aconteceu aqui: um log colado no chat trazia um token vivo.

   Por isso o token sai na LEITURA, e nao so na copia. Se saisse so
   na copia, um print da tela ainda o entregaria — e print e
   justamente como as pessoas pedem ajuda.
   ============================================================ */
import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';

export type Registro = {
  arquivo: string;     /* so o nome, nunca caminho */
  quando: number;      /* epoch ms — quem formata e a interface */
  tamanho: number;
};

/* So os nossos, e so o nome. Vale de filtro da listagem e de
   validacao na leitura: com isto nenhum caminho de fora daqui passa,
   nem `..\\..\\alguma coisa`. */
const NOSSO = /^xyven-[\w-]+\.log$/;

const pastaLogs = (gameDir: string) => join(gameDir, 'logs');

export async function listar(gameDir: string): Promise<Registro[]> {
  let nomes: string[];
  try {
    nomes = await readdir(pastaLogs(gameDir));
  } catch {
    return [];                    /* nunca jogou por aqui */
  }

  const achados: Registro[] = [];
  for (const nome of nomes) {
    if (!NOSSO.test(nome)) continue;
    try {
      const s = await stat(join(pastaLogs(gameDir), nome));
      achados.push({ arquivo: nome, quando: s.mtimeMs, tamanho: s.size });
    } catch { /* sumiu no meio da listagem */ }
  }
  /* mais novo primeiro: e o que a pessoa quer ver quando o jogo
     acabou de fechar sozinho */
  return achados.sort((a, b) => b.quando - a.quando);
}

/* ------------------------------------------------------------
   Tira o que nao pode sair daqui

   --accessToken vem como dois tokens separados por espaco na linha
   de args. Tambem cobre a forma `--accessToken=valor`, que nao e a
   que geramos hoje mas custaria caro descobrir depois.

   O uuid fica: sem ele nao da pra saber de qual conta era o crash, e
   uuid e publico — qualquer um descobre pelo nick.
   ------------------------------------------------------------ */
export function censurar(texto: string): string {
  return String(texto)
    .replace(/(--accessToken[= ])\S+/g, '$1<removido>')
    /* o token da sessao tambem aparece cru em algumas mensagens de
       erro do proprio jogo, sem a bandeira na frente */
    .replace(/\b(ey[A-Za-z0-9_-]{20,})\b/g, '<removido>');
}

export async function ler(gameDir: string, arquivo: string) {
  if (!NOSSO.test(arquivo)) return { ok: false as const, erro: 'arquivo inválido.' };
  try {
    const bruto = await readFile(join(pastaLogs(gameDir), arquivo), 'utf8');
    return { ok: true as const, texto: censurar(bruto) };
  } catch (e: any) {
    return { ok: false as const, erro: 'não consegui abrir: ' + (e?.message || e) };
  }
}
