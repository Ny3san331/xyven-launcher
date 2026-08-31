/* POST /posts — o mural do Lado B.

   Corpo: { acao, ... }

     listar                              — publico, sem token
     criar   { titulo, corpo, tag, fixado }
     editar  { id, titulo, corpo, tag, fixado }
     fixar   { id, fixado }
     destaque{ id, destaque }
     apagar  { id }

   Tudo que nao e `listar` exige grupo dev. O botao de escrever no
   launcher tambem so aparece pra dev, mas isso e enfeite: quem
   editar o renderer faz o botao voltar. A trava que vale e esta. */
import {
  admin, erro, exigirDev, json, quemEh
} from '../_shared/comum.ts';

const TAGS = ['ATUALIZAÇÃO', 'COMUNIDADE', 'EVENTO', 'CORREÇÃO'];
const LIMITE_TITULO = 120;
const LIMITE_CORPO = 8000;

const COLUNAS = 'id, titulo, corpo, tag, fixado, destaque, imagem, autor_nick, criado_em, editado_em';

/* Bucket publico: a imagem de uma postagem e feita pra ser vista,
   e URL assinada venceria e deixaria post antigo sem foto. */
const BALDE = 'postagens';
const LIMITE_IMAGEM = 2 * 1024 * 1024;   /* 2 MB */
const TIPOS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp'
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const corpo = await req.json().catch(() => null);
  const acao = String(corpo?.acao || 'listar').toLowerCase();
  const sb = admin();

  /* ---- leitura: publica, e de proposito ---- */
  if (acao === 'listar') {
    const { data, error } = await sb
      .from('postagens')
      .select(COLUNAS)
      .order('fixado', { ascending: false })
      .order('id', { ascending: false })
      .limit(200);
    if (error) return erro(error.message, 500);
    return json({ ok: true, posts: data || [] });
  }

  /* ---- daqui pra baixo, so dev ---- */
  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;
  const barrado = await exigirDev(sb, quem);
  if (barrado) return barrado;

  if (acao === 'criar' || acao === 'editar') {
    const titulo = String(corpo?.titulo || '').trim();
    const texto = String(corpo?.corpo || '').trim();
    const tag = String(corpo?.tag || TAGS[0]);
    if (!titulo) return erro('a postagem precisa de título.');
    if (titulo.length > LIMITE_TITULO) return erro('título passa de ' + LIMITE_TITULO + ' caracteres.');
    if (texto.length > LIMITE_CORPO) return erro('texto passa de ' + LIMITE_CORPO + ' caracteres.');
    if (!TAGS.includes(tag)) return erro('tag "' + tag + '" não existe.');

    /* string vazia = tirar a imagem; undefined = nao mexer nela */
    const img = corpo?.imagem;
    const campos: Record<string, unknown> = {
      titulo, corpo: texto, tag, fixado: corpo?.fixado === true
    };
    if (typeof img === 'string') campos.imagem = img.trim() || null;

    if (acao === 'criar') {
      const { data, error } = await sb
        .from('postagens')
        .insert({ ...campos, autor_uuid: quem.uuid, autor_nick: quem.nick })
        .select(COLUNAS)
        .single();
      if (error) return erro(error.message, 500);
      return json({ ok: true, post: data });
    }

    const id = Number(corpo?.id);
    if (!id) return erro('mande o id da postagem.');
    /* autor_nick NAO e reescrito: editar a propria postagem nao
       transfere autoria, e editar a de outro dev nao rouba a dele */
    const { data, error } = await sb
      .from('postagens')
      .update({ ...campos, editado_em: new Date().toISOString() })
      .eq('id', id)
      .select(COLUNAS)
      .single();
    if (error) return erro(error.message, 500);
    if (!data) return erro('não achei essa postagem.', 404);
    return json({ ok: true, post: data });
  }

  if (acao === 'fixar' || acao === 'destaque') {
    const id = Number(corpo?.id);
    if (!id) return erro('mande o id da postagem.');
    const campo = acao === 'fixar' ? 'fixado' : 'destaque';
    const { data, error } = await sb
      .from('postagens')
      .update({ [campo]: corpo?.[campo] === true })
      .eq('id', id)
      .select(COLUNAS)
      .single();
    if (error) return erro(error.message, 500);
    return json({ ok: true, post: data });
  }

  if (acao === 'apagar') {
    const id = Number(corpo?.id);
    if (!id) return erro('mande o id da postagem.');
    const { error } = await sb.from('postagens').delete().eq('id', id);
    if (error) return erro(error.message, 500);
    return json({ ok: true, id });
  }

  /* ---- upload da imagem de uma postagem ----

     Chega em base64 e nao como multipart porque o launcher fala com
     estas funcoes sempre por JSON; um caminho so pra um upload seria
     mais codigo pra manter do que os 33% que o base64 engorda. */
  if (acao === 'imagem') {
    const nome = String(corpo?.nome || '').toLowerCase();
    const b64 = String(corpo?.dados || '');
    const ext = nome.split('.').pop() || '';
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
    if (bytes.length > LIMITE_IMAGEM) {
      return erro('a imagem passa de 2 MB. diminua antes de enviar.');
    }

    /* cria o balde na primeira vez: evita um passo manual no painel
       que so seria descoberto no primeiro upload que falhasse */
    await sb.storage.createBucket(BALDE, { public: true }).catch(() => {});

    /* nome novo sempre: reusar o nome faria o CDN servir a foto
       antiga por causa do cache */
    const chave = Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + ext;
    const { error } = await sb.storage.from(BALDE).upload(chave, bytes, {
      contentType: tipo,
      upsert: false
    });
    if (error) return erro(error.message, 500);

    const { data } = sb.storage.from(BALDE).getPublicUrl(chave);
    return json({ ok: true, url: data.publicUrl });
  }

  return erro('ação desconhecida: ' + acao);
});
