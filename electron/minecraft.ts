/* ============================================================
   MOTOR DO MINECRAFT — baixar, conferir e abrir.
   Roda só no processo principal. Nada aqui toca o renderer.
   Sem dependência externa: tudo com módulo nativo do Node.
   ============================================================ */
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, readFile, writeFile, rename, stat, unlink, readdir, open, appendFile } from 'fs/promises';
import { join, dirname, delimiter } from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { inflateRawSync } from 'zlib';
import { totalmem } from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const MANIFESTO = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const RECURSOS = 'https://resources.download.minecraft.net';
const PARALELO = 12; /* assets sao milhares de arquivos pequenos */

export type Progresso = {
  fase: string;
  arquivosProntos: number;
  arquivosTotal: number;
  bytesProntos: number;
  bytesTotal: number;
};

export type OpcoesLancar = {
  versao: string;
  memoriaMb: number;
  javaPath: string;
  /* instalacao compartilhada (o .minecraft): versions/, libraries/, assets/ */
  gameDir: string;
  nick: string;
  /* preenchidos quando houver login Microsoft; vazio = modo offline */
  uuid?: string;
  accessToken?: string;
  userType?: string;
  /* "host" ou "host:porta": o jogo entra direto nesse servidor ao abrir */
  servidor?: string;
  /* argumentos extras da JVM, crus, como a pessoa digitou nos ajustes */
  argsJvm?: string;
};

/* ------------------------------------------------------------
   perfil do launcher: pasta propria dentro do .minecraft, usada como
   --gameDir. Mantem mods, saves, config e options.txt separados do
   Minecraft oficial, mas compartilha versions/, libraries/ e assets/
   com a raiz pra nao baixar nada duas vezes.
   ------------------------------------------------------------ */
export function pastaPerfil(raiz: string): string {
  return join(raiz, '.xyven');
}

/* ------------------------------------------------------------
   utilidades
   ------------------------------------------------------------ */

const existe = (p: string) => stat(p).then(() => true, () => false);

async function sha1Do(caminho: string): Promise<string> {
  const h = createHash('sha1');
  h.update(await readFile(caminho));
  return h.digest('hex');
}

/* uuid do modo offline: mesmo cálculo do Minecraft vanilla
   (md5 de "OfflinePlayer:<nick>", marcado como versão 3) */
export function uuidOffline(nick: string): string {
  const h = createHash('md5').update('OfflinePlayer:' + nick).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/* Resposta de erro tem corpo, e corpo não lido segura a conexão e o
   ouvinte do AbortSignal até o coletor passar. Com milhares de assets
   dividindo um sinal só, isso vira acúmulo de verdade — é a origem do
   "MaxListenersExceededWarning" que aparecia nos downloads. */
async function descartar(r: Response): Promise<void> {
  await r.body?.cancel().catch(() => {});
}

async function baixarJson(url: string, sinal?: AbortSignal): Promise<any> {
  const r = await fetch(url, { signal: sinal });
  if (!r.ok) { await descartar(r); throw new Error(`falhou ao buscar ${url} (HTTP ${r.status})`); }
  return r.json();
}

/* baixa para .part e só renomeia no fim: download interrompido
   nunca deixa arquivo pela metade passando por bom */
async function baixarArquivo(url: string, destino: string, sinal?: AbortSignal): Promise<number> {
  await mkdir(dirname(destino), { recursive: true });
  const temp = destino + '.part';
  const r = await fetch(url, { signal: sinal });
  if (!r.ok || !r.body) { await descartar(r); throw new Error(`download falhou: ${url} (HTTP ${r.status})`); }
  await pipeline(Readable.fromWeb(r.body as any), createWriteStream(temp));
  await rename(temp, destino);
  return (await stat(destino)).size;
}

/* pula o que já está no disco com o hash certo — é isso que faz
   a segunda execução ser instantânea */
async function garantir(
  url: string, destino: string, sha1: string | undefined, sinal?: AbortSignal
): Promise<{ baixou: boolean; bytes: number }> {
  if (await existe(destino)) {
    if (!sha1) return { baixou: false, bytes: (await stat(destino)).size };
    if ((await sha1Do(destino)) === sha1) return { baixou: false, bytes: (await stat(destino)).size };
    await unlink(destino).catch(() => {});
  }
  const bytes = await baixarArquivo(url, destino, sinal);
  if (sha1) {
    const obtido = await sha1Do(destino);
    if (obtido !== sha1) {
      await unlink(destino).catch(() => {});
      throw new Error(`hash não confere em ${destino}`);
    }
  }
  return { baixou: true, bytes };
}

/* fila com limite de paralelismo; aborta tudo no primeiro erro */
async function emLotes<T>(itens: T[], limite: number, tarefa: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const meu = i++;
      await tarefa(itens[meu]);
    }
  });
  await Promise.all(trabalhadores);
}

/* ------------------------------------------------------------
   ZIP mínimo — só o necessário pra extrair as natives.
   Lê o diretório central e infla cada entrada.
   ------------------------------------------------------------ */
function lerZip(buf: Buffer): { nome: string; dados: Buffer }[] {
  let eocd = -1;
  const limite = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= limite; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('jar de natives inválido (sem diretório central)');

  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const saida: { nome: string; dados: Buffer }[] = [];

  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(off + 10);
    const tamComp = buf.readUInt32LE(off + 20);
    const nomeLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const comentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const nome = buf.toString('utf8', off + 46, off + 46 + nomeLen);

    if (!nome.endsWith('/')) {
      /* o cabeçalho local repete nome/extra com tamanhos próprios */
      const lNome = buf.readUInt16LE(localOff + 26);
      const lExtra = buf.readUInt16LE(localOff + 28);
      const inicio = localOff + 30 + lNome + lExtra;
      const bruto = buf.subarray(inicio, inicio + tamComp);
      saida.push({ nome, dados: metodo === 0 ? Buffer.from(bruto) : inflateRawSync(bruto) });
    }
    off += 46 + nomeLen + extraLen + comentLen;
  }
  return saida;
}

/* ------------------------------------------------------------
   Maven: "net.minecraftforge:forge:1.8.9-11.15.1.2318" vira
   net/minecraftforge/forge/1.8.9-.../forge-1.8.9-....jar
   O Forge descreve as bibliotecas assim, sem bloco de download.
   ------------------------------------------------------------ */
function caminhoMaven(nome: string): string {
  const [grupo, artefato, versao, classificador] = nome.split(':');
  const arquivo = artefato + '-' + versao + (classificador ? '-' + classificador : '') + '.jar';
  return [...grupo.split('.'), artefato, versao, arquivo].join('/');
}

/* ------------------------------------------------------------
   regras de biblioteca (allow/disallow por sistema)
   ------------------------------------------------------------ */
const SO = 'windows';

function regrasPermitem(regras: any[] | undefined): boolean {
  if (!regras || !regras.length) return true;
  let permitido = false;
  for (const r of regras) {
    /* regra sem "os" vale pra todo mundo */
    const casa = !r.os || !r.os.name || r.os.name === SO;
    if (casa) permitido = r.action === 'allow';
  }
  return permitido;
}

function chaveNative(lib: any): string | null {
  const n = lib.natives;
  if (!n) return null;
  const chave = n[SO];
  return chave ? String(chave).replace('${arch}', '64') : null;
}

/* ------------------------------------------------------------
   pipeline
   ------------------------------------------------------------ */

/* Forge/Fabric herdam do JSON da versao base via inheritsFrom.
   O filho manda em mainClass e argumentos; as bibliotecas dele vem
   primeiro no classpath; o client.jar e os assets vem do pai. */
async function resolverHeranca(vjson: any, raiz: string, sinal?: AbortSignal, nivel = 0): Promise<any> {
  if (!vjson.inheritsFrom || nivel > 4) return vjson;
  const pai = await jsonDaVersao(vjson.inheritsFrom, raiz, sinal);

  const juntarArgs = (a: any, b: any) => (a || b) ? [...(b || []), ...(a || [])] : undefined;
  const filho = vjson;
  return Object.assign({}, pai, filho, {
    libraries: [...(filho.libraries || []), ...(pai.libraries || [])],
    downloads: pai.downloads,                    /* client.jar e do pai */
    assetIndex: filho.assetIndex || pai.assetIndex,
    assets: filho.assets || pai.assets,
    mainClass: filho.mainClass || pai.mainClass,
    minecraftArguments: filho.minecraftArguments || pai.minecraftArguments,
    arguments: (filho.arguments || pai.arguments) ? {
      game: juntarArgs(filho.arguments && filho.arguments.game, pai.arguments && pai.arguments.game),
      jvm: juntarArgs(filho.arguments && filho.arguments.jvm, pai.arguments && pai.arguments.jvm)
    } : undefined,
    /* o jar continua sendo o do pai, entao guarda de quem herdou */
    _baseJar: filho.inheritsFrom
  });
}

export async function jsonDaVersao(versao: string, raiz: string, sinal?: AbortSignal): Promise<any> {
  const local = join(raiz, 'versions', versao, `${versao}.json`);
  if (await existe(local)) {
    try { return await resolverHeranca(JSON.parse(await readFile(local, 'utf8')), raiz, sinal); }
    catch { /* corrompido: rebaixa */ }
  }
  const man = await baixarJson(MANIFESTO, sinal);
  const entrada = man.versions.find((v: any) => v.id === versao);
  if (!entrada) {
    /* nome de modpack (Forge/Fabric) nunca esta no manifesto: o que
       falta e a instalacao local, e a mensagem tem que dizer isso. */
    if (/forge|fabric|optifine|quilt|neoforge/i.test(versao)) {
      throw new Error(`a versão ${versao} não está instalada em versions/. ` +
                      `apague a escolha e toque de novo para reinstalar.`);
    }
    throw new Error(`versão ${versao} não existe no manifesto da Mojang`);
  }
  const vjson = await baixarJson(entrada.url, sinal);
  await mkdir(dirname(local), { recursive: true });
  await writeFile(local, JSON.stringify(vjson));
  return vjson;
}

/* versoes ja instaladas no disco — e assim que Forge e Fabric aparecem,
   porque o instalador deles cria a pasta e o launcher nao os instala. */
export async function versoesInstaladas(raiz: string): Promise<{ id: string; herda: string | null }[]> {
  const dir = join(raiz, 'versions');
  const achados: { id: string; herda: string | null }[] = [];
  try {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const j = join(dir, d.name, d.name + '.json');
      if (!(await existe(j))) continue;
      try {
        const v = JSON.parse(await readFile(j, 'utf8'));
        achados.push({ id: d.name, herda: v.inheritsFrom || null });
      } catch { /* json quebrado: ignora */ }
    }
  } catch { /* sem pasta versions */ }
  return achados.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listarVersoes(): Promise<{ id: string; type: string }[]> {
  const man = await baixarJson(MANIFESTO);
  return man.versions.map((v: any) => ({ id: v.id, type: v.type }));
}

type Plano = {
  vjson: any;
  clientJar: string;
  classpath: string[];
  nativesJars: { caminho: string; url: string; sha1?: string; exclude: string[] }[];
  pastaNatives: string;
  baixaveis: { url: string; destino: string; sha1?: string; tamanho: number; opcional?: boolean }[];
  indiceAssets: any;
  assetsDir: string;
};

async function montarPlano(versao: string, raiz: string, sinal?: AbortSignal): Promise<Plano> {
  const vjson = await jsonDaVersao(versao, raiz, sinal);
  const baixaveis: Plano['baixaveis'] = [];
  const classpath: string[] = [];
  const nativesJars: Plano['nativesJars'] = [];

  /* client.jar: numa versao herdada (Forge) o jar e o da versao base */
  const idJar = vjson._baseJar || versao;
  const clientJar = join(raiz, 'versions', idJar, `${idJar}.jar`);
  if (vjson.downloads?.client) {
    baixaveis.push({
      url: vjson.downloads.client.url, destino: clientJar,
      sha1: vjson.downloads.client.sha1, tamanho: vjson.downloads.client.size || 0
    });
  }

  /* bibliotecas */
  for (const lib of vjson.libraries || []) {
    if (!regrasPermitem(lib.rules)) continue;

    const art = lib.downloads?.artifact;
    if (art?.path) {
      const destino = join(raiz, 'libraries', ...art.path.split('/'));
      baixaveis.push({ url: art.url, destino, sha1: art.sha1, tamanho: art.size || 0 });
      classpath.push(destino);
    } else if (lib.name && !lib.natives) {
      /* estilo Forge: so a coordenada. o instalador do Forge normalmente
         ja deixou o arquivo em libraries/, entao isto costuma ser um no-op. */
      const rel = caminhoMaven(lib.name);
      const destino = join(raiz, 'libraries', ...rel.split('/'));
      const base = lib.url || 'https://libraries.minecraft.net/';
      baixaveis.push({ url: base.replace(/\/$/, '') + '/' + rel, destino, sha1: undefined, tamanho: 0, opcional: true });
      classpath.push(destino);
    }

    const chave = chaveNative(lib);
    const cls = chave ? lib.downloads?.classifiers?.[chave] : null;
    if (cls?.path) {
      const destino = join(raiz, 'libraries', ...cls.path.split('/'));
      baixaveis.push({ url: cls.url, destino, sha1: cls.sha1, tamanho: cls.size || 0 });
      nativesJars.push({
        caminho: destino, url: cls.url, sha1: cls.sha1,
        exclude: lib.extract?.exclude || ['META-INF/']
      });
    }
  }

  /* índice de assets */
  const ai = vjson.assetIndex;
  const idxPath = join(raiz, 'assets', 'indexes', `${ai.id}.json`);
  if (!(await existe(idxPath))) {
    await mkdir(dirname(idxPath), { recursive: true });
    await writeFile(idxPath, JSON.stringify(await baixarJson(ai.url, sinal)));
  }
  const indiceAssets = JSON.parse(await readFile(idxPath, 'utf8'));

  for (const [, o] of Object.entries<any>(indiceAssets.objects || {})) {
    const sub = o.hash.slice(0, 2);
    baixaveis.push({
      url: `${RECURSOS}/${sub}/${o.hash}`,
      destino: join(raiz, 'assets', 'objects', sub, o.hash),
      sha1: o.hash, tamanho: o.size || 0
    });
  }

  return {
    vjson, clientJar, classpath, nativesJars,
    pastaNatives: join(raiz, 'natives', versao),
    baixaveis, indiceAssets, assetsDir: join(raiz, 'assets')
  };
}

async function extrairNatives(plano: Plano): Promise<void> {
  await mkdir(plano.pastaNatives, { recursive: true });
  for (const nj of plano.nativesJars) {
    const buf = await readFile(nj.caminho);
    for (const item of lerZip(buf)) {
      if (nj.exclude.some((ex) => item.nome.startsWith(ex))) continue;
      if (item.nome.includes('..')) continue; /* nunca escrever fora da pasta */
      const alvo = join(plano.pastaNatives, item.nome);
      /* se ja esta la igual, nao reescreve: a DLL pode estar carregada
         por um jogo aberto e o Windows devolve EBUSY */
      try {
        const st = await stat(alvo);
        if (st.size === item.dados.length) continue;
      } catch { /* nao existe: extrai */ }
      await mkdir(dirname(alvo), { recursive: true });
      try {
        await writeFile(alvo, item.dados);
      } catch (e: any) {
        /* travada por outra instancia: se o arquivo existe, segue com o que ja tem */
        if ((e?.code === 'EBUSY' || e?.code === 'EPERM') && await existe(alvo)) continue;
        throw e;
      }
    }
  }
}

/* ------------------------------------------------------------
   argumentos
   ------------------------------------------------------------ */
function trocar(texto: string, mapa: Record<string, string>): string {
  return texto.replace(/\$\{([\w_]+)\}/g, (todo, chave) => (chave in mapa ? mapa[chave] : todo));
}

function argumentosDoJogo(vjson: any, mapa: Record<string, string>): string[] {
  /* versões novas: arguments.game com regras; antigas: minecraftArguments */
  if (vjson.arguments?.game) {
    const saida: string[] = [];
    for (const a of vjson.arguments.game) {
      if (typeof a === 'string') saida.push(trocar(a, mapa));
      else if (regrasPermitem(a.rules)) {
        const v = Array.isArray(a.value) ? a.value : [a.value];
        v.forEach((x: string) => saida.push(trocar(x, mapa)));
      }
    }
    return saida;
  }
  if (typeof vjson.minecraftArguments === 'string') {
    return vjson.minecraftArguments.split(/\s+/).filter(Boolean).map((a: string) => trocar(a, mapa));
  }
  return [];
}

/* ------------------------------------------------------------
   Quebra a linha de argumentos em tokens, respeitando aspas.

   `split(' ')` seria mais curto e erraria em caminho com espaço —
   -Dxyz="C:\Program Files\x" viraria dois argumentos e a JVM
   recusaria a linha inteira com uma mensagem que não ajuda em nada.
   ------------------------------------------------------------ */
export function separarArgs(linha: string): string[] {
  const fora: string[] = [];
  let atual = '';
  let aspas: string | null = null;
  let tem = false;   /* "" e '' vazios sao argumento valido; string vazia nao */

  for (const c of String(linha || '')) {
    if (aspas) {
      if (c === aspas) { aspas = null; } else { atual += c; }
      continue;
    }
    if (c === '"' || c === "'") { aspas = c; tem = true; continue; }
    /* espaco em branco de qualquer tipo separa argumentos */
    if (/\s/.test(c)) {
      if (atual || tem) { fora.push(atual); atual = ''; tem = false; }
      continue;
    }
    atual += c;
  }
  if (atual || tem) fora.push(atual);
  return fora;
}

function argumentosJvm(
  vjson: any,
  mapa: Record<string, string>,
  memoriaMb: number,
  argsJvm?: string
): string[] {
  const base = [
    `-Xmx${memoriaMb}M`,
    '-Xms512M',
    /* tampa o Log4Shell nas versões antigas */
    '-Dlog4j2.formatMsgNoLookups=true'
  ];

  /* Entram AQUI: depois dos padrões, antes do que a versão exige.
     Depois dos padrões pra que -Xmx do usuário vença o cursor (a JVM
     fica com a última ocorrência). Antes do bloco da versão porque
     -cp e -Djava.library.path saem de lá e não podem ser empurrados
     pra longe do que os usa. */
  for (const a of separarArgs(argsJvm || '')) {
    /* -cp trocado na mao troca o classpath inteiro e o jogo nem abre.
       Quem quer mexer nisso nao usa uma caixa de texto no launcher. */
    if (a === '-cp' || a === '-classpath') continue;
    base.push(a);
  }
  if (vjson.arguments?.jvm) {
    for (const a of vjson.arguments.jvm) {
      if (typeof a === 'string') base.push(trocar(a, mapa));
      else if (regrasPermitem(a.rules)) {
        const v = Array.isArray(a.value) ? a.value : [a.value];
        v.forEach((x: string) => base.push(trocar(x, mapa)));
      }
    }
  } else {
    /* versões antigas não trazem jvm: monta o mínimo na mão */
    base.push(`-Djava.library.path=${mapa.natives_directory}`);
    base.push('-cp', mapa.classpath);
  }
  return base;
}

/* ------------------------------------------------------------
   arquivo de log em <perfil>/logs — a pasta de log do perfil.
   Nome proprio pra nao brigar com o latest.log do log4j do jogo.
   ------------------------------------------------------------ */
async function abrirArquivoDeLog(gameDir: string, versao: string, javaPath: string, args: string[]) {
  const pasta = join(gameDir, 'logs');
  await mkdir(pasta, { recursive: true });

  const d = new Date();
  const dd = (n: number) => String(n).padStart(2, '0');
  const carimbo = `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}_${dd(d.getHours())}-${dd(d.getMinutes())}-${dd(d.getSeconds())}`;
  const caminho = join(pasta, `xyven-${carimbo}.log`);

  const nl = String.fromCharCode(10);
  await writeFile(caminho,
    `# Xyven ${versao} — ${d.toLocaleString('pt-BR')}${nl}`
    + `# java: ${javaPath}${nl}`
    + `# args: ${args.join(' ')}${nl}${nl}`, 'utf8');

  /* guarda so os 10 mais recentes; mexe unicamente nos nossos arquivos */
  try {
    const meus = (await readdir(pasta)).filter((n) => /^xyven-.+\.log$/.test(n)).sort();
    for (const velho of meus.slice(0, Math.max(0, meus.length - 10))) {
      await unlink(join(pasta, velho)).catch(() => {});
    }
  } catch { /* pasta recem-criada */ }

  return caminho;
}

/* ------------------------------------------------------------
   Sessão do jogo — sobrevive ao launcher

   Com "Fechar ao tocar" o launcher sai e o Minecraft fica. Isso obriga a
   duas mudanças: o Java escreve o log direto no arquivo (antes quem
   escrevia era o launcher, lendo o cano — e o log parava junto com ele),
   e o que está rodando fica gravado em sessao.json, para o launcher se
   reencontrar com o jogo quando abrir de novo.
   ------------------------------------------------------------ */

type Sessao = { pid: number; versao: string; log: string; inicio: number };

const caminhoSessao = (perfil: string) => join(perfil, 'sessao.json');

async function gravarSessao(perfil: string, s: Sessao): Promise<void> {
  await writeFile(caminhoSessao(perfil), JSON.stringify(s), 'utf8').catch(() => {});
}

async function lerSessao(perfil: string): Promise<Sessao | null> {
  try {
    const j = JSON.parse(await readFile(caminhoSessao(perfil), 'utf8'));
    return j && typeof j.pid === 'number' ? j as Sessao : null;
  } catch { return null; }
}

async function apagarSessao(perfil: string): Promise<void> {
  await unlink(caminhoSessao(perfil)).catch(() => {});
}

function pidVivo(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/* O PID sozinho não basta: o Windows reaproveita número de processo morto,
   e um PID reciclado por outro programa faria o launcher jurar que o jogo
   está aberto. Conferir que ainda é um java resolve na prática. */
function pidEhJava(pid: number): Promise<boolean> {
  return new Promise((res) => {
    execFile('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'],
      (erro, saida) => res(!erro && /java/i.test(String(saida))));
  });
}

/* qual pid já foi confirmado como java — ver abaixo por que isso importa */
let javaConfirmado = 0;

async function jogoVivo(perfil: string): Promise<Sessao | null> {
  const s = await lerSessao(perfil);
  if (!s) return null;
  if (!pidVivo(s.pid)) { await apagarSessao(perfil); javaConfirmado = 0; return null; }

  /* tasklist custa ~55ms e cria um processo. Isto aqui é consultado de
     1,5 em 1,5 segundos enquanto se joga, então rodá-lo sempre seria gastar
     55ms por segundo justamente enquanto a máquina está ocupada com o jogo.
     A checagem existe contra reciclagem de PID, e para isso basta fazê-la
     uma vez por pid: depois, "existe" já implica "é aquele java". */
  if (javaConfirmado !== s.pid) {
    if (!(await pidEhJava(s.pid))) { await apagarSessao(perfil); return null; }
    javaConfirmado = s.pid;
  }
  return s;
}

/* Lê o log conforme ele cresce. Substitui a leitura do cano: funciona
   igual esteja o jogo rodando sob este launcher ou sob nenhum. */
function seguirLog(caminho: string, aoLinha: (l: string) => void, doComeco: boolean) {
  let pos = 0, resto = '', vivo = true, ocupado = false;

  const ler = async () => {
    if (!vivo || ocupado) return;
    ocupado = true;
    try {
      const info = await stat(caminho);
      if (info.size < pos) { pos = 0; resto = ''; }   /* arquivo rodou */
      if (info.size > pos) {
        const fh = await open(caminho, 'r');
        const buf = Buffer.alloc(info.size - pos);
        await fh.read(buf, 0, buf.length, pos);
        await fh.close();
        pos = info.size;
        const partes = (resto + buf.toString('utf8')).split(/\r?\n/);
        resto = partes.pop() || '';
        for (const l of partes) if (l.length) aoLinha(l);
      }
    } catch { /* ainda nao existe */ }
    ocupado = false;
  };

  if (!doComeco) stat(caminho).then((i) => { pos = i.size; }).catch(() => {});
  const t = setInterval(ler, 400);
  return () => { vivo = false; clearInterval(t); };
}

/* ------------------------------------------------------------
   API pública
   ------------------------------------------------------------ */

let processoAtual: ChildProcess | null = null;
let pararLog: (() => void) | null = null;
let perfilAtual = '';
let abortoAtual: AbortController | null = null;

export function cancelar(): void {
  abortoAtual?.abort();
  abortoAtual = null;
}

/* Pode haver jogo aberto sem este launcher ter sido quem o abriu (ele foi
   fechado no meio), por isso a resposta também sai do sessao.json. */
export async function jogoRodando(gameDir?: string): Promise<boolean> {
  if (processoAtual && processoAtual.exitCode === null) return true;
  const perfil = gameDir ? pastaPerfil(gameDir) : perfilAtual;
  return perfil ? !!(await jogoVivo(perfil)) : false;
}

export async function preparar(
  o: OpcoesLancar,
  aoProgredir: (p: Progresso) => void
): Promise<{ plano: Plano; args: string[] }> {
  abortoAtual = new AbortController();
  const sinal = abortoAtual.signal;
  const raiz = o.gameDir;
  const perfil = pastaPerfil(raiz);

  aoProgredir({ fase: 'CONFERINDO A FITA', arquivosProntos: 0, arquivosTotal: 0, bytesProntos: 0, bytesTotal: 0 });
  const plano = await montarPlano(o.versao, raiz, sinal);

  const total = plano.baixaveis.length;
  const bytesTotal = plano.baixaveis.reduce((s, b) => s + b.tamanho, 0);
  let prontos = 0, bytesProntos = 0, ultimo = 0;

  const avisar = (fase: string, forcar = false) => {
    const agora = Date.now();
    if (!forcar && agora - ultimo < 80) return;
    ultimo = agora;
    aoProgredir({ fase, arquivosProntos: prontos, arquivosTotal: total, bytesProntos, bytesTotal });
  };
  avisar('REBOBINANDO A FITA', true);

  await emLotes(plano.baixaveis, PARALELO, async (b) => {
    if (sinal.aborted) throw new Error('cancelado');
    try {
      const r = await garantir(b.url, b.destino, b.sha1, sinal);
      prontos++; bytesProntos += r.bytes || b.tamanho;
    } catch (e) {
      /* biblioteca do Forge que nao esta no maven publico: se o arquivo
         ja existe (o instalador colocou), segue; senao, deixa faltar e
         o Java reclama de forma mais util que um erro de download. */
      if (!b.opcional || !(await existe(b.destino))) {
        if (!b.opcional) throw e;
      }
      prontos++;
    }
    avisar('REBOBINANDO A FITA');
  });
  avisar('REBOBINANDO A FITA', true);

  await extrairNatives(plano);

  const classpath = [...plano.classpath, plano.clientJar].join(delimiter);
  const uuid = o.uuid || uuidOffline(o.nick);
  const mapa: Record<string, string> = {
    auth_player_name: o.nick,
    version_name: o.versao,
    game_directory: perfil,
    assets_root: plano.assetsDir,
    game_assets: join(plano.assetsDir, 'virtual', 'legacy'),
    assets_index_name: plano.vjson.assetIndex.id,
    auth_uuid: uuid,
    auth_access_token: o.accessToken || '0',
    auth_session: 'token:' + (o.accessToken || '0') + ':' + uuid,
    user_type: o.userType || 'legacy',
    version_type: plano.vjson.type || 'release',
    natives_directory: plano.pastaNatives,
    classpath,
    launcher_name: 'xyven',
    launcher_version: '1.0.0',
    user_properties: '{}'
  };

  const args = [
    ...argumentosJvm(plano.vjson, mapa, o.memoriaMb, o.argsJvm),
    plano.vjson.mainClass,
    ...argumentosDoJogo(plano.vjson, mapa)
  ];

  /* --server/--port fazem o cliente pular o menu e conectar sozinho.
     Existem desde a 1.6 e valem tambem com o Forge, que so repassa
     os argumentos do jogo. Sem porta, o proprio jogo resolve o SRV. */
  if (o.servidor) {
    const [host, porta] = String(o.servidor).split(':');
    if (host && host.trim()) {
      args.push('--server', host.trim());
      if (porta && Number(porta)) args.push('--port', String(Number(porta)));
    }
  }

  abortoAtual = null;
  return { plano, args };
}

/* ------------------------------------------------------------
   Confere os argumentos extras com a propria JVM, antes de abrir.

   Opcao -XX: desconhecida nao e ignorada: a JVM recusa e sai na
   hora. Sem esta checagem o sintoma seria o pior possivel — clicar
   em TOCAR, a barra completar, e o jogo nao abrir, sem nada na
   tela. Um `java -version` custa uns 200ms e devolve a queixa
   exata, com o nome da flag errada.
   ------------------------------------------------------------ */
function conferirArgsJvm(javaPath: string, extras: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn(javaPath, [...extras, '-version'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let saida = '';
    p.stderr?.on('data', (b) => { saida += String(b); });

    /* JVM travada ou java que nao responde: segue o jogo em vez de
       prender a pessoa numa checagem que era so preventiva */
    const relogio = setTimeout(() => { try { p.kill(); } catch { /* ja morreu */ } resolve(null); }, 8000);

    p.on('error', () => { clearTimeout(relogio); resolve(null); });
    p.on('close', (codigo) => {
      clearTimeout(relogio);
      if (codigo === 0) return resolve(null);
      /* a primeira linha e a queixa; o resto e ruido do uso */
      const linha = saida.split(String.fromCharCode(10))
        .map((l) => l.trim())
        .find((l) => l) || '';
      resolve(linha.trim() || 'a JVM recusou os argumentos personalizados.');
    });
  });
}

export async function lancar(
  o: OpcoesLancar,
  aoProgredir: (p: Progresso) => void,
  aoLog: (linha: string) => void,
  aoSair: (codigo: number | null) => void
): Promise<void> {
  const extras = separarArgs(o.argsJvm || '').filter((a) => a !== '-cp' && a !== '-classpath');
  if (extras.length) {
    const queixa = await conferirArgsJvm(o.javaPath, extras);
    if (queixa) {
      throw new Error('os argumentos da JVM não passaram: ' + queixa
        + '  —  corrija em Ajustes > Jogo > ARGUMENTOS DA JVM, ou clique em LIMPAR.');
    }
  }

  const { args } = await preparar(o, aoProgredir);

  aoProgredir({ fase: 'ABRINDO O MINECRAFT', arquivosProntos: 1, arquivosTotal: 1, bytesProntos: 1, bytesTotal: 1 });

  const perfil = pastaPerfil(o.gameDir);
  await mkdir(join(perfil, 'mods'), { recursive: true });   /* o Forge espera a pasta pronta */
  const caminhoLog = await abrirArquivoDeLog(perfil, o.versao, o.javaPath, args);
  aoLog('[xyven] log desta sessão: ' + caminhoLog);

  /* O Java escreve direto no arquivo, em vez de o launcher copiar do cano.
     É o que permite fechar o launcher com o jogo aberto sem perder o log —
     e o que faz o log continuar completo quando ninguém está olhando.
     Efeito colateral aceito: stdout e stderr caem no mesmo lugar, então as
     linhas de erro deixam de vir marcadas com [err]. */
  const fh = await open(caminhoLog, 'a');
  const p = spawn(o.javaPath, args, {
    cwd: perfil,
    detached: true,                       /* nao morre junto com o launcher */
    stdio: ['ignore', fh.fd, fh.fd],
  });
  p.unref();
  processoAtual = p;
  perfilAtual = perfil;
  if (p.pid) {
    await gravarSessao(perfil, { pid: p.pid, versao: o.versao, log: caminhoLog, inicio: Date.now() });
  }

  /* a JVM morre antes de abrir quando o heap não cabe; o texto dela não
     ajuda ninguém, então traduz uma vez por sessão. */
  let jaExplicou = false;
  const explicar = (linha: string): string | null => {
    if (jaExplicou) return null;
    /* a mensagem muda conforme a JVM: umas dizem "could not reserve",
       outras "unable to allocate ... for the requested heap". */
    const m = /Could not reserve enough space for (\d+)KB object heap/.exec(linha)
           || /requested (\d+)KB heap/.exec(linha);
    if (!m) return null;
    jaExplicou = true;
    const pedidoMb = Math.round(Number(m[1]) / 1024);
    return '[xyven] o Java não conseguiu reservar os ' + pedidoMb + ' MB pedidos. '
      + 'diminua a memória alocada em Ajustes, ou escolha um Java de 64 bits — '
      + 'o de 32 bits não passa de ~1 GB por mais RAM que a máquina tenha.';
  };

  pararLog?.();
  pararLog = seguirLog(caminhoLog, (linha) => {
    aoLog(linha);
    const ajuda = explicar(linha);
    if (ajuda) {
      aoLog(ajuda);
      appendFile(caminhoLog, ajuda + String.fromCharCode(10), 'utf8').catch(() => {});
    }
  }, true);

  const encerrar = async (codigo: number | null, aviso: string) => {
    /* dá um instante para o seguidor alcançar as últimas linhas */
    setTimeout(() => { pararLog?.(); pararLog = null; }, 900);
    await appendFile(caminhoLog, aviso + String.fromCharCode(10), 'utf8').catch(() => {});
    await fh.close().catch(() => {});
    await apagarSessao(perfil);
    processoAtual = null;
    aoSair(codigo);
  };

  p.on('error', (e) => {
    aoLog('[erro] não consegui executar o Java: ' + e.message);
    void encerrar(-1, '# falhou: ' + e.message);
  });
  p.on('exit', (codigo) => { void encerrar(codigo, '# saiu com código ' + codigo); });
}

export async function matarJogo(gameDir?: string): Promise<void> {
  processoAtual?.kill();
  processoAtual = null;
  const perfil = gameDir ? pastaPerfil(gameDir) : perfilAtual;
  if (!perfil) return;
  const s = await lerSessao(perfil);
  if (s && pidVivo(s.pid)) { try { process.kill(s.pid); } catch { /* ja morreu */ } }
  await apagarSessao(perfil);
  pararLog?.(); pararLog = null;
}

/* Reencontra um jogo que ficou aberto depois de o launcher fechar. Devolve
   null quando não há nada rodando — o caso normal. */
export async function retomarSessao(
  gameDir: string,
  aoLog: (linha: string) => void,
  aoSair: (codigo: number | null) => void
): Promise<{ versao: string; log: string } | null> {
  const perfil = pastaPerfil(gameDir);
  const s = await jogoVivo(perfil);
  if (!s) return null;

  perfilAtual = perfil;
  pararLog?.();
  /* do começo: quem reabre o launcher quer ver o log inteiro, não só daqui pra frente */
  pararLog = seguirLog(s.log, aoLog, true);

  /* este processo não é mais nosso filho, então não há evento de saída:
     só resta perguntar de tempos em tempos se ele ainda está de pé. */
  const vigia = setInterval(async () => {
    if (await jogoVivo(perfil)) return;
    clearInterval(vigia);
    setTimeout(() => { pararLog?.(); pararLog = null; }, 900);
    aoSair(0);
  }, 2000);

  return { versao: s.versao, log: s.log };
}

/* ------------------------------------------------------------
   Conta na Mojang: serve pra saber se e premium e qual capa esta
   equipada. Sem login so da pra ver a capa ATIVA (o catalogo
   completo exige o token do login Microsoft).
   ------------------------------------------------------------ */
export async function contaMojang(nick: string): Promise<{ premium: boolean; uuid: string | null; capa: string | null; modelo: 'slim' | 'classic' }> {
  const vazio = { premium: false, uuid: null, capa: null, modelo: 'classic' as const };
  try {
    const r1 = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(nick));
    if (!r1.ok) return vazio;                    /* 404 = nick nao existe na Mojang */
    const { id } = await r1.json();
    if (!id) return vazio;

    const r2 = await fetch('https://sessionserver.mojang.com/session/minecraft/profile/' + id);
    if (!r2.ok) return { premium: true, uuid: id, capa: null, modelo: 'classic' as const };
    const perfil = await r2.json();
    const prop = (perfil.properties || []).find((p: any) => p.name === 'textures');
    if (!prop) return { premium: true, uuid: id, capa: null, modelo: 'classic' as const };

    const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
    const skin = tex && tex.textures && tex.textures.SKIN;
    /* a Mojang marca as skins de braco fino aqui; sem isso o boneco
       renderiza o braco de 4px em cima de uma textura de 3px */
    const modelo = (skin && skin.metadata && skin.metadata.model === 'slim') ? 'slim' as const : 'classic' as const;
    return { premium: true, uuid: id, capa: (tex && tex.textures && tex.textures.CAPE && tex.textures.CAPE.url) || null, modelo };
  } catch {
    return vazio;                                 /* offline: trata como sem capa */
  }
}

/* ------------------------------------------------------------
   INSTALAR O FORGE (formato legado: 1.8.9 ate 1.12.2)

   O instalador do Forge e um jar (zip) com install_profile.json
   dentro, que traz o JSON da versao pronto e o nome do universal.
   Instalar = escrever esse JSON em versions/ e extrair o universal
   para libraries/. O resto das bibliotecas o pipeline normal baixa.

   A partir da 1.13 o instalador usa "processors" e nao da pra fazer
   assim — nesse caso a gente avisa em vez de fingir que deu certo.
   ------------------------------------------------------------ */
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
/* as promocoes ficam no files., nao no maven (o maven devolve 404) */
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

export async function versaoDoForge(mc: string): Promise<string | null> {
  try {
    const j: any = await baixarJson(FORGE_PROMOS);
    const p = j.promos || {};
    return p[mc + '-recommended'] || p[mc + '-latest'] || null;
  } catch { return null; }
}

/* baixa o instalador tentando as duas convencoes de caminho do maven:
   versoes antigas repetem a versao do jogo no fim da pasta. */
async function baixarInstalador(mc: string, forge: string): Promise<Buffer> {
  const nomes = [`${mc}-${forge}`, `${mc}-${forge}-${mc}`];
  for (const n of nomes) {
    const url = `${FORGE_MAVEN}/${n}/forge-${n}-installer.jar`;
    const r = await fetch(url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
  }
  throw new Error(`não encontrei o instalador do Forge ${forge} para ${mc} no maven.`);
}

export async function instalarForge(
  mcVersao: string, raiz: string, aoProgredir: (p: Progresso) => void
): Promise<{ id: string }> {
  const passo = (fase: string, feito: number, total: number) =>
    aoProgredir({ fase, arquivosProntos: feito, arquivosTotal: total, bytesProntos: feito, bytesTotal: total });

  passo('PROCURANDO O FORGE', 0, 4);
  const versao = await versaoDoForge(mcVersao);
  if (!versao) throw new Error('não há Forge para ' + mcVersao + '.');

  passo('BAIXANDO O FORGE', 1, 4);
  const jar = await baixarInstalador(mcVersao, versao);

  passo('ABRINDO O INSTALADOR', 2, 4);
  const itens = lerZip(jar);
  const acha = (nome: string) => itens.find((i) => i.nome === nome);
  const perfil = acha('install_profile.json');
  if (!perfil) throw new Error('instalador sem install_profile.json.');
  const info = JSON.parse(perfil.dados.toString('utf8'));

  /* formato novo (1.12.2+): traz version.json separado e pode ter
     "processors", que exigem rodar tarefas Java — isso a gente nao faz. */
  const ehNovo = !info.versionInfo;
  if (ehNovo && Array.isArray(info.processors) && info.processors.length) {
    throw new Error('esta versão do Forge precisa do instalador oficial ' +
                    '(usa processadores que o launcher não executa).');
  }

  let vinfo: any;
  let coordUniversal: string | null = null;
  let arquivoUniversal: string | null = null;

  if (ehNovo) {
    const vj = acha('version.json');
    if (!vj) throw new Error('instalador sem version.json.');
    vinfo = JSON.parse(vj.dados.toString('utf8'));
    coordUniversal = info.path || null;
  } else {
    vinfo = info.versionInfo;
    coordUniversal = info.install && info.install.path;
    arquivoUniversal = info.install && info.install.filePath;
  }
  if (!vinfo || !vinfo.id) throw new Error('não consegui ler o JSON da versão do Forge.');

  passo('INSTALANDO', 3, 4);
  const id = vinfo.id;
  const pastaV = join(raiz, 'versions', id);
  await mkdir(pastaV, { recursive: true });
  await writeFile(join(pastaV, id + '.json'), JSON.stringify(vinfo, null, 2));

  /* o jar do Forge vem dentro do proprio instalador: no formato antigo
     na raiz, no novo dentro de maven/ */
  if (coordUniversal) {
    const rel = caminhoMaven(coordUniversal);
    let dados = arquivoUniversal
      ? (acha(arquivoUniversal) || itens.find((i) => i.nome.endsWith('/' + arquivoUniversal)))
      : null;
    if (!dados) dados = acha('maven/' + rel) || itens.find((i) => i.nome.endsWith('/' + rel));
    if (dados) {
      const destino = join(raiz, 'libraries', ...rel.split('/'));
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, dados.dados);
    }
  }

  passo('PRONTO', 4, 4);
  return { id };
}

/* ------------------------------------------------------------
   Java instalado na máquina
   ------------------------------------------------------------ */
const versaoDoJava = (exe: string) => new Promise<{ versao: string; bits: 32 | 64 } | null>((res) => {
  /* -version sai no stderr, não no stdout */
  execFile(exe, ['-version'], (err, _out, errOut) => {
    if (err && !errOut) return res(null);
    const texto = errOut || '';
    const m = /version "([^"]+)"/.exec(texto);
    if (!m) return res(null);
    /* a terceira linha diz "64-Bit Server VM" quando é de 64. Java de
       32 bits não endereça nem 2 GB, e é por isso que o heap padrão
       às vezes não cabe. */
    res({ versao: m[1], bits: /64-bit/i.test(texto) ? 64 : 32 });
  });
});

export async function detectarJava(): Promise<{ caminho: string; versao: string; maior: number; bits: 32 | 64 }[]> {
  const candidatos = new Set<string>();
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || '';
  const local = process.env['LOCALAPPDATA'] || '';
  const appdata = process.env['APPDATA'] || '';

  if (process.env.JAVA_HOME) candidatos.add(join(process.env.JAVA_HOME, 'bin', 'java.exe'));

  const bases = [
    join(pf, 'Java'), join(pf, 'Eclipse Adoptium'), join(pf, 'Microsoft', 'jdk'),
    pf86 ? join(pf86, 'Java') : '', local ? join(local, 'Programs', 'Eclipse Adoptium') : '',
    appdata ? join(appdata, '.minecraft', 'runtime') : ''
  ].filter(Boolean);

  for (const base of bases) {
    try {
      for (const d of await readdir(base, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        candidatos.add(join(base, d.name, 'bin', 'java.exe'));
        /* o runtime da Mojang enfia mais um nível */
        try {
          for (const d2 of await readdir(join(base, d.name), { withFileTypes: true })) {
            if (d2.isDirectory()) candidatos.add(join(base, d.name, d2.name, 'bin', 'java.exe'));
          }
        } catch { /* sem subpasta */ }
      }
    } catch { /* base não existe */ }
  }

  const achados: { caminho: string; versao: string; maior: number; bits: 32 | 64 }[] = [];
  for (const c of candidatos) {
    if (!(await existe(c))) continue;
    const v = await versaoDoJava(c);
    if (!v) continue;
    /* "1.8.0_412" => 8 ; "17.0.19" => 17 */
    const p = v.versao.split('.');
    const maior = p[0] === '1' ? Number(p[1]) : Number(p[0]);
    if (!Number.isFinite(maior)) continue;
    if (achados.some((a) => a.versao === v.versao)) continue;
    achados.push({ caminho: c, versao: v.versao, maior, bits: v.bits });
  }
  achados.sort((a, b) => a.maior - b.maior);
  return achados;
}

/* ------------------------------------------------------------
   quanto de RAM dá pra prometer à JVM. Sem isso o launcher deixava
   pedir 7 GB numa máquina que não tem, e o Java morria com
   "Could not reserve enough space for object heap" antes de abrir.
   ------------------------------------------------------------ */
export const TETO_MEMORIA = 7168;    /* o máximo que o fader mostra */

export async function limitesDeMemoria(javaPath?: string): Promise<{
  min: number; max: number; totalMb: number; bits: 32 | 64 | null;
}> {
  const min = 1024;
  const totalMb = Math.floor(totalmem() / (1024 * 1024));

  let bits: 32 | 64 | null = null;
  if (javaPath) {
    const v = await versaoDoJava(javaPath);
    if (v) bits = v.bits;
  }

  /* JVM de 32 bits não passa de ~1,5 GB de heap, por mais RAM que
     a máquina tenha — o limite é do processo, não do computador. */
  if (bits === 32) return { min: 512, max: 1024, totalMb, bits };

  /* deixa 2 GB pro sistema; nunca abaixo do mínimo nem acima do teto */
  const sobra = Math.floor((totalMb - 2048) / 256) * 256;
  const max = Math.max(min, Math.min(TETO_MEMORIA, sobra));
  return { min, max, totalMb, bits };
}

/* qual Java a versão do jogo pede */
export function javaExigido(versao: string): number {
  const p = versao.split('.').map(Number);
  const menor = p[1] || 0, patch = p[2] || 0;
  if (!Number.isFinite(menor) || p[0] !== 1) return 17; /* snapshot ou nome estranho */
  if (menor >= 21) return 21;
  if (menor === 20 && patch >= 5) return 21;
  if (menor >= 18) return 17;
  if (menor === 17) return 16;
  return 8;
}
