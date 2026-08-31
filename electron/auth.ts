/* ============================================================
   LOGIN MICROSOFT — fluxo de código do CmlLib.Core.

   Copiado do CmlLib.Core.Auth.Microsoft (JELoginHandler +
   XboxAuthNet.Game). Não é o OAuth do Entra ID: é o endpoint
   antigo do Live, com o title id do próprio launcher oficial
   do Minecraft. É por isso que funciona — um app registrado
   por nós no Entra leva 403 da API do Minecraft.

   JELoginHandler.DefaultMicrosoftOAuthClientInfo:
     ClientId = XboxGameTitles.MinecraftJava
     Scopes   = XboxAuthConstants.XboxScope
   CodeFlowLiveApiClient: authorize / token / redirect abaixo.

   O usuário entra numa janela separada; o launcher nunca vê a
   senha. Só o processo principal fala com a rede.

   Cadeia: Live -> Xbox Live -> XSTS -> Minecraft -> perfil.
   ============================================================ */
import { app, safeStorage, BrowserWindow } from 'electron';
import { readFile, writeFile, mkdir, unlink, appendFile } from 'fs/promises';
import { join, dirname } from 'path';

/* XboxGameTitles.MinecraftJava — o title do launcher oficial. */
export const CLIENT_ID = '00000000402b5328';

/* XboxAuthConstants.XboxScope */
const ESCOPO = 'service::user.auth.xboxlive.com::MBI_SSL';

/* CodeFlowLiveApiClient */
const OAUTH_AUTORIZAR = 'https://login.live.com/oauth20_authorize.srf';
const OAUTH_TOKEN = 'https://login.live.com/oauth20_token.srf';
const OAUTH_REDIRECT = 'https://login.live.com/oauth20_desktop.srf';

const XBL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PERFIL = 'https://api.minecraftservices.com/minecraft/profile';

export type Capa = { id: string; nome: string; url: string; ativa: boolean };
export type ContaMS = {
  nick: string;
  uuid: string;
  accessToken: string;
  expiraEm: number;          /* epoch ms */
  capas: Capa[];
};

/* ------------------------------------------------------------
   passo 1 e 2 — a janela de login

   O CmlLib usa WebView2 aqui, que só existe no Windows. No
   Electron o equivalente é uma BrowserWindow: mesma página,
   mesmo redirect, mesmo código no fim.

   A partição é descartável de propósito: sem ela, a segunda
   conta entra sozinha com a sessão da primeira e o
   prompt=select_account não adianta.
   ------------------------------------------------------------ */
let janelaLogin: BrowserWindow | null = null;

export function abortarLogin() {
  if (janelaLogin && !janelaLogin.isDestroyed()) janelaLogin.close();
  janelaLogin = null;
}

function urlAutorizacao(): string {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: ESCOPO,
    redirect_uri: OAUTH_REDIRECT,
    response_type: 'code',
    response_mode: 'query',
    prompt: 'select_account'
  });
  return OAUTH_AUTORIZAR + '?' + q.toString();
}

/* devolve o code do redirect, ou null se a pessoa fechou a janela */
function pedirCodigoNaJanela(pai: BrowserWindow | null): Promise<string | null> {
  return new Promise((resolve, reject) => {
    abortarLogin();
    const temPai = !!(pai && !pai.isDestroyed());
    const w = new BrowserWindow({
      parent: temPai ? (pai as BrowserWindow) : undefined,
      modal: temPai,
      width: 520, height: 700, minimizable: false, maximizable: false,
      autoHideMenuBar: true, title: 'ENTRAR COM A MICROSOFT',
      webPreferences: {
        partition: 'msauth-' + Date.now(),   /* sessão limpa a cada login */
        contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    });
    janelaLogin = w;

    let terminou = false;
    const acabar = (fn: () => void) => {
      if (terminou) return;
      terminou = true;
      fn();
      if (!w.isDestroyed()) w.close();
    };

    /* o redirect é uma página em branco do próprio Live: o que
       interessa é a query, e ela aparece antes de carregar. */
    const olhar = (url: string) => {
      if (!url.startsWith(OAUTH_REDIRECT)) return;
      const q = new URL(url).searchParams;
      const code = q.get('code');
      if (code) return acabar(() => resolve(code));
      const erro = q.get('error');
      if (erro) {
        acabar(() => reject(new Error(traduzOAuth({
          error: erro, error_description: q.get('error_description')
        }))));
      }
    };

    w.webContents.on('will-redirect', (_e, url) => olhar(url));
    w.webContents.on('will-navigate', (_e, url) => olhar(url));
    w.webContents.on('did-navigate', (_e, url) => olhar(url));
    w.on('closed', () => {
      janelaLogin = null;
      if (!terminou) { terminou = true; resolve(null); }
    });

    w.loadURL(urlAutorizacao());
  });
}

/* troca o code pelo token (CodeFlowLiveApiClient.GetAccessToken) */
async function trocarCodigoPorToken(code: string) {
  const r = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: ESCOPO,
      code,
      grant_type: 'authorization_code',
      redirect_uri: OAUTH_REDIRECT
    })
  });
  const j: any = await r.json();
  if (!r.ok || !j.access_token) throw new Error(traduzOAuth(j));
  return { access_token: j.access_token as string, refresh_token: (j.refresh_token || '') as string };
}

function traduzOAuth(j: any): string {
  const e = j && j.error;
  if (e === 'access_denied') return 'você recusou o acesso na tela da Microsoft.';
  if (e === 'invalid_grant') return 'a Microsoft recusou o código. tente entrar de novo.';
  if (e === 'invalid_client') return 'o client_id do login não foi aceito pela Microsoft.';
  return (j && (j.error_description || j.error)) || 'falha ao falar com a Microsoft.';
}

/* ------------------------------------------------------------
   passo 3 — Xbox Live, XSTS e Minecraft
   ------------------------------------------------------------ */
async function autenticarXbox(msToken: string) {
  const r = await fetch(XBL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: msToken   /* XboxUserTokenRequest manda cru; o 'd=' é só do Entra */ },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  });
  if (!r.ok) throw new Error('o Xbox Live recusou o login (HTTP ' + r.status + ').');
  const j: any = await r.json();
  return { token: j.Token as string, uhs: j.DisplayClaims.xui[0].uhs as string };
}

async function autorizarXsts(xblToken: string) {
  const r = await fetch(XSTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  });
  const j: any = await r.json();
  if (!r.ok) {
    const err = String(j && j.XErr);
    if (err === '2148916233') throw new Error('esta conta Microsoft não tem perfil do Xbox. crie um em xbox.com e tente de novo.');
    if (err === '2148916235') throw new Error('o Xbox Live não está disponível no país desta conta.');
    if (err === '2148916238') throw new Error('conta de menor de idade: precisa ser adicionada a uma família para entrar.');
    if (err === '2148916227') throw new Error('esta conta foi banida do Xbox Live.');
    throw new Error('o XSTS recusou o login (XErr ' + err + ').');
  }
  return { token: j.Token as string, uhs: j.DisplayClaims.xui[0].uhs as string };
}

async function entrarNoMinecraft(uhs: string, xstsToken: string) {
  const r = await fetch(MC_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` })
  });
  if (!r.ok) {
    /* guarda o texto cru: e a unica pista do motivo exato da recusa */
    const corpo = await r.text().catch(() => '');
    await anotar('minecraft ' + r.status + ' corpo: ' + corpo.slice(0, 500));
    if (r.status === 403) {
      throw new Error('a Microsoft recusou o acesso deste app à API do Minecraft (403).' +
                      (corpo ? ' resposta: ' + corpo.slice(0, 200) : '') +
                      ' — costuma ser falta de aprovação do app para uso com o Minecraft.');
    }
    throw new Error('falha ao entrar no Minecraft (HTTP ' + r.status + ')' + (corpo ? ': ' + corpo.slice(0, 200) : '') + '.');
  }
  const j: any = await r.json();
  return { accessToken: j.access_token as string, expiraEm: Date.now() + (Number(j.expires_in) || 86400) * 1000 };
}

async function buscarPerfil(accessToken: string) {
  const r = await fetch(MC_PERFIL, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (r.status === 404) throw new Error('esta conta Microsoft não tem Minecraft: Java Edition.');
  if (!r.ok) throw new Error('não consegui ler o perfil do Minecraft (HTTP ' + r.status + ').');
  const j: any = await r.json();
  const capas: Capa[] = (j.capes || []).map((c: any) => ({
    id: c.id, nome: (c.alias || 'capa').toUpperCase(), url: c.url, ativa: c.state === 'ACTIVE'
  }));
  return { nick: j.name as string, uuid: j.id as string, capas };
}

/* diário do login: sem isso, quando falha ninguém sabe em qual etapa */
export type Passo = (texto: string) => void;

async function anotar(linha: string) {
  try {
    const caminho = join(app.getPath('userData'), 'auth.log');
    await appendFile(caminho, new Date().toISOString() + '  ' + linha + '\n');
  } catch { /* log é acessório */ }
}

/* junta tudo a partir do token da Microsoft */
async function montarConta(msToken: string, passo: Passo = () => {}): Promise<ContaMS> {
  passo('entrando no Xbox Live...');
  await anotar('xbl: inicio');
  const xbl = await autenticarXbox(msToken);
  await anotar('xbl: ok');

  passo('autorizando no Xbox (XSTS)...');
  const xsts = await autorizarXsts(xbl.token);
  await anotar('xsts: ok');

  passo('entrando no Minecraft...');
  const mc = await entrarNoMinecraft(xsts.uhs, xsts.token);
  await anotar('minecraft: token obtido');

  passo('lendo seu perfil...');
  const perfil = await buscarPerfil(mc.accessToken);
  await anotar('perfil: ' + perfil.nick + ' (' + perfil.capas.length + ' capas)');

  return { ...perfil, accessToken: mc.accessToken, expiraEm: mc.expiraEm };
}

export async function entrar(pai: BrowserWindow | null, passo: Passo = () => {}): Promise<ContaMS | null> {
  try {
    passo('esperando você entrar na janela da Microsoft...');
    await anotar('abrindo janela de login');
    const code = await pedirCodigoNaJanela(pai);
    if (!code) { await anotar('janela fechada pelo usuario'); return null; }

    const t = await trocarCodigoPorToken(code);
    await anotar('microsoft: token recebido');

    const conta = await montarConta(t.access_token, passo);

    passo('salvando a conta...');
    await guardarRefresh(conta.nick, t.refresh_token);
    await anotar('refresh guardado para ' + conta.nick + (t.refresh_token ? '' : ' (SEM refresh_token!)'));
    return conta;
  } catch (e: any) {
    await anotar('FALHOU: ' + (e?.message || String(e)));
    throw e;
  }
}

/* ------------------------------------------------------------
   trocar a skin de verdade

   A skin que aparece no jogo não vem do launcher: o servidor
   pergunta pra Mojang qual é a textura daquele UUID. Escolher
   uma skin só aqui dentro nunca ia mudar nada in-game — tinha
   que subir pro perfil, e agora dá, porque o token é válido.

   Vale pra conta inteira: muda no Xyven, no launcher oficial e
   em qualquer servidor. Não é preferência local.
   ------------------------------------------------------------ */
const MC_SKIN = 'https://api.minecraftservices.com/minecraft/profile/skins';

export async function trocarSkin(accessToken: string, urlPng: string, slim: boolean) {
  await anotar('skin: baixando ' + urlPng);
  const img = await fetch(urlPng);
  if (!img.ok) throw new Error('não consegui baixar a imagem da skin (HTTP ' + img.status + ').');
  const bytes = Buffer.from(await img.arrayBuffer());

  /* a Mojang recusa qualquer coisa que não seja PNG de skin */
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('o arquivo baixado não é um PNG.');
  }

  const form = new FormData();
  form.append('variant', slim ? 'slim' : 'classic');
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'skin.png');

  const r = await fetch(MC_SKIN, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
    body: form
  });

  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    await anotar('skin: falhou ' + r.status + ' ' + corpo.slice(0, 300));
    if (r.status === 401) throw new Error('a sessão expirou. entre de novo na conta.');
    if (r.status === 429) throw new Error('a Mojang pediu pra esperar um pouco antes de trocar de novo.');
    throw new Error('a Mojang recusou a troca de skin (HTTP ' + r.status + ')' +
                    (corpo ? ': ' + corpo.slice(0, 200) : '') + '.');
  }
  await anotar('skin: trocada (' + (slim ? 'slim' : 'classic') + ')');
  return true;
}

/* ------------------------------------------------------------
   refresh token — guardado cifrado pelo sistema, nunca em texto
   ------------------------------------------------------------ */
const arquivoRefresh = () => join(app.getPath('userData'), 'contas', 'refresh.json');

async function lerCofre(): Promise<Record<string, string>> {
  try {
    const bruto = await readFile(arquivoRefresh());
    const txt = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(bruto)
      : bruto.toString('utf8');
    return JSON.parse(txt);
  } catch { return {}; }
}

async function gravarCofre(dados: Record<string, string>) {
  const caminho = arquivoRefresh();
  await mkdir(dirname(caminho), { recursive: true });
  const txt = JSON.stringify(dados);
  const saida = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(txt)
    : Buffer.from(txt, 'utf8');
  await writeFile(caminho, saida);
}

async function guardarRefresh(nick: string, refresh: string) {
  if (!refresh) return;
  const cofre = await lerCofre();
  cofre[nick.toLowerCase()] = refresh;
  await gravarCofre(cofre);
}

export async function esquecerConta(nick: string) {
  const cofre = await lerCofre();
  delete cofre[nick.toLowerCase()];
  if (Object.keys(cofre).length) await gravarCofre(cofre);
  else await unlink(arquivoRefresh()).catch(() => {});
}

export async function temRefresh(nick: string): Promise<boolean> {
  return !!(await lerCofre())[nick.toLowerCase()];
}

/* renova em silêncio na hora de jogar */
export async function renovar(nick: string): Promise<ContaMS | null> {
  const cofre = await lerCofre();
  const refresh = cofre[nick.toLowerCase()];
  if (!refresh) {
    await anotar('renovar: cofre sem entrada para ' + nick +
      ' (chaves no cofre: ' + Object.keys(cofre).join(",") + ')');
    return null;
  }

  const r = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh,
      scope: ESCOPO, redirect_uri: OAUTH_REDIRECT
    })
  });
  const j: any = await r.json();
  if (!r.ok || !j.access_token) {
    await anotar('renovar: Microsoft recusou (' + r.status + ') ' +
      String(j && (j.error_description || j.error) || '').slice(0, 200));
    return null;
  }

  const conta = await montarConta(j.access_token);
  if (j.refresh_token) await guardarRefresh(conta.nick, j.refresh_token);
  return conta;
}
