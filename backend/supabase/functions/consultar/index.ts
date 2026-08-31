/* POST /consultar — leitura publica por nick.

   Conta pirata nao tem token, entao nao pode chamar /identificar:
   nao ha o que provar pra Mojang. Sem esta rota o cosmetico seria
   gravado e nunca lido.

   Devolve o que existe pra aquele nick, seja de alguem que ja se
   identificou, seja o que ficou pendente.

   Leitura sem autenticacao e aceitavel porque nao ha segredo aqui:
   nick, cargos e capas aparecem na tela de qualquer um. Escrever
   continua exigindo dev com token. */
import { acharJogador, admin, chaveNick, erro, json, lerPendente } from '../_shared/comum.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const corpo = await req.json().catch(() => null);
  const nick = String(corpo?.nick || '').trim();
  if (!nick) return erro('mande o nick.');

  const sb = admin();
  const jogador = await acharJogador(sb, nick);
  const pendente = await lerPendente(sb, nick);

  const cargos = Array.from(new Set([
    ...((jogador?.cargos) ?? []), ...((pendente?.cargos) ?? [])
  ]));
  const capas = Array.from(new Set([
    ...((jogador?.capas) ?? []), ...((pendente?.capas) ?? [])
  ]));

  /* O pendente NAO e apagado aqui. Quem le por esta rota nao provou
     ser dono do nick; se o dono premium entrar depois, ele ainda
     recebe. Consultar mostra, identificar e que reivindica. */
  return json({
    nick: jogador?.nick ?? chaveNick(nick),
    /* grupo sai fixo: quem le por nick nao provou nada, e devolver o
       grupo real so convidaria o launcher a confiar nele */
    grupo: 'player',
    cargos,
    capas,
    pendente: !!pendente
  });
});
