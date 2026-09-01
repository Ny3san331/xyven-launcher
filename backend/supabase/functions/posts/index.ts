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
  admin, erro, json, quemEh
} from '../_shared/comum.ts';
import { exigirPerm } from '../_shared/perms.ts';

const TAGS = ['ATUALIZAÇÃO', 'COMUNIDADE', 'EVENTO', 'CORREÇÃO'];
const LIMITE_TITULO = 120;
const LIMITE_CORPO = 8000;

const COLUNAS = 'id, titulo, corpo, tag, fixado, destaque, imagem, secoes, autor_nick, criado_em, editado_em';

const LIMITE_SECOES = 12;
const LIMITE_SEC_TITULO = 60;
const LIMITE_SEC_TEXTO = 600;

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

  /* ---- daqui pra baixo, cada acao pede a sua permissao ----

     Tres e nao uma: da pra ter alguem que escreve no mural sem poder
     apagar o que os outros escreveram. Apagar e o unico sem volta. */
  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;

  const NECESSARIA: Record<string, string> = {
    criar: 'posts.escrever',
    editar: 'posts.escrever',
    imagem: 'posts.escrever',
    /* anunciar joga na tela de TODO MUNDO: pede o mesmo que fixar,
       que e a permissao de dar destaque */
    anunciar: 'posts.fixar',
    fixar: 'posts.fixar',
    destaque: 'posts.fixar',
    apagar: 'posts.apagar'
  };
  const precisa = NECESSARIA[acao];
  if (!precisa) return erro('ação desconhecida: ' + acao);

  const barrado = await exigirPerm(sb, quem, precisa);
  if (barrado) return barrado;

  if (acao === 'criar' || acao === 'editar') {
    const titulo = String(corpo?.titulo || '').trim();
    const texto = String(corpo?.corpo || '').trim();
    const tag = String(corpo?.tag || TAGS[0]);
    if (!titulo) return erro('a postagem precisa de título.');
    if (titulo.length > LIMITE_TITULO) return erro('título passa de ' + LIMITE_TITULO + ' caracteres.');
    if (texto.length > LIMITE_CORPO) return erro('texto passa de ' + LIMITE_CORPO + ' caracteres.');
    if (!TAGS.includes(tag)) return erro('tag "' + tag + '" não existe.');

    /* Secoes: lista de {icone, titulo, texto}. Undefined nao mexe;
       lista vazia limpa. Recusa em bloco se qualquer uma estiver
       torta — meia postagem publicada e pior que nenhuma. */
    let secoes: unknown = undefined;
    if (corpo?.secoes !== undefined) {
      if (!Array.isArray(corpo.secoes)) return erro('secoes tem que ser uma lista.');
      if (corpo.secoes.length > LIMITE_SECOES) {
        return erro('no máximo ' + LIMITE_SECOES + ' seções.');
      }
      const limpas = [];
      for (const bruta of corpo.secoes) {
        const t = String(bruta?.titulo || '').trim();
        const x = String(bruta?.texto || '').trim();
        const ic = String(bruta?.icone || '').trim();
        if (!t && !x) continue;                 /* seção em branco: descarta */
        if (t.length > LIMITE_SEC_TITULO) {
          return erro('título de seção passa de ' + LIMITE_SEC_TITULO + ' caracteres.');
        }
        if (x.length > LIMITE_SEC_TEXTO) {
          return erro('texto de seção passa de ' + LIMITE_SEC_TEXTO + ' caracteres.');
        }
        limpas.push({ icone: ic, titulo: t, texto: x });
      }
      secoes = limpas;
    }

    /* string vazia = tirar a imagem; undefined = nao mexer nela */
    const img = corpo?.imagem;
    const campos: Record<string, unknown> = {
      titulo, corpo: texto, tag, fixado: corpo?.fixado === true
    };
    if (typeof img === 'string') campos.imagem = img.trim() || null;
    if (secoes !== undefined) campos.secoes = secoes;

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

  /* ---- /update: manda esta postagem pra TODO MUNDO ----

     Vira uma linha em `avisos` com `alvo` nulo, que e o que significa
     "todos". O launcher ja sabe mostrar aviso uma vez so e marcar
     como visto — reusar isso e melhor que inventar um segundo
     caminho que teria os mesmos problemas de novo. */
  if (acao === 'anunciar') {
    const id = Number(corpo?.id);
    if (!id) return erro('mande o id da postagem.');

    const { data: post } = await sb
      .from('postagens').select('id, titulo').eq('id', id).maybeSingle();
    if (!post) return erro('não existe a postagem #' + id + '.', 404);

    const { data, error } = await sb
      .from('avisos')
      .insert({
        titulo: post.titulo,
        texto: '',
        alvo: null,                 /* nulo = todo mundo */
        postagem_id: post.id,
        por_uuid: quem.uuid
      })
      .select('id')
      .single();
    if (error) return erro(error.message, 500);

    return json({ ok: true, aviso: data.id, postagem: post.id, titulo: post.titulo });
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
