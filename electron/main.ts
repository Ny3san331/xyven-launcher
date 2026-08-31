import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron';
import { join } from 'path';
import * as mc from './minecraft';
import * as auth from './auth';
import * as servidores from './servidores';
import * as prints from './prints';
import * as xyvenapi from './xyvenapi';
import * as discord from './discord';
import { copyFile, mkdir, stat, writeFile, unlink, readdir } from 'fs/promises';
import { createWriteStream } from 'fs';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
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
    icon: join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
    show: false, // não mostra até estar pronto
  });

  /* Repassa o console da janela pro terminal. Sem isto, todo console.log
     do renderer morre no DevTools — e diagnosticar pelo terminal vira
     adivinhacao, porque a ausencia de log parece ausencia de execucao. */
  win.webContents.on('console-message', (_e, nivel, texto) => {
    const marca = nivel >= 2 ? '[renderer:erro]' : '[renderer]';
    console.log(marca + ' ' + texto);
  });

  win.once('ready-to-show', () => {
    console.log('[main] window ready-to-show');
    win.show();
  });

  win.on('closed', () => console.log('[main] window closed'));

  win.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[main] did-fail-load:', code, desc);
  });

  win.webContents.on('render-process-gone', (e, details) => {
    console.error('[main] render-process-gone:', details);
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

  /* "Abrir com o PC". O estado real mora no Windows, nao no nosso storage:
     ler de volta e o unico jeito do toggle nao mentir depois de um reboot
     ou de o usuario ter desligado o item por fora. */
  ipcMain.handle('app:autostart', (_e, ligar: boolean) => {
    app.setLoginItemSettings({ openAtLogin: !!ligar });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('app:autostartEstado', () => app.getLoginItemSettings().openAtLogin);
  /* %APPDATA%\.minecraft da maquina atual — nunca um caminho fixo */
  ipcMain.handle('app:pastaJogo', () => join(app.getPath('appData'), '.minecraft'));
  /* o renderer usa isso pra desconfiar de um caminho salvo torto */
  ipcMain.handle('app:pastaExiste', async (_e, caminho: string) => {
    if (!caminho) return false;
    return stat(caminho).then((s) => s.isDirectory(), () => false);
  });

  /* ---------- verificar atualização ----------
     compara a versão do app com a última Release do repositório. */
  ipcMain.handle('app:atualizacao', async () => {
    const atual = app.getVersion();
    const nums = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    /* compara numero a numero: 1.10.0 e maior que 1.9.0 */
    const maiorQue = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
      }
      return false;
    };
    try {
      /* A lista, e nao /releases/latest. O "latest" do GitHub e a release
         publicada mais recentemente, nao a de maior versao, e ele omite
         pre-releases sem avisar. Nos dois casos alguem desatualizado seria
         informado de que estava em dia — que e justamente o erro a evitar. */
      const r = await fetch(
        'https://api.github.com/repos/Ny3san331/xyven-launcher/releases?per_page=100',
        { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Xyven-Launcher' } }
      );
      if (!r.ok) return { ok: false, atual, erro: 'GitHub respondeu ' + r.status + '.' };

      const lista: any = await r.json();
      const limpo = (t: unknown) => String(t || '').replace(/^v/i, '');
      const validas = (Array.isArray(lista) ? lista : [])
        .filter((x: any) => x && !x.draft && !x.prerelease && limpo(x.tag_name));
      if (!validas.length) return { ok: true, atual, nenhuma: true };

      let melhor = validas[0];
      for (const c of validas) {
        if (maiorQue(nums(limpo(c.tag_name)), nums(limpo(melhor.tag_name)))) melhor = c;
      }
      const ultima = limpo(melhor.tag_name);

      return {
        ok: true, atual, ultima,
        temNova: maiorQue(nums(ultima), nums(atual)),
        link: melhor.html_url || null
      };
    } catch (e: any) {
      return { ok: false, atual, erro: 'sem conexão com o GitHub.' };
    }
  });

  /* Baixa a Release e instala. Antes so abriamos a pagina de download e a
     pessoa se virava — o que na pratica significava nunca atualizar.

     O binario e verificado antes de rodar: o SHA-256 e calculado enquanto o
     arquivo desce e comparado com o digest que a propria API do GitHub
     informa. Nao batendo, o arquivo e apagado e nada e executado. Baixar e
     rodar um .exe sem conferir seria o tipo de coisa que transforma uma
     atualizacao em vetor de ataque. */
  ipcMain.handle('app:baixarAtualizacao', async () => {
    const cabecalho = { Accept: 'application/vnd.github+json', 'User-Agent': 'Xyven-Launcher' };
    let destino = '';
    try {
      const r = await fetch(
        'https://api.github.com/repos/Ny3san331/xyven-launcher/releases?per_page=100',
        { headers: cabecalho }
      );
      if (!r.ok) return { ok: false, erro: 'GitHub respondeu ' + r.status + '.' };

      const lista: any = await r.json();
      const nums = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
      const limpo = (t: unknown) => String(t || '').replace(/^v/i, '');
      const maiorQue = (a: number[], b: number[]) => {
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
        }
        return false;
      };
      const validas = (Array.isArray(lista) ? lista : [])
        .filter((x: any) => x && !x.draft && !x.prerelease && limpo(x.tag_name));
      if (!validas.length) return { ok: false, erro: 'nenhuma versão publicada.' };

      let melhor = validas[0];
      for (const c of validas) {
        if (maiorQue(nums(limpo(c.tag_name)), nums(limpo(melhor.tag_name)))) melhor = c;
      }
      if (!maiorQue(nums(limpo(melhor.tag_name)), nums(app.getVersion()))) {
        return { ok: false, erro: 'você já está na versão mais recente.' };
      }

      const asset = (melhor.assets || []).find((a: any) => /\.exe$/i.test(a.name || ''));
      if (!asset) return { ok: false, erro: 'esta versão não tem instalador anexado.' };

      const esperado = String(asset.digest || '').replace(/^sha256:/i, '').toLowerCase();
      const total = Number(asset.size) || 0;

      const bin = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Xyven-Launcher' } });
      if (!bin.ok || !bin.body) return { ok: false, erro: 'não consegui baixar (HTTP ' + bin.status + ').' };

      destino = join(tmpdir(), asset.name);
      const arquivo = createWriteStream(destino);
      const hash = createHash('sha256');
      let baixado = 0, ultimo = -1;

      for await (const pedaco of bin.body as any) {
        const buf = Buffer.from(pedaco);
        hash.update(buf);
        baixado += buf.length;
        if (!arquivo.write(buf)) await new Promise((res) => arquivo.once('drain', res));
        const pct = total ? Math.floor((baixado / total) * 100) : 0;
        if (pct !== ultimo && !win.isDestroyed()) {
          ultimo = pct;
          win.webContents.send('atualizacao:progresso', { pct, baixado, total });
        }
      }
      await new Promise((res, rej) => { arquivo.end(); arquivo.on('finish', res); arquivo.on('error', rej); });

      if (total && baixado !== total) {
        await unlink(destino).catch(() => {});
        return { ok: false, erro: 'o download veio incompleto.' };
      }
      const obtido = hash.digest('hex');
      /* sem digest publicado nao da pra afirmar que o arquivo esta integro:
         melhor recusar do que executar as cegas */
      if (!esperado) {
        await unlink(destino).catch(() => {});
        return { ok: false, erro: 'o GitHub não informou o hash; não vou executar sem conferir.' };
      }
      if (obtido !== esperado) {
        await unlink(destino).catch(() => {});
        return { ok: false, erro: 'o arquivo baixado não confere com o publicado. cancelei por segurança.' };
      }

      return { ok: true, caminho: destino, versao: limpo(melhor.tag_name) };
    } catch (e: any) {
      if (destino) await unlink(destino).catch(() => {});
      return { ok: false, erro: e?.message || 'falha ao baixar.' };
    }
  });

  /* Atualiza sem mostrar assistente nenhum.

     '/S' e o modo silencioso do NSIS: sem janela, sem perguntar pasta. Ele
     le do registro onde a versao anterior foi instalada e substitui por
     cima, entao a instalacao existente e atualizada em vez de duplicada.
     '--force-run' faz o proprio instalador reabrir o Xyven no fim.

     O launcher precisa sair: com ele aberto o NSIS nao consegue trocar os
     arquivos em uso. */
  ipcMain.handle('app:instalarAtualizacao', (_e, caminho: string) => {
    if (!caminho) return { ok: false, erro: 'nada para instalar.' };
    try {
      spawn(caminho, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 800);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, erro: e?.message || 'não consegui iniciar a atualização.' };
    }
  });

  /* ---------- Java ---------- */
  /* ---------- login Microsoft (fluxo de código do CmlLib) ---------- */
  ipcMain.handle('auth:entrar', async () => {
    const passo = (t: string) => { if (!win.isDestroyed()) win.webContents.send('auth:passo', t); };
    try {
      const conta = await auth.entrar(win.isDestroyed() ? null : win, passo);
      /* null = fechou a janela; não é erro, é desistência */
      if (!conta) return { ok: false, cancelado: true };
      return { ok: true, conta };
    } catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('auth:abortar', () => { auth.abortarLogin(); return true; });
  ipcMain.handle('auth:renovar', async (_e, nick: string) => {
    try { return { ok: true, conta: await auth.renovar(nick) }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('auth:esquecer', (_e, nick: string) => auth.esquecerConta(nick));
  /* troca a skin no perfil da Mojang — é o que faz valer dentro do jogo */
  ipcMain.handle('auth:trocarSkin', async (_e, d: { token: string; url: string; slim: boolean }) => {
    try {
      await auth.trocarSkin(String(d.token), String(d.url), !!d.slim);
      return { ok: true };
    } catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('auth:temRefresh', (_e, nick: string) => auth.temRefresh(nick));
  /* status dos servidores fixos: ping direto, sem API de terceiro */
  ipcMain.handle('servidores:status', async (_e, lista: string[]) => {
    try { return { ok: true, status: await servidores.pingarVarios((lista || []).map(String)) }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });

  /* ---------- Discord Rich Presence ---------- */
  ipcMain.handle('discord:ligar', () => { discord.ligar(); return true; });
  ipcMain.handle('discord:estado', (_e, estado: any) => { discord.definirEstado(estado); return true; });
  ipcMain.handle('discord:desligar', () => { discord.desligar(); return true; });
  /* API do Xyven: cargos e capas compartilhados entre as máquinas */
  ipcMain.handle('xyven:identificar', (_e, token: string) => xyvenapi.identificar(String(token)));
  ipcMain.handle('xyven:consultar', (_e, nick: string) => xyvenapi.consultar(String(nick)));
  ipcMain.handle('xyven:gift', (_e, token: string, alvo: string, item: string, acao: string) =>
    xyvenapi.gift(String(token), String(alvo), String(item), acao === 'tirar' ? 'tirar' : 'dar'));
  ipcMain.handle('xyven:grupo', (_e, token: string, alvo: string, grupo: string) =>
    xyvenapi.grupo(String(token), String(alvo), String(grupo)));

  /* prints do jogo: lista leve, imagem sob demanda */
  ipcMain.handle('prints:listar', async (_e, gameDir: string) => {
    try { return { ok: true, prints: await prints.listar(mc.pastaPerfil(String(gameDir))) }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  /* copia a imagem em si pra área de transferência: colar no Discord
     ou no Paint tem que trazer a foto, não o caminho dela em texto */
  ipcMain.handle('prints:copiar', (_e, gameDir: string, arquivo: string) => {
    try {
      const caminho = prints.caminhoDe(mc.pastaPerfil(String(gameDir)), String(arquivo));
      if (!caminho) return { ok: false, erro: 'nome de arquivo inválido.' };
      const img = nativeImage.createFromPath(caminho);
      if (img.isEmpty()) return { ok: false, erro: 'não consegui ler a imagem.' };
      clipboard.writeImage(img);
      return { ok: true };
    } catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('prints:ler', async (_e, gameDir: string, arquivo: string) => {
    try { return { ok: true, dados: await prints.ler(mc.pastaPerfil(String(gameDir)), String(arquivo)) }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('copiar', (_e, texto: string) => { clipboard.writeText(String(texto || '')); return true; });
  ipcMain.handle('abrirLink', (_e, url: string) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);   /* só https sai daqui */
    return true;
  });

  /* ---------- cosmeticos: contrato com o mod ----------
     escreve <perfil>/cosmetics.json + a textura em <perfil>/capes/,
     para o mod dentro do jogo ler sem precisar falar com o launcher.
     O perfil e o --gameDir passado ao jogo, entao o caminho gravado
     em `file` e relativo a ele. */
  ipcMain.handle('cosmeticos:aplicar', async (_e, dados) => {
    try {
      const destino = mc.pastaPerfil(dados.gameDir);
      await mkdir(join(destino, 'capes'), { recursive: true });

      const pastaCapas = join(destino, 'capes');
      const deOnde = (n: string) => join(__dirname, '..', 'renderer', 'main_window', 'capes', n);

      /* Copia o catálogo inteiro, não só a escolhida. O menu de capas dentro
         do jogo lista o que existe nesta pasta: copiando uma só, ele mostrava
         uma opção só e não dava pra trocar de nada. */
      const catalogo: Array<{ id: string; name: string; arquivo: string }> =
        Array.isArray(dados.catalogo) ? dados.catalogo : [];
      const nossos = new Set<string>();
      for (const c of catalogo) {
        if (!c || !c.arquivo) continue;
        try { await copyFile(deOnde(c.arquivo), join(pastaCapas, c.arquivo)); nossos.add(c.arquivo); }
        catch { /* capa que nao veio no pacote: ignora */ }
      }

      /* tira as que o launcher deixou lá em versões anteriores e não existem
         mais — senão o menu do jogo continua oferecendo capa aposentada */
      if (catalogo.length) {
        for (const n of await readdir(pastaCapas).catch(() => [] as string[])) {
          if (/\.png$/i.test(n) && !nossos.has(n)) await unlink(join(pastaCapas, n)).catch(() => {});
        }
      }

      let arquivoCapa: string | null = null;
      if (dados.capa && dados.capa.arquivo) {
        try { await copyFile(deOnde(dados.capa.arquivo), join(pastaCapas, dados.capa.arquivo)); }
        catch { /* ja copiada acima, ou ausente */ }
        arquivoCapa = 'capes/' + dados.capa.arquivo;
      }

      /* catálogo em disco: o mod usa isto para os nomes e a ordem, e cai
         para varrer a pasta se o arquivo não existir */
      if (catalogo.length) {
        await writeFile(join(destino, 'capes.json'), JSON.stringify({
          version: 1,
          capes: catalogo.map((c) => ({
            id: c.id, name: c.name, file: 'capes/' + c.arquivo, source: 'launcher'
          }))
        }, null, 2));
      }

      await writeFile(join(destino, 'cosmetics.json'), JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        player: { name: dados.nick, uuid: dados.uuid || null },
        cape: dados.capa ? {
          id: dados.capa.id,
          source: dados.capa.origem,              /* 'launcher' | 'mojang' | null */
          file: arquivoCapa,                      /* relativo ao gameDir (o perfil) */
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
  ipcMain.handle('java:limites', (_e, javaPath?: string) => mc.limitesDeMemoria(javaPath));

  /* ---------- Minecraft ---------- */
  ipcMain.handle('mc:versoes', () => mc.listarVersoes());
  ipcMain.handle('mc:instalarForge', async (_e, mcVersao: string, raiz: string) => {
    const enviar = (p: unknown) => { if (!win.isDestroyed()) win.webContents.send('mc:progresso', p); };
    try { return { ok: true, ...(await mc.instalarForge(mcVersao, raiz, enviar)) }; }
    catch (e: any) { return { ok: false, erro: e?.message || String(e) }; }
  });
  ipcMain.handle('mc:instaladas', (_e, raiz: string) => mc.versoesInstaladas(raiz));
  ipcMain.handle('mc:rodando', (_e, gameDir?: string) => mc.jogoRodando(gameDir));
  ipcMain.handle('mc:cancelar', () => { mc.cancelar(); return true; });
  ipcMain.handle('mc:matar', async (_e, gameDir?: string) => { await mc.matarJogo(gameDir); return true; });

  /* o launcher pode ter sido fechado com o jogo aberto ("Fechar ao tocar"):
     ao voltar, reencontra o processo e volta a seguir o log dele */
  ipcMain.handle('mc:retomar', async (_e, gameDir: string) => {
    const enviar = (canal: string, dado: unknown) => {
      if (!win.isDestroyed()) win.webContents.send(canal, dado);
    };
    try {
      return await mc.retomarSessao(gameDir,
        (linha) => enviar('mc:log', linha),
        (codigo) => enviar('mc:saiu', codigo));
    } catch { return null; }
  });

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
app.on('before-quit', () => { console.log('[main] before-quit'); discord.desligar(); });

process.on('uncaughtException', (e) => console.error('[main] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[main] unhandledRejection:', e));