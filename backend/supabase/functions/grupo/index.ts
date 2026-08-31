/* POST /grupo — promove ou rebaixa alguém. */
import { acharAlvo, admin, erro, exigirDev, json, quemEh } from '../_shared/comum.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;

  const sb = admin();
  const barrado = await exigirDev(sb, quem);
  if (barrado) return barrado;

  const corpo = await req.json().catch(() => null);
  const nick = String(corpo?.alvo || '').trim();
  const grupo = String(corpo?.grupo || '').trim().toLowerCase();
  if (!nick || !grupo) return erro('mande alvo e grupo.');
  if (grupo !== 'player' && grupo !== 'dev') return erro('grupo é player ou dev.');

  const alvo = await acharAlvo(sb, nick);
  if (!alvo) return erro('"' + nick + '" não existe na Mojang.', 404);

  /* Sem esta trava dá pra ficar com zero devs no sistema, e aí a
     única saída é editar o banco à mão. */
  if (alvo.uuid === quem.uuid && grupo !== 'dev') {
    return erro('você não pode se rebaixar. peça pra outro dev.');
  }

  const { error } = await sb.from('jogadores').update({ grupo }).eq('uuid', alvo.uuid);
  if (error) return erro(error.message, 500);

  return json({ ok: true, nick: alvo.nick, grupo });
});
