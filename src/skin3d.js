/* ============================================================
   Visualizador de skin — skinview3d (Three.js por baixo)

   Substituiu um renderizador feito na mão com CSS 3D. Aquele
   montava 12 caixas com `transform` e funcionava parado, mas o
   `perspective` mora no elemento e o `scale()` entra DEPOIS da
   projeção: aproximar ampliava a imagem já achatada em vez de
   mover a câmera. Daí o boneco virar papel no zoom, e entortar
   quando a janela mudava de tamanho.

   Aqui existe câmera de verdade. Zoom aproxima, `fov` controla a
   distorção, e o redimensionamento só ajusta a proporção.

   O que veio de brinde e antes era feito na unha: detecção de
   Alex/Steve pela textura, segunda camada (jaqueta e manga) sem
   z-fighting, e a capa com espessura.
   ============================================================ */
import { SkinViewer } from 'skinview3d';

/* Pose inicial: a mesma de antes, pra não estranhar. Levemente de
   lado e quase na altura dos olhos — de cima a cabeça achata. */
const GIRO = -0.38;   /* rad, ~-22° */
const FOV = 70;       /* lente longa: perto o rosto nao estufa */
const ZOOM = 0.9;

/* Sem isto o canvas nasce 300x150 e so acerta no primeiro resize. */
function medir(alvo) {
  const r = alvo.getBoundingClientRect();
  return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
}

export function criarVisor(canvas) {
  if (!canvas) return null;
  const palco = canvas.parentElement || canvas;
  const { w, h } = medir(palco);

  const visor = new SkinViewer({ canvas, width: w, height: h, fov: FOV, zoom: ZOOM });
  visor.playerObject.rotation.y = GIRO;

  /* A distancia da camera sai de fov+zoom NA HORA da construcao. No
     boot a tela do perfil esta escondida, o palco mede 0 e o visor
     nasce 1x1: crescer depois corrige a proporcao mas nao refaz o
     enquadramento, e o boneco fica pequeno e fora do centro.
     Reatribuir o zoom obriga o recalculo. */
  const reenquadrar = () => { visor.zoom = ZOOM; };

  /* girar sim, arrastar o boneco pra fora do quadro nao */
  visor.controls.enablePan = false;
  visor.controls.enableZoom = true;

  /* O bug do enunciado: sem reagir ao tamanho do palco, o canvas
     mantém a proporção antiga e a imagem estica. Ctrl +/- muda o
     tamanho em CSS px, então isto cobre o zoom do launcher também. */
  let ro = null;
  let nasceuTorto = (w <= 1 || h <= 1);
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const m = medir(palco);
      if (m.w <= 1 || m.h <= 1) return;      /* escondido de novo: ignora */
      visor.setSize(m.w, m.h);
      /* uma vez so: depois do primeiro tamanho real, quem manda no
         enquadramento e o usuario (roda do mouse) */
      if (nasceuTorto) { nasceuTorto = false; reenquadrar(); }
    });
    ro.observe(palco);
  }

  /* Fora da tela o loop continuaria rodando de graça. A prévia do
     perfil fica escondida a maior parte do tempo. */
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((e) => {
      visor.renderPaused = !e.some((x) => x.isIntersecting);
    });
    io.observe(palco);
  }

  /* duplo clique volta a pose padrão, como era antes */
  const reset = () => {
    visor.controls.reset();
    visor.zoom = ZOOM;
    visor.playerObject.rotation.y = GIRO;
  };
  palco.addEventListener('dblclick', reset);

  return {
    visor,
    reset,
    /* Compat: o codigo antigo chamava paint() pra repintar depois de
       mexer na pose. Aqui o loop pinta sozinho — fica no-op pra nao
       ter que cacar todos os pontos de chamada. */
    paint: () => {},
    medirDeNovo: () => { const m = medir(palco); visor.setSize(m.w, m.h); },
    destruir: () => {
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      palco.removeEventListener('dblclick', reset);
      visor.dispose();
    }
  };
}

/* ------------------------------------------------------------
   Troca skin e capa de um visor já criado.

   `slim` aceita null = "não sei": aí a própria biblioteca decide
   pela textura, que é mais confiável que o palpite pelo nick.
   ------------------------------------------------------------ */
export function vestir(v, urlSkin, urlCapa, slim) {
  if (!v) return;
  const modelo = slim === true ? 'slim' : (slim === false ? 'default' : 'auto-detect');

  if (urlSkin) {
    Promise.resolve(v.visor.loadSkin(urlSkin, { model: modelo }))
      /* offline ou nick sem skin: fica o boneco padrão, sem quebrar */
      .catch(() => { /* silencioso: a prévia não vale um erro na tela */ });
  }

  /* null limpa a capa; sem isto trocar pra "nenhuma" deixava a antiga */
  if (urlCapa) {
    Promise.resolve(v.visor.loadCape(urlCapa)).catch(() => v.visor.loadCape(null));
  } else {
    v.visor.loadCape(null);
  }
}
