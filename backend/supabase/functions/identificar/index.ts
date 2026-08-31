/* POST /identificar — chamada em todo boot do launcher.

   Diz quem é a pessoa e o que ela tem. Também é o que cria a linha
   dela no banco na primeira vez: sem isso, não haveria como dar
   item pra quem nunca abriu o launcher. */
import { admin, garantirJogador, json, quemEh, ultimoAviso } from '../_shared/comum.ts';
import { permissoesDe } from '../_shared/perms.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;

  const sb = admin();
  const j = await garantirJogador(sb, quem);

  return json({
    uuid: j.uuid,
    nick: j.nick,
    grupo: j.grupo,
    cargos: j.cargos ?? [],
    capas: j.capas ?? [],
    /* o launcher usa isto pra decidir o que mostrar; a trava de
       verdade continua sendo no servidor, a cada acao */
    permissoes: [...(await permissoesDe(sb, quem))],
    aviso: await ultimoAviso(sb, j.nick)
  });
});
