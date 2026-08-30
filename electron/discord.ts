/* ============================================================
   DISCORD RICH PRESENCE — implementação nativa sem biblioteca.
   Protocolo: named pipe no Windows (discord-ipc-0..9), JSON
   enquadrado com cabeçalho de 8 bytes (opcode int32 LE + length int32 LE).
   ============================================================ */
import { Socket, createServer } from 'net';
import { platform } from 'os';

/* ------------------------------------------------------------------
   CONFIGURAÇÃO
   ------------------------------------------------------------------ */
/* Application ID do Discord Developer Portal.
   O nome do Application DEVE ser exatamente "Xyven Client".
   Em Rich Presence → Art Assets, suba o ícone com a chave "xyven".
   Se o ID não estiver definido, o módulo vira no-op silencioso. */
export const DISCORD_CLIENT_ID =  '1543724495892652093'; // <-- COLE O APPLICATION ID AQUI (18-19 dígitos)

/* ------------------------------------------------------------------
   ESTADO INTERNO
   ------------------------------------------------------------------ */
let socket: Socket | null = null;
/* anotado: sem o tipo, o TS infere Buffer<ArrayBuffer> e recusa o
   Buffer<ArrayBufferLike> que lerFrames devolve */
let buffer: Buffer = Buffer.alloc(0);
let conectado = false;
let handshakeFeito = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let ligado = false;
let mostrarFita = true;

/* Último estado enviado (para não repetir) */
let ultimoEstadoEnviado: string | null = null;

/* Timestamp fixo do início da sessão (não recalcular a cada envio) */
let sessaoInicioTs = 0;

/* Fila de envio: guarda só o mais recente, respeita limite de 15s */
let estadoPendente: EstadoAtividade | null = null;
/* Ultimo estado pedido, mesmo ja enviado: numa reconexao o Discord
   esquece a presenca, e sem isso ela so voltaria na proxima mudanca. */
let ultimoEstado: EstadoAtividade | null = null;
let ultimoEnvioMs = 0;
const MIN_INTERVALO_MS = 15000;

/* ------------------------------------------------------------------
   TIPOS
   ------------------------------------------------------------------ */
export type EstadoAtividade = {
  jogando: boolean;
  versao?: string;
  servidor?: string;
  mostrarFita: boolean;
};

/* ------------------------------------------------------------------
   UTILITÁRIOS DE ENQUADRAMENTO
   ------------------------------------------------------------------ */
function escreverCabecalho(opcode: number, payload: Buffer): Buffer {
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeInt32LE(opcode, 0);
  cabecalho.writeInt32LE(payload.length, 4);
  return Buffer.concat([cabecalho, payload]);
}

function lerFrames(buf: Buffer): { frames: any[]; sobra: Buffer } {
  const frames: any[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const opcode = buf.readInt32LE(offset);
    const length = buf.readInt32LE(offset + 4);
    if (offset + 8 + length > buf.length) break;
    const jsonBuf = buf.slice(offset + 8, offset + 8 + length);
    try {
      frames.push({ opcode, data: JSON.parse(jsonBuf.toString('utf8')) });
    } catch {
      /* JSON inválido: ignora este frame */
    }
    offset += 8 + length;
  }
  return { frames, sobra: buf.slice(offset) };
}

/* ------------------------------------------------------------------
   CONEXÃO COM O DISCORD (NAMED PIPE NO WINDOWS)
   ------------------------------------------------------------------ */
function caminhoPipe(index: number): string {
  if (platform() === 'win32') {
    return `\\\\?\\pipe\\discord-ipc-${index}`;
  }
  /* Linux/macOS: socket unix em $XDG_RUNTIME_DIR/discord-ipc-{0..9}
     O dono só usa Windows, mas deixamos o caminho para não quebrar. */
  const runtime = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp';
  return `${runtime}/discord-ipc-${index}`;
}

function tentarConectar(): void {
  if (!DISCORD_CLIENT_ID) {
    console.log('[discord] Application ID não configurado — Rich Presence desativado');
    return;
  }
  if (conectado || socket) return;

  let tentativas = 0;
  const maxTentativas = 10;

  function proxima() {
    if (tentativas >= maxTentativas) {
      /* Falhou: agenda reconexão em ~30s */
      agendarReconexao();
      return;
    }
    const path = caminhoPipe(tentativas);
    const s = new Socket();
    s.setTimeout(2000);
    s.unref(); /* não impede o app de fechar */

    s.on('connect', () => {
      socket = s;
      /* Desarma o timeout. setTimeout() num socket e OCIOSIDADE, nao
         tempo de conexao: mantido, ele derrubava o pipe 2s depois do
         READY — e o Discord some com a presenca quando o socket cai.
         Era esse o "aparece e some". */
      s.setTimeout(0);
      buffer = Buffer.alloc(0);
      handshakeFeito = false;
      /* Handshake (opcode 0) */
      const payload = Buffer.from(JSON.stringify({ v: 1, client_id: DISCORD_CLIENT_ID }), 'utf8');
      s.write(escreverCabecalho(0, payload));
    });

    s.on('data', (pedaco) => {
      buffer = Buffer.concat([buffer, pedaco]);
      processarBuffer();
    });

    s.on('error', () => {
      s.destroy();
      /* Se este socket ja era o conectado, quem cuida e o 'close':
         varrer a lista de pipes de novo aqui abriria conexao paralela. */
      if (socket === s) return;
      tentativas++;
      proxima();
    });

    s.on('close', () => {
      if (socket === s) {
        socket = null;
        conectado = false;
        handshakeFeito = false;
        /* Não reconecta aqui — deixa o timer de reconexão fazer isso */
        if (ligado) agendarReconexao();
      }
    });

    s.on('timeout', () => {
      /* so acontece antes do connect, que desarma o timeout */
      s.destroy();
      if (socket === s) return;
      tentativas++;
      proxima();
    });

    s.connect(path);
  }

  proxima();
}

function agendarReconexao(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (ligado) tentarConectar();
  }, 30000);
}

function limparReconexao(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/* ------------------------------------------------------------------
   PROCESSAMENTO DE MENSAGENS RECEBIDAS
   ------------------------------------------------------------------ */
function processarBuffer(): void {
  if (!socket) return;
  const { frames, sobra } = lerFrames(buffer);
  buffer = sobra;

  for (const frame of frames) {
    if (frame.opcode === 3) {
      /* PING (opcode 3) → responde PONG (opcode 4) com mesmo corpo */
      socket.write(escreverCabecalho(4, Buffer.from(JSON.stringify(frame.data), 'utf8')));
      continue;
    }

    if (frame.opcode === 1) {
      /* FRAME: pode ser DISPATCH READY, ERROR, etc. */
      const evt = frame.data?.evt;
      const cmd = frame.data?.cmd;
      const nonce = frame.data?.nonce;

      if (evt === 'READY') {
        conectado = true;
        handshakeFeito = true;
        console.log('[discord] Conectado (READY)');
        /* Conexao nova: o Discord nao lembra da presenca anterior, entao
           o limite de 15s e o "nao repetir" nao podem barrar o reenvio. */
        ultimoEnvioMs = 0;
        ultimoEstadoEnviado = null;
        const aMandar = estadoPendente || ultimoEstado;
        if (aMandar) enviarAtividadeAgora(aMandar);
      } else if (evt === 'ERROR') {
        const msg = frame.data?.data?.message || JSON.stringify(frame.data);
        console.warn('[discord] Erro do Discord:', msg);
        /* Se o erro foi no SET_ACTIVITY, limpa o pendente pra não loopar */
        if (frame.data?.data?.code === 4000 || msg.includes('activity') || msg.includes('asset')) {
          console.warn('[discord] Erro na atividade — verifique se o ícone "xyven" existe em Art Assets no portal do Discord');
          estadoPendente = null;
        }
      } else if (cmd === 'SET_ACTIVITY' && nonce) {
        console.log('[discord] SET_ACTIVITY confirmado:', nonce);
      }
    }
  }
}

/* ------------------------------------------------------------------
   ENVIO DE ATIVIDADE
   ------------------------------------------------------------------ */
function montarAtividade(e: EstadoAtividade): any {
  const base = {
    timestamps: sessaoInicioTs ? { start: sessaoInicioTs } : undefined,
    assets: { large_image: 'xyven', large_text: 'Xyven Client' }
  };

  /* So no launcher: uma linha, "No menu". */
  if (!e.jogando) return { ...base, details: 'No menu' };

  /* Jogando: a versao entra na propria linha, nao numa segunda.
     O servidor, quando houver, vira a segunda linha. */
  const details = (e.mostrarFita && e.versao)
    ? `Jogando Minecraft ${e.versao}`
    : 'Jogando Minecraft';

  return (e.mostrarFita && e.servidor)
    ? { ...base, details, state: e.servidor }
    : { ...base, details };
}

function atividadeIgual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function enviarAtividadeAgora(e: EstadoAtividade): void {
  if (!socket || !conectado || !handshakeFeito) {
    estadoPendente = e;
    return;
  }

  const agora = Date.now();
  if (agora - ultimoEnvioMs < MIN_INTERVALO_MS) {
    /* Guarda o mais recente e deixa o timer enviar quando der tempo */
    estadoPendente = e;
    return;
  }

  const atividade = montarAtividade(e);
  const payloadStr = JSON.stringify({
    cmd: 'SET_ACTIVITY',
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    args: { pid: process.pid, activity: atividade }
  });

  const payload = Buffer.from(payloadStr, 'utf8');
  socket.write(escreverCabecalho(1, payload));
  ultimoEnvioMs = agora;
  ultimoEstadoEnviado = JSON.stringify(atividade);
  estadoPendente = null;
}

/* Timer que envia o estado pendente quando o intervalo de 15s permite */
function iniciarTimerEnvio(): void {
  if (updateTimer) return;
  updateTimer = setInterval(() => {
    if (estadoPendente && conectado && handshakeFeito) {
      const agora = Date.now();
      if (agora - ultimoEnvioMs >= MIN_INTERVALO_MS) {
        enviarAtividadeAgora(estadoPendente);
      }
    }
  }, 1000);
}

function pararTimerEnvio(): void {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

/* ------------------------------------------------------------------
   API PÚBLICA
   ------------------------------------------------------------------ */
export function ligar(): void {
  if (ligado) return;
  ligado = true;
  if (!DISCORD_CLIENT_ID) {
    console.log('[discord] Application ID não configurado — Rich Presence desativado');
    return;
  }
  /* marca o inicio aqui: assim o relogio ja comeca a correr no menu,
     sem depender da primeira mudanca de estado */
  if (!sessaoInicioTs) sessaoInicioTs = Date.now();
  tentarConectar();
  iniciarTimerEnvio();
}

export function desligar(): void {
  if (!ligado) return;
  ligado = false;
  limparReconexao();
  pararTimerEnvio();

  /* Limpa a atividade no Discord antes de desconectar */
  if (socket && conectado && handshakeFeito) {
    const payloadStr = JSON.stringify({
      cmd: 'SET_ACTIVITY',
      nonce: `${Date.now()}-clear`,
      args: { pid: process.pid, activity: null }
    });
    socket.write(escreverCabecalho(1, Buffer.from(payloadStr, 'utf8')));
    /* Dá um tempinho pro pipe esvaziar antes de destruir */
    setTimeout(() => destruirSocket(), 100);
  } else {
    destruirSocket();
  }
}

function destruirSocket(): void {
  if (socket) {
    socket.destroy();
    socket = null;
  }
  conectado = false;
  handshakeFeito = false;
  buffer = Buffer.alloc(0);
  estadoPendente = null;
  ultimoEstadoEnviado = null;
  sessaoInicioTs = 0;      /* proxima sessao recomeca o relogio */
}

export function definirEstado(e: EstadoAtividade): void {
  if (!ligado) return;

  /* O relogio conta a sessao inteira, do launcher aberto ate fechar.
     Antes ele zerava fora do jogo, e com sessaoInicioTs = 0 o campo
     timestamps saia undefined — ou seja, no menu nao existia relogio
     nenhum. Agora so e zerado no desligar(). */
  if (!sessaoInicioTs) sessaoInicioTs = Date.now();

  /* Atualiza a flag de mostrar fita */
  mostrarFita = e.mostrarFita;
  ultimoEstado = e;

  /* Se rpcTape desligado, força state = "No menu" */
  const estadoParaEnviar: EstadoAtividade = {
    ...e,
    mostrarFita: e.mostrarFita,
    versao: e.mostrarFita ? e.versao : undefined,
    servidor: e.mostrarFita ? e.servidor : undefined
  };

  /* Não envia se for idêntico ao último */
  const atividadeNova = montarAtividade(estadoParaEnviar);
  const chaveNova = JSON.stringify(atividadeNova);
  if (chaveNova === ultimoEstadoEnviado) return;

  enviarAtividadeAgora(estadoParaEnviar);
}