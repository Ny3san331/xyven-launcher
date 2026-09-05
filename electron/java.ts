/* ============================================================
   Java sob demanda

   Fita velha nao roda em Java novo e fita nova nao roda em Java
   velho — e ate agora o launcher so sabia reclamar. Aqui ele
   resolve: se ja existe um Java compativel instalado, troca; se nao
   existe, baixa o certo e usa.

   De onde vem: Adoptium (Eclipse Temurin), a mesma distribuicao que
   o instalador que voce ja tem na maquina. A API deles entrega o
   binario direto por versao, sem pagina, sem login e sem instalador
   — e um .zip que basta descompactar.

   Fica na pasta de dados do launcher e nao em Arquivos de Programas:
   la exigiria elevacao, e pedir "permitir que este app faca
   alteracoes" no meio de um clique em TOCAR e um jeito rapido de a
   pessoa achar que o launcher e virus.
   ============================================================ */
import { app } from 'electron';
import { mkdir, readdir, rm, stat } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'os';

/* Onde os nossos ficam. O detectarJava tambem olha aqui, entao um
   Java baixado aparece na lista dos Ajustes como qualquer outro. */
export const pastaJavas = () => join(app.getPath('userData'), 'java');

/* So LTS: sao as unicas versoes que a Adoptium mantem publicadas por
   anos. Pedir a 16, que o Minecraft 1.17 aceita, daria 404 — ela saiu
   de suporte. A escolha e sempre a maior que couber na faixa. */
const LTS = [8, 11, 17, 21];

export function versaoParaBaixar(exigido: number, teto: number): number {
  const cabem = LTS.filter((v) => v >= exigido && (!teto || v <= teto));
  return cabem.length ? cabem[cabem.length - 1] : exigido;
}

const urlBinario = (maior: number) =>
  'https://api.adoptium.net/v3/binary/latest/' + maior +
  '/ga/windows/x64/jre/hotspot/normal/eclipse';

/* ------------------------------------------------------------
   Descompactar

   `tar` vem no Windows desde a 1803 e le zip — e rapido. O
   Expand-Archive do PowerShell faz o mesmo, mas item por item: um JRE
   tem uns 20 mil arquivos e ele leva minutos. Fica so de reserva.
   ------------------------------------------------------------ */
function rodar(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let erro = '';
    p.stderr?.on('data', (b) => { erro += String(b); });
    p.on('error', falha);
    p.on('close', (c) => c === 0 ? ok() : falha(new Error(erro.trim() || (cmd + ' saiu com ' + c))));
  });
}

/* Caminho absoluto, e nao 'tar' solto no PATH.

   Quem tem Git instalado tem o GNU tar do MSYS antes do do Windows, e
   ele le "C:\..." como nome de MAQUINA remota:

     tar: Cannot connect to C: resolve failed

   Medido aqui. O do System32 e o bsdtar, que entende caminho do
   Windows e le zip. */
const TAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

async function descompactar(zip: string, destino: string) {
  await mkdir(destino, { recursive: true });
  try {
    await rodar(TAR, ['-xf', zip, '-C', destino]);
  } catch {
    await rodar('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath "' + zip + '" -DestinationPath "' + destino + '" -Force']);
  }
}

/* O zip traz uma pasta so, com nome tipo jdk-17.0.19+10-jre. Acha o
   java.exe sem depender de adivinhar esse nome. */
async function acharExe(raiz: string): Promise<string | null> {
  const direto = join(raiz, 'bin', 'java.exe');
  if (await stat(direto).then(() => true, () => false)) return direto;
  for (const d of await readdir(raiz, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const achado = await acharExe(join(raiz, d.name));
    if (achado) return achado;
  }
  return null;
}

export type PassoJava = (fase: string, pct: number) => void;

/* ------------------------------------------------------------
   Baixa e instala. Devolve o caminho do java.exe.
   ------------------------------------------------------------ */
export async function instalar(maior: number, passo: PassoJava = () => {}): Promise<string> {
  const destino = join(pastaJavas(), String(maior));

  /* ja baixado antes: nao baixa de novo */
  const jaTem = await acharExe(destino).catch(() => null);
  if (jaTem) return jaTem;

  const zip = join(tmpdir(), 'xyven-java-' + maior + '-' + Date.now() + '.zip');
  passo('procurando o Java ' + maior, 0);

  const r = await fetch(urlBinario(maior), { redirect: 'follow' });
  if (!r.ok || !r.body) {
    throw new Error('não achei o Java ' + maior + ' pra baixar (HTTP ' + r.status + ').');
  }

  const total = Number(r.headers.get('content-length') || 0);
  let vindos = 0;
  const fonte = Readable.fromWeb(r.body as any);
  fonte.on('data', (b: Buffer) => {
    vindos += b.length;
    /* sem content-length nao da pra mostrar porcentagem honesta:
       melhor ficar em 0 do que inventar uma barra que anda sozinha */
    passo('baixando o Java ' + maior, total ? Math.floor((vindos / total) * 100) : 0);
  });

  await pipeline(fonte, createWriteStream(zip));

  passo('instalando o Java ' + maior, 100);
  /* pasta suja de uma tentativa que morreu no meio: comeca limpo */
  await rm(destino, { recursive: true, force: true }).catch(() => {});
  await descompactar(zip, destino);
  await rm(zip, { force: true }).catch(() => {});

  const exe = await acharExe(destino);
  if (!exe) {
    await rm(destino, { recursive: true, force: true }).catch(() => {});
    throw new Error('baixei o Java ' + maior + ' mas não achei o java.exe dentro.');
  }
  return exe;
}
