/* ============================================================
   PRINTS DO JOGO

   O Minecraft salva as capturas do F2 em <gameDir>/screenshots.
   Como o launcher roda com --gameDir apontando pro perfil, a pasta
   fica em .minecraft/.xyven/screenshots.

   A listagem devolve só nome e data. A imagem em si vem por outra
   chamada, uma de cada vez: uma screenshot de 1080p pesa alguns MB,
   e carregar trinta de uma vez pra mostrar uma seria jogar dezenas
   de MB no processo da janela à toa.
   ============================================================ */
import { readdir, stat, readFile } from 'fs/promises';
import { join, basename, extname } from 'path';

export type Print = {
  arquivo: string;      /* só o nome, nunca caminho */
  quando: number;       /* epoch ms — quem formata é a interface */
};

const ehPng = (nome: string) => extname(nome).toLowerCase() === '.png';

function pastaPrints(gameDir: string): string {
  return join(gameDir, 'screenshots');
}

export async function listar(gameDir: string): Promise<Print[]> {
  const pasta = pastaPrints(gameDir);
  let nomes: string[];
  try {
    nomes = await readdir(pasta);
  } catch {
    return [];                       /* pasta não existe: ninguém tirou print ainda */
  }

  const achados: Print[] = [];
  for (const nome of nomes) {
    if (!ehPng(nome)) continue;
    try {
      const s = await stat(join(pasta, nome));
      if (s.isFile()) achados.push({ arquivo: nome, quando: s.mtimeMs });
    } catch { /* sumiu no meio da listagem */ }
  }

  /* mais recente primeiro: é a que o hero mostra */
  achados.sort((a, b) => b.quando - a.quando);
  return achados;
}

/* Caminho absoluto de uma print, ou null se o nome não presta.
   Serve pra quem precisa do arquivo em si — copiar pra área de
   transferência, por exemplo — em vez do conteúdo em base64. */
export function caminhoDe(gameDir: string, arquivo: string): string | null {
  const nome = basename(String(arquivo || ''));
  if (!nome || !ehPng(nome)) return null;
  return join(pastaPrints(gameDir), nome);
}

export async function ler(gameDir: string, arquivo: string): Promise<string | null> {
  /* basename descarta qualquer "../" que venha junto. O nome chega da
     interface, e a interface recebeu da listagem — mas confiar nisso
     seria confiar que ninguém mexeu no meio do caminho. */
  const nome = basename(String(arquivo || ''));
  if (!nome || !ehPng(nome)) return null;

  try {
    const bytes = await readFile(join(pastaPrints(gameDir), nome));
    return 'data:image/png;base64,' + bytes.toString('base64');
  } catch {
    return null;
  }
}
