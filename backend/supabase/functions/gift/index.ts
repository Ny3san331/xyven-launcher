/* POST /gift — dev dá um cargo ou uma capa pra alguém.

   É a rota que existe pra resolver o problema todo: o item vai pro
   banco, e o launcher da outra pessoa lê no próximo boot. */
import {
  acharAlvo, admin, erro, exigirDev, json, quemEh, tipoDoItem
} from '../_shared/comum.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;

  const sb = admin();
  const barrado = await exigirDev(sb, quem);
  if (barrado) return barrado;

  const corpo = await req.json().catch(() => null);
  const nick = String(corpo?.alvo || '').trim();
  const item = String(corpo?.item || '').trim().toLowerCase();
  if (!nick || !item) return erro('mande alvo e item.');

  const tipo = tipoDoItem(item);
  if (!tipo) return erro('"' + item + '" não é cargo nem capa que existe.');

  const alvo = await acharAlvo(sb, nick);
  if (!alvo) return erro('"' + nick + '" não existe na Mojang. conta pirata não dá.', 404);

  const coluna = tipo === 'cargo' ? 'cargos' : 'capas';
  const atual: string[] = alvo[coluna] ?? [];
  if (atual.includes(item)) return json({ ok: true, jaTinha: true, nick: alvo.nick });

  const { error } = await sb
    .from('jogadores')
    .update({ [coluna]: [...atual, item] })
    .eq('uuid', alvo.uuid);
  if (error) return erro(error.message, 500);

  await sb.from('concessoes').insert({
    alvo_uuid: alvo.uuid, item, tipo, acao: 'dar', por_uuid: quem.uuid
  });

  return json({ ok: true, nick: alvo.nick, item, tipo });
});
