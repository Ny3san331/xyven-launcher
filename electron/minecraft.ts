/* ============================================================
   MOTOR DO MINECRAFT — baixar, conferir e abrir.
   Roda só no processo principal. Nada aqui toca o renderer.
   Sem dependência externa: tudo com módulo nativo do Node.
   ============================================================ */
import { createHash } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, readFile, writeFile, rename, stat, unlink, readdir } from 'fs/promises';
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

async function baixarJson(url: string, sinal?: AbortSignal): Promise<any> {
  const r = await fetch(url, { signal: sinal });
  if (!r.ok) throw new Error(`falhou ao buscar ${url} (HTTP ${r.status})`);
  return r.json();
}

/* baixa para .part e só renomeia no fim: download interrompido
   nunca deixa arquivo pela metade passando por bom */
async function baixarArquivo(url: string, destino: string, sinal?: AbortSignal): Promise<number> {
  await mkdir(dirname(destino), { recursive: true });
  const temp = destino + '.part';
  const r = await fetch(url, { signal: sinal });
  if (!r.ok || !r.body) throw new Error(`download falhou: ${url} (HTTP ${r.status})`);
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

function argumentosJvm(vjson: any, mapa: Record<string, string>, memoriaMb: number): string[] {
  const base = [
    `-Xmx${memoriaMb}M`,
    '-Xms512M',
    /* tampa o Log4Shell nas versões antigas */
    '-Dlog4j2.formatMsgNoLookups=true'
  ];
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

  const fluxo = createWriteStream(caminho, { flags: 'a' });
  const nl = String.fromCharCode(10);
  fluxo.write(`# Xyven ${versao} — ${d.toLocaleString('pt-BR')}${nl}`);
  fluxo.write(`# java: ${javaPath}${nl}`);
  fluxo.write(`# args: ${args.join(' ')}${nl}${nl}`);

  /* guarda so os 10 mais recentes; mexe unicamente nos nossos arquivos */
  try {
    const meus = (await readdir(pasta)).filter((n) => /^xyven-.+\.log$/.test(n)).sort();
    for (const velho of meus.slice(0, Math.max(0, meus.length - 10))) {
      await unlink(join(pasta, velho)).catch(() => {});
    }
  } catch { /* pasta recem-criada */ }

  return { caminho, fluxo };
}

/* ------------------------------------------------------------
   API pública
   ------------------------------------------------------------ */

let processoAtual: ChildProcess | null = null;
let abortoAtual: AbortController | null = null;

export function cancelar(): void {
  abortoAtual?.abort();
  abortoAtual = null;
}

export function jogoRodando(): boolean {
  return !!processoAtual && processoAtual.exitCode === null;
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
    ...argumentosJvm(plano.vjson, mapa, o.memoriaMb),
    plano.vjson.mainClass,
    ...argumentosDoJogo(plano.vjson, mapa)
  ];

  abortoAtual = null;
  return { plano, args };
}

export async function lancar(
  o: OpcoesLancar,
  aoProgredir: (p: Progresso) => void,
  aoLog: (linha: string) => void,
  aoSair: (codigo: number | null) => void
): Promise<void> {
  const { args } = await preparar(o, aoProgredir);

  aoProgredir({ fase: 'ABRINDO O MINECRAFT', arquivosProntos: 1, arquivosTotal: 1, bytesProntos: 1, bytesTotal: 1 });

  const perfil = pastaPerfil(o.gameDir);
  await mkdir(join(perfil, 'mods'), { recursive: true });   /* o Forge espera a pasta pronta */
  const arquivo = await abrirArquivoDeLog(perfil, o.versao, o.javaPath, args);
  aoLog('[xyven] log desta sessão: ' + arquivo.caminho);

  const p = spawn(o.javaPath, args, { cwd: perfil, stdio: ['ignore', 'pipe', 'pipe'] });
  processoAtual = p;

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

  const porLinha = (fluxo: NodeJS.ReadableStream, marca: string) => {
    let resto = '';
    fluxo.on('data', (d: Buffer) => {
      const partes = (resto + d.toString()).split(/\r?\n/);
      resto = partes.pop() || '';
      partes.forEach((l) => {
        const linha = marca + l;
        aoLog(linha);
        arquivo.fluxo.write(linha + String.fromCharCode(10));
        const ajuda = explicar(l);
        if (ajuda) { aoLog(ajuda); arquivo.fluxo.write(ajuda + String.fromCharCode(10)); }
      });
    });
  };
  porLinha(p.stdout!, '');
  porLinha(p.stderr!, '[err] ');

  p.on('error', (e) => {
    const msg = '[erro] não consegui executar o Java: ' + e.message;
    aoLog(msg); arquivo.fluxo.end(msg + String.fromCharCode(10));
    aoSair(-1); processoAtual = null;
  });
  p.on('exit', (codigo) => {
    arquivo.fluxo.end('# saiu com código ' + codigo + String.fromCharCode(10));
    processoAtual = null; aoSair(codigo);
  });
}

export function matarJogo(): void {
  processoAtual?.kill();
  processoAtual = null;
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
