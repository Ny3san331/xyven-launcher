/* POST /grupo — promove ou rebaixa alguem.

   Diferente do /gift, isto NAO fica pendente: grupo e permissao, e
   permissao so pra quem ja provou quem e. Nick sozinho nao basta. */
import { acharJogador, admin, erro, exigirDev, json, quemEh } from '../_shared/comum.ts';

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

  const alvo = await acharJogador(sb, nick);
  if (!alvo) {
    return erro('"' + nick + '" nunca entrou no launcher com conta original. ' +
                'grupo não fica pendente — permissão exige conta identificada.', 404);
  }

  /* Sem esta trava da pra ficar com zero devs no sistema, e ai a
     unica saida e editar o banco a mao. */
  if (alvo.uuid === quem.uuid && grupo !== 'dev') {
    return erro('você não pode se rebaixar. peça pra outro dev.');
  }

  const { error } = await sb.from('jogadores').update({ grupo }).eq('uuid', alvo.uuid);
  if (error) return erro(error.message, 500);

  return json({ ok: true, nick: alvo.nick, grupo });
});
