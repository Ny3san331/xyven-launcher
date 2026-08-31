/* POST /gift — dev dá ou tira cargo e capa.

   Corpo: { alvo, item, acao: 'dar' | 'tirar' }

   Se o nick ja se identificou no launcher, aplica direto nele. Se
   nao, fica pendente ate alguem entrar com aquele nome. Nao ha
   consulta a Mojang: o nick nao e resolvido pra UUID de estranho. */
import {
  acharJogador, admin, comItem, erro, exigirDev, guardarPendente,
  json, quemEh, semItem, tipoDoItem
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
  const acao = String(corpo?.acao || 'dar').toLowerCase() === 'tirar' ? 'tirar' : 'dar';
  if (!nick || !item) return erro('mande alvo e item.');

  const tipo = tipoDoItem(item);
  if (!tipo) return erro('"' + item + '" não é cargo nem capa que existe.');

  const coluna = tipo === 'cargo' ? 'cargos' : 'capas';
  const alvo = await acharJogador(sb, nick);

  /* ---- ninguem com esse nick ainda: guarda pra depois ---- */
  if (!alvo) {
    const r = await guardarPendente(sb, nick, item, tipo, acao, quem.uuid);
    return json({
      ok: true, nick, item, tipo, pendente: true,
      vazio: r.vazio,
      recado: acao === 'dar'
        ? 'ninguém entrou com esse nick ainda — fica guardado até entrar.'
        : 'tirado da lista de pendentes.'
    });
  }

  /* ---- ja existe: aplica direto ---- */
  const atual: string[] = alvo[coluna] ?? [];
  const tinha = atual.includes(item);
  if (acao === 'dar' && tinha) return json({ ok: true, nick: alvo.nick, item, tipo, jaTinha: true });
  if (acao === 'tirar' && !tinha) return json({ ok: true, nick: alvo.nick, item, tipo, naoTinha: true });

  const { error } = await sb
    .from('jogadores')
    .update({ [coluna]: acao === 'dar' ? comItem(atual, item) : semItem(atual, item) })
    .eq('uuid', alvo.uuid);
  if (error) return erro(error.message, 500);

  await sb.from('concessoes').insert({
    alvo_uuid: alvo.uuid, item, tipo, acao, por_uuid: quem.uuid
  });

  return json({ ok: true, nick: alvo.nick, item, tipo });
});
