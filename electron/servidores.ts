/* ============================================================
   STATUS DOS SERVIDORES — Server List Ping do próprio Minecraft.

   É o mesmo handshake que a lista de servidores do jogo faz: abre
   TCP, pede status, recebe um JSON com jogadores online, versão e o
   ícone do servidor em base64. Sem API de terceiro no meio — nada
   do que o jogador acessa sai daqui pra outro serviço.

   Protocolo (1.7+):
     -> handshake  : 0x00, protocolo, host, porta, próximo estado = 1
     -> request    : 0x00, vazio
     <- response   : 0x00, string JSON

   Tudo em VarInt, que é o inteiro de tamanho variável da Mojang:
   sete bits de dado por byte, o oitavo diz se vem mais.
   ============================================================ */
import { Socket } from 'net';
import { resolveSrv } from 'dns/promises';

export type StatusServidor = {
  online: number | null;      /* null = não respondeu */
  max: number | null;
  icone: string | null;       /* data:image/png;base64,... */
  versao: string | null;
  erro?: string;
};

/* ---------------- VarInt ---------------- */
function escreverVarInt(n: number): Buffer {
  const bytes: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    bytes.push(b);
  } while (v);
  return Buffer.from(bytes);
}

/* devolve [valor, quantos bytes leu]; [null, 0] se ainda falta byte */
function lerVarInt(buf: Buffer, inicio: number): [number | null, number] {
  let valor = 0, deslocamento = 0, i = inicio;
  while (i < buf.length) {
    const b = buf[i++];
    valor |= (b & 0x7f) << deslocamento;
    if (!(b & 0x80)) return [valor >>> 0, i - inicio];
    deslocamento += 7;
    if (deslocamento > 35) return [null, 0];   /* varint corrompido */
  }
  return [null, 0];                            /* incompleto: espera mais rede */
}

function escreverString(s: string): Buffer {
  const dados = Buffer.from(s, 'utf8');
  return Buffer.concat([escreverVarInt(dados.length), dados]);
}

function pacote(...partes: Buffer[]): Buffer {
  const corpo = Buffer.concat(partes);
  return Buffer.concat([escreverVarInt(corpo.length), corpo]);
}

/* ---------------- SRV ----------------
   Muito servidor anuncia a porta real num registro SRV; sem consultar,
   conectar na 25565 do domínio principal simplesmente não responde.

   O registro quase nunca muda, e resolver de novo a cada atualização
   põe uma ida ao DNS na frente de todo ping. Guardado por meia hora,
   a consulta seguinte já começa direto no TCP. */
const cacheSrv = new Map<string, { alvo: { host: string; porta: number }; ate: number }>();
const SRV_TTL = 30 * 60 * 1000;

async function resolverDestino(host: string, porta: number) {
  if (porta !== 25565) return { host, porta };          /* porta explícita manda */

  const guardado = cacheSrv.get(host);
  if (guardado && guardado.ate > Date.now()) return guardado.alvo;

  let alvo = { host, porta };
  try {
    const rs = await resolveSrv('_minecraft._tcp.' + host);
    if (rs && rs.length) alvo = { host: rs[0].name, porta: rs[0].port };
  } catch { /* sem SRV: segue no host mesmo */ }

  cacheSrv.set(host, { alvo, ate: Date.now() + SRV_TTL });
  return alvo;
}

/* ---------------- ping ---------------- */
/* 2,5s: servidor vivo responde em bem menos que isso; o resto do tempo
   era só o card parado esperando um que nunca ia responder. */
export function pingar(endereco: string, timeoutMs = 2500): Promise<StatusServidor> {
  const vazio: StatusServidor = { online: null, max: null, icone: null, versao: null };

  const [hostBruto, portaBruta] = String(endereco).split(':');
  const host = (hostBruto || '').trim();
  const porta = Number(portaBruta) || 25565;
  if (!host) return Promise.resolve({ ...vazio, erro: 'endereço vazio' });

  return resolverDestino(host, porta).then((alvo) => new Promise<StatusServidor>((resolve) => {
    const sock = new Socket();
    let buf = Buffer.alloc(0);
    let pronto = false;

    const acabar = (r: StatusServidor) => {
      if (pronto) return;
      pronto = true;
      sock.destroy();
      resolve(r);
    };

    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => acabar({ ...vazio, erro: 'sem resposta' }));
    sock.on('error', (e: any) => acabar({ ...vazio, erro: e?.code || 'falha de conexão' }));

    sock.connect(alvo.porta, alvo.host, () => {
      sock.write(pacote(
        escreverVarInt(0x00),
        escreverVarInt(47),              /* protocolo 1.8; serve pra status em qualquer versão */
        escreverString(host),            /* o host ORIGINAL, não o do SRV: proxies filtram por ele */
        Buffer.from([porta >> 8, porta & 0xff]),
        escreverVarInt(1)
      ));
      sock.write(pacote(escreverVarInt(0x00)));
    });

    sock.on('data', (pedaco) => {
      buf = Buffer.concat([buf, pedaco]);

      /* o JSON costuma vir picado em vários TCP: só dá pra ler
         quando o tamanho anunciado no cabeçalho já chegou inteiro */
      const [tamanho, n1] = lerVarInt(buf, 0);
      if (tamanho === null) return;
      if (buf.length < n1 + tamanho) return;

      const [id, n2] = lerVarInt(buf, n1);
      if (id === null || id !== 0x00) return acabar({ ...vazio, erro: 'resposta inesperada' });

      const [tamJson, n3] = lerVarInt(buf, n1 + n2);
      if (tamJson === null) return;
      const inicio = n1 + n2 + n3;
      if (buf.length < inicio + tamJson) return;

      try {
        const j = JSON.parse(buf.slice(inicio, inicio + tamJson).toString('utf8'));
        acabar({
          online: Number(j?.players?.online ?? 0),
          max: Number(j?.players?.max ?? 0),
          versao: (j?.version?.name && String(j.version.name)) || null,
          /* o favicon já vem como data: URI; só aceita PNG pra não
             deixar um servidor injetar outro esquema na tag <img> */
          icone: (typeof j?.favicon === 'string' && j.favicon.startsWith('data:image/png;base64,'))
            ? j.favicon : null
        });
      } catch {
        acabar({ ...vazio, erro: 'JSON inválido' });
      }
    });
  }));
}

/* pinga vários de uma vez; um que falhe não derruba os outros */
export async function pingarVarios(enderecos: string[]) {
  const rs = await Promise.all(enderecos.map((e) => pingar(e).catch(() => ({
    online: null, max: null, icone: null, versao: null, erro: 'falhou'
  } as StatusServidor))));
  const saida: Record<string, StatusServidor> = {};
  enderecos.forEach((e, i) => { saida[e] = rs[i]; });
  return saida;
}
