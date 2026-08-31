/* POST /cargo — criar, editar, apagar e listar cargo.

   Corpo: { acao, ... }

     listar                                        — publico
     criar   { id, nome, cor, permissoes[] }
     editar  { id, nome?, cor?, permissoes[]? }
     apagar  { id }

   Escrever exige a permissao `cargos`. Nao ha mais grupo: quem pode
   e quem tem um cargo que carrega essa permissao. */
import { admin, erro, json, quemEh } from '../_shared/comum.ts';
import { CORES, exigirPerm, idValido, permValida } from '../_shared/perms.ts';

const LIMITE_NOME = 24;
const COLUNAS = 'id, nome, cor, permissoes, criado_em';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const corpo = await req.json().catch(() => null);
  const acao = String(corpo?.acao || 'listar').toLowerCase();
  const sb = admin();

  /* ---- leitura publica: o launcher desenha a etiqueta de qualquer
         jogador, entao precisa do nome e da cor de todo cargo ---- */
  if (acao === 'listar') {
    const { data, error } = await sb.from('cargos').select(COLUNAS).order('id');
    if (error) return erro(error.message, 500);
    return json({ ok: true, cargos: data || [] });
  }

  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;
  const barrado = await exigirPerm(sb, quem, 'cargos');
  if (barrado) return barrado;

  const id = String(corpo?.id || '').trim().toLowerCase();

  if (acao === 'criar' || acao === 'editar') {
    if (!idValido(id)) {
      return erro('id do cargo: 2 a 20 caracteres, minusculo, sem espaço (a-z, 0-9, _ e -).');
    }

    const nome = corpo?.nome === undefined ? undefined : String(corpo.nome).trim();
    const cor = corpo?.cor === undefined ? undefined : String(corpo.cor).trim().toLowerCase();
    const perms = corpo?.permissoes === undefined
      ? undefined
      : (Array.isArray(corpo.permissoes) ? corpo.permissoes.map(String) : []);

    if (nome !== undefined) {
      if (!nome) return erro('o cargo precisa de nome.');
      if (nome.length > LIMITE_NOME) return erro('nome passa de ' + LIMITE_NOME + ' caracteres.');
    }
    if (cor !== undefined && !CORES.includes(cor)) {
      return erro('cor tem que ser uma destas: ' + CORES.join(', ') + '.');
    }
    if (perms !== undefined) {
      /* recusa permissao que nao existe: sem isto um erro de digitacao
         viraria cargo que parece dar acesso e nao da */
      const ruim = perms.find((p: string) => !permValida(p));
      if (ruim) return erro('a permissão "' + ruim + '" não existe. veja /perms list.');
    }

    if (acao === 'criar') {
      const { data: ja } = await sb.from('cargos').select('id').eq('id', id).maybeSingle();
      if (ja) return erro('já existe um cargo "' + id + '". use /cargo edit.');

      const { data, error } = await sb
        .from('cargos')
        .insert({
          id,
          nome: nome || id.toUpperCase(),
          cor: cor || 'sand',
          permissoes: perms || [],
          por_uuid: quem.uuid
        })
        .select(COLUNAS)
        .single();
      if (error) return erro(error.message, 500);
      return json({ ok: true, cargo: data });
    }

    const mudanca: Record<string, unknown> = {};
    if (nome !== undefined) mudanca.nome = nome;
    if (cor !== undefined) mudanca.cor = cor;
    if (perms !== undefined) mudanca.permissoes = perms;
    if (!Object.keys(mudanca).length) return erro('não mandou nada pra mudar.');

    const { data, error } = await sb
      .from('cargos').update(mudanca).eq('id', id).select(COLUNAS).maybeSingle();
    if (error) return erro(error.message, 500);
    if (!data) return erro('não existe cargo "' + id + '".', 404);
    return json({ ok: true, cargo: data });
  }

  if (acao === 'apagar') {
    if (!id) return erro('mande o id do cargo.');

    /* Tira o cargo de quem tem ANTES de apagar a linha. Sem isto
       sobrariam ids orfaos em `jogadores.cargos`: a etiqueta some da
       tela (nao ha nome nem cor pra ela) mas o id fica no banco pra
       sempre, e ninguem entende por que /account info mostra algo
       que nao existe. */
    const { data: donos } = await sb
      .from('jogadores').select('uuid, cargos').contains('cargos', [id]);

    for (const d of donos || []) {
      await sb
        .from('jogadores')
        .update({ cargos: (d.cargos || []).filter((x: string) => x !== id) })
        .eq('uuid', d.uuid);
    }

    const { error } = await sb.from('cargos').delete().eq('id', id);
    if (error) return erro(error.message, 500);

    return json({ ok: true, id, tirados: (donos || []).length });
  }

  return erro('ação desconhecida: ' + acao);
});
