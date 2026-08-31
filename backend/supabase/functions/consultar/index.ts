/* POST /consultar — leitura por nick, e registro de conta offline.

   Conta pirata nao tem token: nao ha o que provar pra Mojang. Entao
   ela entra na tabela com uuid sintetico `pirata:<nick>`, so pra
   aparecer na lista e guardar cosmetico. Isso NAO e identidade —
   qualquer um que digitar aquele nick cai na mesma linha.

   Por isso `grupo` sai sempre 'player' na resposta, ignorando o que
   estiver gravado: permissao exige conta que se identificou.

   A rota e publica. Por ela criar linha, o nick passa por validacao
   de formato — sem isso um script encheria a tabela. */
import {
  acharJogador, admin, chaveNick, erro, json,
  lerPendente, nickValido, registrarPirata, ultimoAviso
} from '../_shared/comum.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const corpo = await req.json().catch(() => null);
  const nick = String(corpo?.nick || '').trim();
  /* registrar = "esta e a conta ativa de alguem", nao uma consulta solta */
  const registrar = corpo?.registrar === true;
  if (!nick) return erro('mande o nick.');

  const sb = admin();
  let jogador = await acharJogador(sb, nick);

  /* so cria se pediram, se o nick presta, e se nao existe ninguem —
     nunca cria homonimo pirata de uma conta original ja cadastrada */
  if (!jogador && registrar && nickValido(nick)) {
    jogador = await registrarPirata(sb, nick);
  }

  const pendente = await lerPendente(sb, nick);

  const cargos = Array.from(new Set([
    ...((jogador?.cargos) ?? []), ...((pendente?.cargos) ?? [])
  ]));
  const capas = Array.from(new Set([
    ...((jogador?.capas) ?? []), ...((pendente?.capas) ?? [])
  ]));

  /* O pendente NAO e apagado aqui: quem le por nick nao provou ser
     dono dele. Se o dono premium entrar depois, ainda recebe. */
  return json({
    nick: jogador?.nick ?? chaveNick(nick),
    grupo: 'player',
    cargos,
    capas,
    pendente: !!pendente,
    aviso: await ultimoAviso(sb, nick)
  });
});
