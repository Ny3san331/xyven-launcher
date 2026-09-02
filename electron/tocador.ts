/* ============================================================
   Servidor local do tocador

   O player do YouTube nao funciona numa pagina file://. Sem origin
   de verdade a requisicao chega sem Referer, e o embed responde
   "Este vídeo não está disponível — código 152", sem nada no console
   que explique. Testado: o MESMO video toca normalmente quando a
   pagina vem por http.

   Por que so o player mora aqui, e nao o launcher inteiro:
   localStorage e por origem. Mudar a janela de file:// pra
   http://127.0.0.1 apagaria contas, servidores, tema e ajustes de
   todo mundo que ja usa o Xyven — e uma porta sorteada apagaria de
   novo a cada boot. Entao a janela continua em file:// e SO o
   quadradinho do video vem daqui, dentro de um iframe.

   A conversa entre os dois e por postMessage, porque as origens sao
   diferentes de proposito e nada mais atravessa.

   O servidor escuta em 127.0.0.1 e serve UMA pagina, montada aqui
   dentro. Nao ha leitura de disco: nao existe caminho que ele possa
   ser convencido a entregar.
   ============================================================ */
import { createServer, type Server } from 'http';

/* Porta fixa e nao sorteada: o iframe herda a origem, e origem que
   muda a cada boot faria o YouTube tratar cada sessao como um site
   novo. 45737 e alta o bastante pra nao esbarrar em nada comum. */
export const PORTA_TOCADOR = 45737;
export const URL_TOCADOR = 'http://127.0.0.1:' + PORTA_TOCADOR + '/tocador.html';

let servidor: Server | null = null;

const PAGINA = `<!doctype html>
<meta charset="utf-8">
<title>tocador</title>
<style>
  html,body{margin:0;height:100%;background:#33261c;overflow:hidden}
  /* cinto e suspensorio: mesmo que o player insista num tamanho seu,
     nada aparece fora deste retangulo */
  body{position:fixed;inset:0}
  #p,iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
</style>
<div id="p"></div>
<script>
  /* Quem manda e a janela do launcher, do outro lado do postMessage.
     Esta pagina nao tem botao nenhum: os controles sao os do tema, la. */
  var player = null, pronto = false, pendente = null;

  function avisar(tipo, dados) {
    parent.postMessage(Object.assign({ de: 'tocador', tipo: tipo }, dados || {}), '*');
  }

  function ajustar() {
    if (!player || !player.setSize) return;
    var d = document.documentElement;
    player.setSize(d.clientWidth, d.clientHeight);
  }
  window.addEventListener('resize', ajustar);

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('p', {
      videoId: '',
      playerVars: {
        controls: 0, disablekb: 1, modestbranding: 1, rel: 0,
        iv_load_policy: 3, playsinline: 1
      },
      events: {
        onReady: function () {
          pronto = true;
          ajustar();
          avisar('pronto');
          /* pediram uma faixa antes de a API carregar */
          if (pendente) {
        player.loadVideoById({ videoId: pendente, suggestedQuality: 'small' });
        pendente = null;
      }
          setInterval(function () {
            if (!pronto || !player.getDuration) return;
            avisar('tempo', {
              agora: player.getCurrentTime() || 0,
              total: player.getDuration() || 0,
              /* o que o player esta REALMENTE usando, nao o que foi
                 sugerido: ele ignora a sugestao quando quer */
              qual: player.getPlaybackQuality ? player.getPlaybackQuality() : ''
            });
          }, 500);
        },
        onStateChange: function (e) {
          /* O player guarda o tamanho de quando nasceu (640x390 por
             padrao) e as vezes reaplica ele nos elementos de dentro —
             ai o video escapa do quadro por um instante. Reafirmar o
             tamanho da janela do iframe corrige. */
          ajustar();
          /* MEDIDO: nao segura. O log mostrou large -> unknown ->
             medium com a sugestao de 'small' feita no load e aqui.
             setPlaybackQuality esta deprecado no player novo — vale
             como pedido, e o YouTube decide sozinho pelo tamanho do
             quadro e pela banda. Fica porque nao custa nada e ajuda
             quando ele resolve ouvir; nao fica como promessa. */
          if (e.data === 1) player.setPlaybackQuality('small');
          avisar('estado', { estado: e.data });
        },
        onError: function (e) { avisar('erro', { codigo: e.data }); }
      }
    });
  };

  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.de !== 'launcher') return;
    if (m.tipo === 'carregar') {
      if (!pronto) { pendente = m.id; return; }
      /* 'small' = 240p. O quadro tem uns 240px de largura, entao nada
         acima disso aparece na tela — e decodificar 1080p atras de um
         quadradinho desses come CPU que faz falta no jogo. */
      player.loadVideoById({ videoId: m.id, suggestedQuality: 'small' });
    }
    if (!pronto) return;
    if (m.tipo === 'tocar') player.playVideo();
    if (m.tipo === 'pausar') player.pauseVideo();
    if (m.tipo === 'pular') player.seekTo(m.segundos, true);
    if (m.tipo === 'volume') player.setVolume(m.valor);
    if (m.tipo === 'qualidade') player.setPlaybackQuality(m.valor);
  });

  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
</script>`;

export function ligarTocador() {
  if (servidor) return URL_TOCADOR;

  servidor = createServer((req, res) => {
    /* So GET, e so este caminho. Qualquer outra coisa e 404 — nao ha
       arquivo pra pedir, entao nao ha o que vazar. */
    if (req.method !== 'GET' || (req.url || '').split('?')[0] !== '/tocador.html') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(PAGINA);
  });

  servidor.on('error', (e: any) => {
    /* Porta ocupada: o tocador nao abre, mas o launcher inteiro tem
       que continuar de pe. Sem este handler o Electron cai. */
    console.log('[tocador] não consegui abrir a porta ' + PORTA_TOCADOR + ': ' + (e?.message || e));
    servidor = null;
  });

  /* 127.0.0.1 e nao 0.0.0.0: ninguem da rede alcanca esta porta. */
  servidor.listen(PORTA_TOCADOR, '127.0.0.1', () => {
    console.log('[tocador] no ar em ' + URL_TOCADOR);
  });

  return URL_TOCADOR;
}

export function desligarTocador() {
  if (servidor) { servidor.close(); servidor = null; }
}
