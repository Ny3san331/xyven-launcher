/* ============================================================
   LOGIN MICROSOFT — registro proprio no Entra.

   Antes o launcher usava o client id do launcher OFICIAL do
   Minecraft, emprestado do CmlLib.Core. Funcionava porque aquele
   id ja esta na lista de permissao da Mojang — a nossa nao estava,
   e um app proprio levava 403 da API do Minecraft.

   Agora o nosso appId foi aprovado pela Mojang (31/08/2026), entao
   da pra usar o registro proprio. Duas diferencas que quebram tudo
   se passarem batidas:

     - o endpoint e o do Entra, nao o antigo do Live
     - o RpsTicket vai com o prefixo `d=`, que o fluxo antigo NAO
       usava (ver o passo do Xbox Live la embaixo)

   Cliente PUBLICO com PKCE: launcher e .exe na maquina de quem usa,
   e segredo dentro de .exe qualquer um extrai. O PKCE protege o
   fluxo sem nada secreto ir junto.

   O usuário entra numa janela separada; o launcher nunca vê a
   senha. Só o processo principal fala com a rede.

   Cadeia: Entra -> Xbox Live -> XSTS -> Minecraft -> perfil.
   ============================================================ */
import { app, safeStorage, shell } from 'electron';
import { createServer, type Server } from 'http';
import { readFile, writeFile, mkdir, unlink, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import { randomBytes, createHash } from 'crypto';

/* Registro do Xyven no Entra. E identificador publico, nao segredo:
   vai dentro de todo launcher que fala com a Microsoft. */
export const CLIENT_ID = '0f601ed2-cbe5-4c04-bf9b-16aabbd69714';

/* `offline_access` e o que devolve refresh_token — sem ele a pessoa
   reloga a cada hora. */
const ESCOPO = 'XboxLive.signin offline_access';

/* /consumers e nao /common: conta do Minecraft e conta PESSOAL.
   Com /common uma conta corporativa entra no fluxo, vai ate o fim e
   so falha no passo do Minecraft, com um erro que nao explica nada. */
const ENTRA = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const OAUTH_AUTORIZAR = ENTRA + '/authorize';
const OAUTH_TOKEN = ENTRA + '/token';

/* Volta pelo NAVEGADOR de verdade, num servidor local.

   Registrar no portal como `http://localhost` (sem porta). Cliente
   publico tem excecao de loopback: a porta e ignorada na comparacao,
   entao da pra usar uma porta sorteada a cada login em vez de fixar
   uma que pode estar ocupada.

   Por que nao a janela embutida: ela nao tem barra de endereco, entao
   a pessoa nao consegue conferir que esta mesmo na Microsoft — e e
   exatamente assim que golpe de login funciona. No navegador dela o
   cadeado e o dominio estao a vista, e o gerenciador de senhas dela
   funciona. */
const OAUTH_REDIRECT_BASE = 'http://localhost';

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
   passo 1 e 2 — o login, no navegador da pessoa

   Nao ha mais janela embutida. Ela nao tem barra de endereco, entao
   nao dava pra conferir que a pagina era mesmo da Microsoft — e e
   assim que golpe de login funciona. No navegador dela o dominio e o
   cadeado estao a vista, e o gerenciador de senhas dela funciona.

   Cada login sorteia uma porta local. `prompt=select_account` cuida
   do que a particao descartavel cuidava antes: a Microsoft pergunta
   qual conta, em vez de entrar direto com a ultima.
   ------------------------------------------------------------ */

/* O redirect muda a cada login (porta sorteada) e a troca do code
   precisa mandar exatamente o mesmo — o Entra confere. */
let redirectAtual = '';
let servidorLogin: Server | null = null;

export function abortarLogin() {
  /* Cancelar tem que derrubar a porta. Sem isto ela ficava escutando
     ate o app fechar, e a proxima tentativa abriria outra. */
  if (servidorLogin) { servidorLogin.close(); servidorLogin = null; }
}

/* ------------------------------------------------------------
   PKCE

   O `code` volta pela barra de endereco e nao e segredo. Sozinho ele
   nao serve: a troca por token exige o `code_verifier`, que so este
   processo conhece e nunca sai daqui.

   Guardado num let e nao passado adiante porque so existe UM login
   em andamento por vez — pedirCodigoNaJanela aborta o anterior.
   ------------------------------------------------------------ */
let verificadorPkce = '';

function base64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function novoPkce(): string {
  verificadorPkce = base64url(randomBytes(32));
  return base64url(createHash('sha256').update(verificadorPkce).digest());
}

/* `state` amarra a resposta a ESTE pedido. O servidor local aceita
   conexao de qualquer coisa rodando na maquina; sem conferir o state,
   outro programa poderia mandar um code dele na nossa porta e a conta
   logada seria a dele, nao a de quem clicou. */
let estadoAtual = '';

function urlAutorizacao(redirect: string): string {
  estadoAtual = base64url(randomBytes(16));
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: ESCOPO,
    redirect_uri: redirect,
    response_type: 'code',
    response_mode: 'query',
    prompt: 'select_account',
    state: estadoAtual,
    code_challenge: novoPkce(),
    code_challenge_method: 'S256'
  });
  return OAUTH_AUTORIZAR + '?' + q.toString();
}

/* o que a pessoa ve no navegador quando termina */
function paginaDeVolta(titulo: string, recado: string): string {
  return '<!doctype html><meta charset="utf-8">' +
    '<title>Xyven</title>' +
    '<body style="margin:0;height:100vh;display:grid;place-items:center;' +
    'background:#e9d9b8;color:#33261c;font:15px ui-monospace,monospace;text-align:center">' +
    '<div style="border:3px solid #33261c;background:#f4e7ca;box-shadow:6px 6px 0 #33261c;' +
    'padding:28px 34px;max-width:420px">' +
    '<div style="font-size:20px;font-weight:700;margin-bottom:10px">' + titulo + '</div>' +
    '<div style="line-height:1.7">' + recado + '</div></div></body>';
}

/* devolve o code do redirect, ou null se a pessoa fechou a janela */
function pedirCodigoNoNavegador(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    abortarLogin();

    let terminou = false;
    let srv: Server | null = null;

    const acabar = (fn: () => void) => {
      if (terminou) return;
      terminou = true;
      /* fecha ANTES de resolver: a porta tem que sair do ar assim que
         o code chega, senao ela fica escutando durante todo o resto do
         fluxo (Xbox, XSTS, Minecraft) sem precisar */
      if (srv) { srv.close(); srv = null; }
      servidorLogin = null;
      fn();
    };

    srv = createServer((req, res) => {
      /* Sem host de verdade na requisicao de loopback: a base aqui e
         so pra o URL parsear. */
      const q = new URL(req.url || '/', 'http://localhost').searchParams;
      const code = q.get('code');
      const erro = q.get('error');

      /* nem code nem erro: e o favicon, ou alguem batendo na porta */
      if (!code && !erro) { res.writeHead(404).end(); return; }

      if (q.get('state') !== estadoAtual) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaDeVolta('Isso não veio daqui',
          'o pedido não bate com o que o launcher abriu. tente entrar de novo.'));
        return;   /* NAO encerra o fluxo: o de verdade ainda pode chegar */
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

      if (code) {
        res.end(paginaDeVolta('Pronto', 'pode fechar esta aba e voltar pro launcher.'));
        acabar(() => resolve(code));
      } else {
        res.end(paginaDeVolta('Não deu', 'volte ao launcher e tente de novo.'));
        acabar(() => reject(new Error(traduzOAuth({
          error: erro, error_description: q.get('error_description')
        }))));
      }
    });

    srv.on('error', (e: any) => {
      acabar(() => reject(new Error('não consegui abrir a porta local: ' + (e?.message || e))));
    });

    /* 127.0.0.1 e nao 0.0.0.0: a porta so aceita conexao desta
       maquina. Aberta na rede, qualquer um do lado de ca do roteador
       poderia mandar um code. */
    srv.listen(0, '127.0.0.1', () => {
      const info = srv && srv.address();
      const porta = info && typeof info === 'object' ? info.port : 0;
      if (!porta) return acabar(() => reject(new Error('não consegui abrir a porta local.')));

      servidorLogin = srv;
      const redirect = OAUTH_REDIRECT_BASE + ':' + porta;
      redirectAtual = redirect;
      shell.openExternal(urlAutorizacao(redirect)).catch((e) => {
        acabar(() => reject(new Error('não consegui abrir o navegador: ' + (e?.message || e))));
      });
    });
  });
}

/* troca o code pelo token. Sem client_secret de proposito: o
   registro e cliente publico, e o que prova a posse e o PKCE. */
async function trocarCodigoPorToken(code: string) {
  const r = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: ESCOPO,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectAtual,
      code_verifier: verificadorPkce
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
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        /* `d=` obrigatorio pra token do Entra. O fluxo antigo do Live
           mandava cru — trocar o endpoint sem trocar isto devolve um
           400 do Xbox Live que nao diz o motivo. */
        RpsTicket: 'd=' + msToken
      },
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

export async function entrar(passo: Passo = () => {}): Promise<ContaMS | null> {
  try {
    passo('abrimos a Microsoft no seu navegador. termine por lá e volte.');
    await anotar('abrindo janela de login');
    const code = await pedirCodigoNoNavegador();
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

/* Marca de qual registro os tokens vieram.

   Refresh token pertence ao client id que o emitiu. Ao trocar o
   registro (o do CmlLib pelo nosso), os guardados viram lixo: a
   Microsoft recusa e o sintoma seria "nao consigo jogar", sem dizer
   que basta entrar de novo. Melhor descartar e pedir o login uma vez. */
const MARCA = '__clientId';

async function lerCofre(): Promise<Record<string, string>> {
  try {
    const bruto = await readFile(arquivoRefresh());
    const txt = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(bruto)
      : bruto.toString('utf8');
    const cofre = JSON.parse(txt) as Record<string, string>;

    if (cofre[MARCA] !== CLIENT_ID) {
      await anotar('cofre era de outro client id: descartando, sera preciso entrar de novo');
      await unlink(arquivoRefresh()).catch(() => {});
      return {};
    }
    return cofre;
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
  cofre[MARCA] = CLIENT_ID;
  cofre[nick.toLowerCase()] = refresh;
  await gravarCofre(cofre);
}

export async function esquecerConta(nick: string) {
  const cofre = await lerCofre();
  delete cofre[nick.toLowerCase()];
  /* a marca nao conta: sem isto, tirar a ultima conta deixava o
     arquivo vivo so com ela dentro */
  const sobrou = Object.keys(cofre).filter((k) => k !== MARCA).length;
  if (sobrou) await gravarCofre(cofre);
  else await unlink(arquivoRefresh()).catch(() => {});
}

export async function temRefresh(nick: string): Promise<boolean> {
  const chave = nick.toLowerCase();
  if (chave === MARCA) return false;   /* a marca nao e conta */
  return !!(await lerCofre())[chave];
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
      /* sem redirect_uri: o grant de refresh nao usa, e mandar o de
         uma porta que ja morreu so daria erro */
      grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh,
      scope: ESCOPO
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
