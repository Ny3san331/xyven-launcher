import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  dialog: { showOpenDialog: (opts: unknown) => ipcRenderer.invoke('dialog:open', opts) },
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    pastaJogo: () => ipcRenderer.invoke('app:pastaJogo'),
    pastaExiste: (caminho: string) => ipcRenderer.invoke('app:pastaExiste', caminho),
    atualizacao: () => ipcRenderer.invoke('app:atualizacao'),
  },

  auth: {
    pedirCodigo: () => ipcRenderer.invoke('auth:pedirCodigo'),
    aguardar: () => ipcRenderer.invoke('auth:aguardar'),
    abortar: () => ipcRenderer.invoke('auth:abortar'),
    renovar: (nick: string) => ipcRenderer.invoke('auth:renovar', nick),
    esquecer: (nick: string) => ipcRenderer.invoke('auth:esquecer', nick),
    temRefresh: (nick: string) => ipcRenderer.invoke('auth:temRefresh', nick),
    aoPasso: (cb: (t: string) => void) => {
      const h = (_e: unknown, d: string) => cb(d);
      ipcRenderer.on('auth:passo', h);
      return () => ipcRenderer.removeListener('auth:passo', h);
    },
  },
  abrirLink: (url: string) => ipcRenderer.invoke('abrirLink', url),
  cosmeticos: (dados: unknown) => ipcRenderer.invoke('cosmeticos:aplicar', dados),
  copiar: (texto: string) => ipcRenderer.invoke('copiar', texto),

  java: {
    detectar: () => ipcRenderer.invoke('java:detectar'),
    exigido: (versao: string) => ipcRenderer.invoke('java:exigido', versao),
    limites: (javaPath?: string) => ipcRenderer.invoke('java:limites', javaPath),
  },

  mc: {
    lancar: (opts: unknown) => ipcRenderer.invoke('mc:lancar', opts),
    cancelar: () => ipcRenderer.invoke('mc:cancelar'),
    matar: () => ipcRenderer.invoke('mc:matar'),
    rodando: () => ipcRenderer.invoke('mc:rodando'),
    versoes: () => ipcRenderer.invoke('mc:versoes'),
    instaladas: (raiz: string) => ipcRenderer.invoke('mc:instaladas', raiz),
    instalarForge: (v: string, raiz: string) => ipcRenderer.invoke('mc:instalarForge', v, raiz),
    conta: (nick: string) => ipcRenderer.invoke('mc:conta', nick),
    /* eventos: devolvem funcao pra desinscrever */
    aoProgredir: (cb: (p: unknown) => void) => {
      const h = (_e: unknown, d: unknown) => cb(d);
      ipcRenderer.on('mc:progresso', h);
      return () => ipcRenderer.removeListener('mc:progresso', h);
    },
    aoLog: (cb: (linha: string) => void) => {
      const h = (_e: unknown, d: string) => cb(d);
      ipcRenderer.on('mc:log', h);
      return () => ipcRenderer.removeListener('mc:log', h);
    },
    aoSair: (cb: (codigo: number | null) => void) => {
      const h = (_e: unknown, d: number | null) => cb(d);
      ipcRenderer.on('mc:saiu', h);
      return () => ipcRenderer.removeListener('mc:saiu', h);
    },
  },
});