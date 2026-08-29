/* ============================================================
   LOGIN MICROSOFT — device code.
   O usuário digita o código no navegador dele; o launcher nunca
   vê a senha. Só o processo principal fala com a rede.

   Cadeia: Microsoft -> Xbox Live -> XSTS -> Minecraft -> perfil.
   ============================================================ */
import { app, safeStorage } from 'electron';
import { readFile, writeFile, mkdir, unlink, appendFile } from 'fs/promises';
import { join, dirname } from 'path';

/* app registrado no Entra ID. Não é segredo: vai dentro do binário. */
export const CLIENT_ID = '0f601ed2-cbe5-4c04-bf9b-16aabbd69714';

const ESCOPO = 'XboxLive.signin offline_access';
const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
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
   passo 1 — pedir o código
   ------------------------------------------------------------ */
export type Codigo = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

export async function pedirCodigo(): Promise<Codigo> {
  const r = await fetch(`${OAUTH}/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: ESCOPO })
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(traduzOAuth(j));
  return {
    device_code: j.device_code,
    user_code: j.user_code,
    verification_uri: j.verification_uri || 'https://microsoft.com/link',
    interval: Math.max(2, Number(j.interval) || 5),
    expires_in: Number(j.expires_in) || 900
  };
}

function traduzOAuth(j: any): string {
  const e = j && j.error;
  if (e === 'unauthorized_client') {
    return 'o app não está marcado como cliente público no Entra ID ' +
           '(Manifesto: isFallbackPublicClient = true).';
  }
  if (e === 'invalid_client') return 'client_id inválido ou o app foi removido.';
  if (e === 'expired_token') return 'o código expirou. peça um novo.';
  if (e === 'authorization_declined') return 'você recusou o acesso na tela da Microsoft.';
  return (j && (j.error_description || j.error)) || 'falha ao falar com a Microsoft.';
}

/* ------------------------------------------------------------
   passo 2 — esperar o usuário aprovar no navegador
   ------------------------------------------------------------ */
let cancelarEspera = false;
export function abortarLogin() { cancelarEspera = true; }

export async function esperarAprovacao(c: Codigo): Promise<{ access_token: string; refresh_token: string }> {
  cancelarEspera = false;
  const limite = Date.now() + c.expires_in * 1000;
  let intervalo = c.interval * 1000;

  while (Date.now() < limite) {
    if (cancelarEspera) throw new Error('login cancelado.');
    await new Promise((r) => setTimeout(r, intervalo));
    if (cancelarEspera) throw new Error('login cancelado.');

    const r = await fetch(`${OAUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: CLIENT_ID,
        device_code: c.device_code
      })
    });
    const j: any = await r.json();

    if (r.ok && j.access_token) return { access_token: j.access_token, refresh_token: j.refresh_token };
    if (j.error === 'authorization_pending') continue;      /* ainda digitando */
    if (j.error === 'slow_down') { intervalo += 5000; continue; }
    throw new Error(traduzOAuth(j));
  }
  throw new Error('o código expirou antes de você entrar. tente de novo.');
}

/* ------------------------------------------------------------
   passo 3 — Xbox Live, XSTS e Minecraft
   ------------------------------------------------------------ */
async function autenticarXbox(msToken: string) {
  const r = await fetch(XBL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msToken },
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

export async function concluirLogin(c: Codigo, passo: Passo = () => {}): Promise<ContaMS> {
  try {
    passo('esperando você entrar no navegador...');
    await anotar('aguardando aprovacao do codigo ' + c.user_code);
    const t = await esperarAprovacao(c);
    await anotar('microsoft: aprovado, token recebido');

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
  const refresh = (await lerCofre())[nick.toLowerCase()];
  if (!refresh) return null;

  const r = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh, scope: ESCOPO
    })
  });
  const j: any = await r.json();
  if (!r.ok || !j.access_token) return null;      /* expirou: precisa logar de novo */

  const conta = await montarConta(j.access_token);
  if (j.refresh_token) await guardarRefresh(conta.nick, j.refresh_token);
  return conta;
}
