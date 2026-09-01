/* POST /loja — categorias e cosmeticos.

   Corpo: { acao, ... }

     listar                                              — publico
     categoria  { modo: criar|apagar, id, nome?, ordem? }
     cosmetico  { modo: criar|editar|apagar, id, ... }
     imagem     { id, nome, dados }                      — base64

   Escrever exige a permissao `loja`. */
import { admin, erro, json, quemEh } from '../_shared/comum.ts';
import { exigirPerm, idValido } from '../_shared/perms.ts';

const BALDE = 'cosmeticos';
const LIMITE_IMAGEM = 2 * 1024 * 1024;
const LIMITE_NOME = 32;
const LIMITE_DESC = 400;
const TIPOS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp'
};

const COLS_COSM = 'id, nome, descricao, imagem, categoria, criado_em';
const COLS_CAT = 'id, nome, ordem';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const corpo = await req.json().catch(() => null);
  const acao = String(corpo?.acao || 'listar').toLowerCase();
  const sb = admin();

  if (acao === 'listar') {
    const [cats, cosm] = await Promise.all([
      sb.from('categorias').select(COLS_CAT).order('ordem').order('id'),
      sb.from('cosmeticos').select(COLS_COSM).order('categoria').order('id')
    ]);
    if (cats.error) return erro(cats.error.message, 500);
    if (cosm.error) return erro(cosm.error.message, 500);
    return json({ ok: true, categorias: cats.data || [], cosmeticos: cosm.data || [] });
  }

  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;
  const barrado = await exigirPerm(sb, quem, 'loja');
  if (barrado) return barrado;

  const id = String(corpo?.id || '').trim().toLowerCase();

  /* ------------------------------------------------------------
     categorias
     ------------------------------------------------------------ */
  if (acao === 'categoria') {
    const modo = String(corpo?.modo || '').toLowerCase();
    if (!idValido(id)) {
      return erro('id da categoria: 2 a 20 caracteres, minusculo, sem espaço.');
    }

    if (modo === 'criar') {
      const nome = String(corpo?.nome || id).trim().toUpperCase();
      if (nome.length > LIMITE_NOME) return erro('nome passa de ' + LIMITE_NOME + ' caracteres.');
      const ordem = Number(corpo?.ordem);
      const { data, error } = await sb
        .from('categorias')
        .insert({ id, nome, ordem: Number.isFinite(ordem) ? ordem : 100 })
        .select(COLS_CAT)
        .single();
      if (error) return erro(error.message, 500);
      return json({ ok: true, categoria: data });
    }

    if (modo === 'apagar') {
      /* Recusa se ainda houver item dentro. O banco ja barra pelo
         `on delete restrict`, mas a mensagem dele nao ajuda ninguem —
         esta diz quantos itens estao no caminho. */
      const { count } = await sb
        .from('cosmeticos').select('id', { count: 'exact', head: true }).eq('categoria', id);
      if (count) {
        return erro('a categoria tem ' + count + ' item(ns). mova ou apague antes.');
      }
      const { error } = await sb.from('categorias').delete().eq('id', id);
      if (error) return erro(error.message, 500);
      return json({ ok: true, id });
    }

    return erro('use criar ou apagar.');
  }

  /* ------------------------------------------------------------
     cosmeticos
     ------------------------------------------------------------ */
  if (acao === 'cosmetico') {
    const modo = String(corpo?.modo || '').toLowerCase();
    if (!idValido(id)) {
      return erro('id do item: 2 a 20 caracteres, minusculo, sem espaço (a-z, 0-9, _ e -).');
    }

    if (modo === 'apagar') {
      /* tira de quem tem antes de sumir a linha, igual ao /cargo:
         id orfao em `jogadores.capas` nao desenha nada e fica pra sempre */
      const { data: donos } = await sb
        .from('jogadores').select('uuid, capas').contains('capas', [id]);
      for (const d of donos || []) {
        await sb
          .from('jogadores')
          .update({ capas: (d.capas || []).filter((x: string) => x !== id) })
          .eq('uuid', d.uuid);
      }
      const { error } = await sb.from('cosmeticos').delete().eq('id', id);
      if (error) return erro(error.message, 500);
      return json({ ok: true, id, tirados: (donos || []).length });
    }

    const nome = corpo?.nome === undefined ? undefined : String(corpo.nome).trim();
    const desc = corpo?.descricao === undefined ? undefined : String(corpo.descricao).trim();
    const cat = corpo?.categoria === undefined
      ? undefined
      : String(corpo.categoria).trim().toLowerCase();
    const img = corpo?.imagem === undefined ? undefined : String(corpo.imagem).trim();

    if (nome !== undefined && nome.length > LIMITE_NOME) {
      return erro('nome passa de ' + LIMITE_NOME + ' caracteres.');
    }
    if (desc !== undefined && desc.length > LIMITE_DESC) {
      return erro('descrição passa de ' + LIMITE_DESC + ' caracteres.');
    }
    if (cat !== undefined) {
      const { data: existe } = await sb
        .from('categorias').select('id').eq('id', cat).maybeSingle();
      if (!existe) return erro('não existe a categoria "' + cat + '".');
    }

    if (modo === 'criar') {
      if (!cat) return erro('mande a categoria.');
      const { data: ja } = await sb.from('cosmeticos').select('id').eq('id', id).maybeSingle();
      if (ja) return erro('já existe um item "' + id + '".');

      const { data, error } = await sb
        .from('cosmeticos')
        .insert({
          id,
          nome: nome || id.toUpperCase(),
          descricao: desc || '',
          imagem: img || null,
          categoria: cat,
          por_uuid: quem.uuid
        })
        .select(COLS_COSM)
        .single();
      if (error) return erro(error.message, 500);
      return json({ ok: true, cosmetico: data });
    }

    if (modo === 'editar') {
      const mudanca: Record<string, unknown> = {};
      if (nome !== undefined) mudanca.nome = nome;
      if (desc !== undefined) mudanca.descricao = desc;
      if (cat !== undefined) mudanca.categoria = cat;
      /* string vazia tira a imagem; undefined nao mexe nela */
      if (img !== undefined) mudanca.imagem = img || null;
      if (!Object.keys(mudanca).length) return erro('não mandou nada pra mudar.');

      const { data, error } = await sb
        .from('cosmeticos').update(mudanca).eq('id', id).select(COLS_COSM).maybeSingle();
      if (error) return erro(error.message, 500);
      if (!data) return erro('não existe o item "' + id + '".', 404);
      return json({ ok: true, cosmetico: data });
    }

    return erro('use criar, editar ou apagar.');
  }

  /* ------------------------------------------------------------
     upload da imagem
     ------------------------------------------------------------ */
  if (acao === 'imagem') {
    const nomeArq = String(corpo?.nome || '').toLowerCase();
    const b64 = String(corpo?.dados || '');
    const ext = nomeArq.split('.').pop() || '';
    const tipo = TIPOS[ext];
    if (!tipo) return erro('use png, jpg, gif ou webp.');

    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return erro('não consegui ler o arquivo.');
    }
    if (!bytes.length) return erro('arquivo vazio.');
    if (bytes.length > LIMITE_IMAGEM) return erro('a imagem passa de 2 MB.');

    await sb.storage.createBucket(BALDE, { public: true }).catch(() => {});

    /* nome novo sempre: reusar faria o CDN servir a imagem antiga */
    const chave = Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + ext;
    const { error } = await sb.storage.from(BALDE).upload(chave, bytes, {
      contentType: tipo, upsert: false
    });
    if (error) return erro(error.message, 500);

    const { data } = sb.storage.from(BALDE).getPublicUrl(chave);
    return json({ ok: true, url: data.publicUrl });
  }

  return erro('ação desconhecida: ' + acao);
});
