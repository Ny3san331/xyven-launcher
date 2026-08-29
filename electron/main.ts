import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import * as mc from './minecraft';
import * as auth from './auth';
import { copyFile, mkdir, writeFile } from 'fs/promises';
import { shell, clipboard } from 'electron';

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 640,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#eddcbb',
    icon: join(__dirname, '../public/icon.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Handlers DENTRO do escopo onde 'win' existe
  ipcMain.on('window:minimize', () => win.minimize());
  ipcMain.on('window:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
  ipcMain.on('window:close', () => win.close());

  // Zoom controls (Ctrl+/-, Ctrl+0)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control) return;
    const wc = win.webContents;
    const z = wc.getZoomLevel();
    if (input.key === '+' || input.key === '=') {
      wc.setZoomLevel(Math.min(z + 0.5, 3));
      event.preventDefault();
    }
    if (input.key === '-' || input.key === '_') {
      wc.setZoomLevel(Math.max(z - 0.5, -3));
      event.preventDefault();
    }
    if (input.key === '0') {
      wc.setZoomLevel(0);
      event.preventDefault();
    }
  });

  /* ---------- diálogo de pasta e versão (o preload já expunha, faltava o handler) ---------- */
  ipcMain.handle('dialog:open', async (_e, opts) => dialog.showOpenDialog(win, opts || { properties: ['openDirectory'] }));
  ipcMain.handle('app:version', () => app.getVersion());
  /* %APPDATA%\.minecraft da maquina atual — nunca um caminho fixo */
  ipcMain.handle('app:pastaJogo', () => join(app.getPath('appData'), '.minecraft'));

  /* ---------- verificar atualização ----------
     compara a versão do app com a última Release do repositório. */
  ipcMain.handle('app:atualizacao', async () => {
    const atual = app.getVersion();
    try {
      const r = await fetch('https://api.github.com/repos/Ny3san331/xyven-launcher/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Xyven-Launcher' }
      });
      if (r.status === 404) return { ok: true, atual, nenhuma: true };
      if (!r.ok) return { ok: false, atual, erro: 'GitHub respondeu ' + r.status + '.' };

      const j: any = await r.json();
      const ultima = String(j.tag_name || '').replace(/^v/i, '');
      if (!ultima) return { ok: true, atual, nenhuma: true };

      /* compara número a número: 1.10.0 é maior que 1.9.0 */
      const nums = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
      const [a, b] = [nums(ultima), nums(atual)];
      let maior = false;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) { maior = (a[i] || 0) > (b[i] || 0); break; }
      }
      return { ok: true, atual, ultima, temNova: maior, link: j.html_url || null };
    } catch (e: any) {
      return { ok: false, atual, erro: 'sem conexão com o GitHub.' };
    }
  });

  /* ---------- Java ---------- */
  /* ---------- login Microsoft (device code) ---------- */
  let codigoAtual: any = null;
  ipcMain.handle('auth:pedirCodigo', async () => {
    try { codigoAtual = await auth.pedirCodigo(); return { ok: true, codigo: codigoAtual }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('auth:aguardar', async () => {
    if (!codigoAtual) return { ok: false, erro: 'nenhum login em andamento.' };
    const passo = (t: string) => { if (!win.isDestroyed()) win.webContents.send('auth:passo', t); };
    try { const conta = await auth.concluirLogin(codigoAtual, passo); codigoAtual = null; return { ok: true, conta }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('auth:abortar', () => { auth.abortarLogin(); codigoAtual = null; return true; });
  ipcMain.handle('auth:renovar', async (_e, nick: string) => {
    try { return { ok: true, conta: await auth.renovar(nick) }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('auth:esquecer', (_e, nick: string) => auth.esquecerConta(nick));
  ipcMain.handle('auth:temRefresh', (_e, nick: string) => auth.temRefresh(nick));
  ipcMain.handle('copiar', (_e, texto: string) => { clipboard.writeText(String(texto || '')); return true; });
  ipcMain.handle('abrirLink', (_e, url: string) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);   /* só https sai daqui */
    return true;
  });

  /* ---------- cosmeticos: contrato com o mod ----------
     escreve <gameDir>/xyven/cosmetics.json + a textura, para o mod
     dentro do jogo ler sem precisar falar com o launcher. */
  ipcMain.handle('cosmeticos:aplicar', async (_e, dados) => {
    try {
      const destino = join(dados.gameDir, 'xyven');
      await mkdir(join(destino, 'capes'), { recursive: true });

      let arquivoCapa: string | null = null;
      if (dados.capa && dados.capa.arquivo) {
        /* capa do launcher: copia o png pra pasta do jogo */
        const origem = join(__dirname, '..', 'renderer', 'main_window', 'capes', dados.capa.arquivo);
        await copyFile(origem, join(destino, 'capes', dados.capa.arquivo));
        arquivoCapa = 'xyven/capes/' + dados.capa.arquivo;
      }

      await writeFile(join(destino, 'cosmetics.json'), JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        player: { name: dados.nick, uuid: dados.uuid || null },
        cape: dados.capa ? {
          id: dados.capa.id,
          source: dados.capa.origem,              /* 'launcher' | 'mojang' | null */
          file: arquivoCapa,                      /* caminho relativo ao .minecraft */
          /* capa do launcher vem por arquivo; a da Mojang, por url */
          url: dados.capa.origem === 'launcher' ? null : (dados.capa.url || null)
        } : null,
        model: dados.slim ? 'slim' : 'classic'
      }, null, 2));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, erro: e?.message || String(e) };
    }
  });

  ipcMain.handle('mc:conta', (_e, nick: string) => mc.contaMojang(nick));
  ipcMain.handle('java:detectar', () => mc.detectarJava());
  ipcMain.handle('java:exigido', (_e, versao: string) => mc.javaExigido(versao));

  /* ---------- Minecraft ---------- */
  ipcMain.handle('mc:versoes', () => mc.listarVersoes());
  ipcMain.handle('mc:instalarForge', async (_e, mcVersao: string, raiz: string) => {
    const enviar = (p: unknown) => { if (!win.isDestroyed()) win.webContents.send('mc:progresso', p); };
    try { return { ok: true, ...(await mc.instalarForge(mcVersao, raiz, enviar)) }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('mc:instaladas', (_e, raiz: string) => mc.versoesInstaladas(raiz));
  ipcMain.handle('mc:rodando', () => mc.jogoRodando());
  ipcMain.handle('mc:cancelar', () => { mc.cancelar(); return true; });
  ipcMain.handle('mc:matar', () => { mc.matarJogo(); return true; });

  ipcMain.handle('mc:lancar', async (_e, opts) => {
    const enviar = (canal: string, dado: unknown) => {
      if (!win.isDestroyed()) win.webContents.send(canal, dado);
    };
    try {
      await mc.lancar(
        opts,
        (p) => enviar('mc:progresso', p),
        (l) => enviar('mc:log', l),
        (c) => enviar('mc:saiu', c)
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, erro: e?.message || String(e) };
    }
  });

  if (process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/main_window/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });