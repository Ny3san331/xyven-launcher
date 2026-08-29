import { writeFileSync, mkdirSync } from 'fs';
import { PNG } from 'pngjs';
import pngToIco from 'png-to-ico';

/* Ícone do Xyven: disco de vinil em tinta sobre quadrado salmão.
   Canto reto, sem borda, sem sombra, sem texto.

   O disco é desenhado num sistema de 100x100 (o mesmo viewBox da marca) e
   ocupa 68% do lado do ícone. Cada tamanho é desenhado do zero com a sua
   própria geometria — nunca reduzindo o de 256, senão o traço vira borrão. */

const SALMAO = [0xdc, 0x6f, 0x4e];
const TINTA  = [0x33, 0x26, 0x1c];
const OCUPACAO = 0.68;

/* anéis = [raio, espessura]; furo = raio do círculo cheio do meio */
const RECEITA = {
  256: { aneis: [[41, 8], [20, 8]], furo: 7 },
  128: { aneis: [[41, 8], [20, 8]], furo: 7 },
  64:  { aneis: [[41, 8], [20, 8]], furo: 7 },
  48:  { aneis: [[41, 10], [20, 10]], furo: 7 },
  32:  { aneis: [[41, 10], [20, 10]], furo: 7 },
  /* a 16px o anel interno vira borrão: fica só o externo e um furo maior */
  16:  { aneis: [[41, 13]], furo: 11 }
};

const AMOSTRAS = 4; /* 4x4 por pixel — suaviza a curva sem borrar o traço */

function desenhar(size) {
  const { aneis, furo } = RECEITA[size];
  const escala = (OCUPACAO * size) / 100;
  const centro = size / 2;
  const png = new PNG({ width: size, height: size });

  const naTinta = (x, y) => {
    const dx = x - centro, dy = y - centro;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= furo * escala) return true;
    return aneis.some(([r, sw]) => Math.abs(d - r * escala) <= (sw * escala) / 2);
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let dentro = 0;
      for (let sy = 0; sy < AMOSTRAS; sy++) {
        for (let sx = 0; sx < AMOSTRAS; sx++) {
          const x = px + (sx + 0.5) / AMOSTRAS;
          const y = py + (sy + 0.5) / AMOSTRAS;
          if (naTinta(x, y)) dentro++;
        }
      }
      const a = dentro / (AMOSTRAS * AMOSTRAS);
      const i = (py * size + px) << 2;
      for (let c = 0; c < 3; c++) {
        png.data[i + c] = Math.round(SALMAO[c] * (1 - a) + TINTA[c] * a);
      }
      png.data[i + 3] = 255; /* quadrado cheio: sem transparência */
    }
  }
  return PNG.sync.write(png);
}

const tamanhos = [256, 128, 64, 48, 32, 16];
const buffers = tamanhos.map(desenhar);

writeFileSync('public/icon.ico', await pngToIco(buffers));
console.log('Ícone gerado: public/icon.ico (' + tamanhos.join(', ') + ')');

/* PNGs soltos pra conferir no olho; não entram no build */
if (process.argv.includes('--preview')) {
  mkdirSync('icon-preview', { recursive: true });
  tamanhos.forEach((s, i) => writeFileSync(`icon-preview/icon-${s}.png`, buffers[i]));
  console.log('Prévia em icon-preview/');
}
