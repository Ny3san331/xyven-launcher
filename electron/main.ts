import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import * as mc from './minecraft';
import * as auth from './auth';
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

  ipcMain.handle('mc:conta', (_e, nick: string) => mc.contaMojang(nick));
  ipcMain.handle('java:detectar', () => mc.detectarJava());
  ipcMain.handle('java:exigido', (_e, versao: string) => mc.javaExigido(versao));

  /* ---------- Minecraft ---------- */
  ipcMain.handle('mc:versoes', () => mc.listarVersoes());
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