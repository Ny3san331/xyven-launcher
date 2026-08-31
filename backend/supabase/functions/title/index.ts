/* POST /title — dev manda um recado pra UMA pessoa.

   Corpo: { alvo, titulo, texto }. Os dois aceitam codigo de cor do
   Minecraft (&a, &l, ...) — o servidor nao interpreta nada, so
   guarda o texto cru. Quem pinta e o launcher.

   Nao sobrescreve o anterior: cada recado e uma linha nova. O
   launcher compara o id com o ultimo que mostrou, entao repetir o
   mesmo texto volta a aparecer — que e o esperado quando alguem
   republica um aviso de proposito. */
import {
  admin, chaveNick, cutucar, erro, exigirDev, json, nickValido, quemEh
} from '../_shared/comum.ts';

const LIMITE_TITULO = 60;
const LIMITE_TEXTO = 400;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;

  const sb = admin();
  const barrado = await exigirDev(sb, quem);
  if (barrado) return barrado;

  const corpo = await req.json().catch(() => null);
  const alvo = String(corpo?.alvo || '').trim();
  const titulo = String(corpo?.titulo || '').trim();
  const texto = String(corpo?.texto || '').trim();
  if (!alvo) return erro('mande o nick de quem recebe.');
  /* mesma trava do /gift: nick que nao presta viraria linha morta,
     porque ninguem nunca vai entrar com aquele nome */
  if (!nickValido(alvo)) return erro('"' + alvo + '" não parece um nick.');
  if (!titulo) return erro('mande pelo menos o título.');

  /* teto de tamanho: o modal tem tamanho fixo, e uma parede de texto
     a pessoa fecha sem ler */
  if (titulo.length > LIMITE_TITULO) return erro('título passa de ' + LIMITE_TITULO + ' caracteres.');
  if (texto.length > LIMITE_TEXTO) return erro('descrição passa de ' + LIMITE_TEXTO + ' caracteres.');

  const { data, error } = await sb
    .from('avisos')
    .insert({ alvo: chaveNick(alvo), titulo, texto, por_uuid: quem.uuid })
    .select('id, titulo, texto')
    .single();
  if (error) return erro(error.message, 500);

  await cutucar(sb, alvo);
  return json({ ok: true, nick: alvo, aviso: data });
});
