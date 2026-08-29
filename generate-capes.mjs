import { writeFileSync, mkdirSync } from 'fs';
import { PNG } from 'pngjs';

/* ============================================================
   Capas do launcher — ARTE PROVISÓRIA.
   A tela de Cosméticos ainda não veio do design; isto usa só a
   paleta do tema. Trocar quando a arte oficial chegar.

   Formato de capa do Minecraft: textura 64x32.
     (1,1)  10x16  frente  (o que se vê nas costas do jogador)
     (12,1) 10x16  verso   (o forro)
     (0,1)   1x16  lateral esquerda
     (11,1)  1x16  lateral direita
     (1,0)  10x1   topo
     (11,0) 10x1   base
   ============================================================ */

const INK     = [0x33, 0x26, 0x1c];
const PAPER   = [0xf4, 0xe7, 0xca];
const SALMON  = [0xdc, 0x6f, 0x4e];
const MUSTARD = [0xe8, 0xb2, 0x3f];
const TEAL    = [0x3f, 0x7d, 0x72];

const L = 10, A = 16;   /* largura e altura da capa */

/* pinta um pixel da frente (coordenadas 0..9, 0..15) */
const frente = (px, x, y, cor) => por(px, 1 + x, 1 + y, cor);
const verso  = (px, x, y, cor) => por(px, 12 + x, 1 + y, cor);

function por(png, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= 64 || y >= 32) return;
  const i = (y * 64 + x) << 2;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
}

function base(fundo, forro) {
  const png = new PNG({ width: 64, height: 32 });
  png.data.fill(0);                                  /* resto transparente */
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
    frente(png, x, y, fundo);
    verso(png, x, y, forro);
  }
  /* bordas e topo/base em tinta, pra capa não parecer flutuando */
  for (let y = 0; y < A; y++) { por(png, 0, 1 + y, INK); por(png, 11, 1 + y, INK); }
  for (let x = 0; x < L; x++) { por(png, 1 + x, 0, INK); por(png, 11 + x, 0, INK); }
  return png;
}

/* disco de vinil, o mesmo símbolo da marca, em 10x16 */
function disco(png, cor) {
  const cx = 4.5, cy = 7.5;
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const anel = Math.abs(d - 3.6) <= 0.9;           /* aro externo */
    const furo = d <= 1.1;                            /* furo do meio */
    if (anel || furo) frente(png, x, y, cor);
  }
}

/* faixa diagonal, lembrando a fita atravessando */
function faixa(png, cor) {
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
    if ((x + y) % 5 === 0) frente(png, x, y, cor);
  }
}

/* ---- CAVEIRA: arte definida pelo dono do projeto ----
   fundo azul-marinho com sombreamento sutil, caveira branca,
   olhos e nariz pretos. paleta dele, nao a do tema. */
const MARINHO_1 = [0x0e, 0x13, 0x22];
const MARINHO_2 = [0x13, 0x1a, 0x2e];
const MARINHO_3 = [0x1a, 0x21, 0x37];
const OSSO      = [0xff, 0xff, 0xff];
const OSSO_SOMB = [0xd9, 0xd9, 0xd9];
const PRETO     = [0x00, 0x00, 0x00];

/* . fundo   # osso   o osso sombreado   X preto */
const CAVEIRA = [
  '..........',
  '..........',
  '..######..',
  '.########.',
  '##########',
  '##XX##XX##',
  '##XX##XX##',
  '##########',
  '####XX####',
  'o########o',
  '..######..',
  '..#.##.#..',
  '..........',
  '..........',
  '..........',
  '..........'
];

function capaCaveira() {
  const png = new PNG({ width: 64, height: 32 });
  png.data.fill(0);
  for (let y = 0; y < A; y++) for (let x = 0; x < L; x++) {
    /* fundo com faixa mais clara no meio, escurecendo pra baixo */
    const fundo = y < 4 ? MARINHO_1 : (y < 11 ? MARINHO_3 : MARINHO_2);
    const c = CAVEIRA[y][x];
    const cor = c === '#' ? OSSO : c === 'o' ? OSSO_SOMB : c === 'X' ? PRETO : fundo;
    frente(png, x, y, cor);
    verso(png, x, y, MARINHO_1);          /* forro liso */
  }
  for (let y = 0; y < A; y++) { por(png, 0, 1 + y, MARINHO_1); por(png, 11, 1 + y, MARINHO_1); }
  for (let x = 0; x < L; x++) { por(png, 1 + x, 0, MARINHO_1); por(png, 11 + x, 0, MARINHO_1); }
  return png;
}

const CAPAS = {
  /* a caveira nao e gerada: o arquivo vem pronto do dono do projeto,
     em public/capes/caveira.png. capaCaveira() fica so de historico. */
  /* a da casa: disco de tinta sobre salmão */
  'xyven': () => { const p = base(SALMON, INK); disco(p, INK); return p; },
  /* fita: mostarda com o listrado diagonal */
  'fita': () => { const p = base(MUSTARD, INK); faixa(p, INK); return p; },
  /* lado b: papel sobre tinta, o negativo da de cima */
  'lado-b': () => { const p = base(INK, INK); disco(p, PAPER); return p; },
  /* fundador: verde-água com disco de papel */
  'fundador': () => { const p = base(TEAL, INK); disco(p, PAPER); return p; }
};

mkdirSync('public/capes', { recursive: true });
for (const [nome, faz] of Object.entries(CAPAS)) {
  writeFileSync(`public/capes/${nome}.png`, PNG.sync.write(faz()));
  console.log('gerada: public/capes/' + nome + '.png');
}

/* prévia ampliada, só pra conferir no olho */
if (process.argv.includes('--preview')) {
  const E = 14;
  const alvo = new PNG({ width: L * E * Object.keys(CAPAS).length, height: A * E });
  Object.values(CAPAS).forEach((faz, n) => {
    const src = faz();
    for (let y = 0; y < A * E; y++) for (let x = 0; x < L * E; x++) {
      const sx = 1 + Math.floor(x / E), sy = 1 + Math.floor(y / E);
      const si = (sy * 64 + sx) << 2;
      const di = (y * alvo.width + n * L * E + x) << 2;
      for (let c = 0; c < 4; c++) alvo.data[di + c] = src.data[si + c];
    }
  });
  writeFileSync('capes-preview.png', PNG.sync.write(alvo));
  console.log('prévia: capes-preview.png');
}
