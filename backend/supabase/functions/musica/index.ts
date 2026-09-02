/* POST /musica — busca no YouTube.

   Corpo: { acao: 'buscar', termo }

   Por que passa por aqui em vez de o launcher falar direto com o
   Google: a chave da YouTube Data API e credencial. Dentro do .exe
   qualquer um a extrai e gasta a cota — e a cota e do projeto
   inteiro, entao um sozinho derruba a busca de todo mundo. Aqui ela
   fica em segredo do Supabase e nunca sai do servidor.

   Exige a permissao `musica`, a mesma que mostra o botao no launcher.
   Nao e sobre esconder musica de ninguem: e que sao 10.000 pontos por
   dia no projeto todo e cada busca custa 100. Sem tranca, ~100
   pesquisas acabam com o dia.

   Tocar nao passa por aqui. Quem toca e o player oficial do YouTube,
   embutido no launcher, que nao consome cota nenhuma.
   ============================================================ */
import { admin, erro, json, quemEh } from '../_shared/comum.ts';
import { exigirPerm } from '../_shared/perms.ts';

const CHAVE = Deno.env.get('YOUTUBE_API_KEY') || '';
const BUSCA = 'https://www.googleapis.com/youtube/v3/search';

const QUANTOS = 12;
const LIMITE_TERMO = 80;

/* 24h: o resultado de uma busca por musica nao muda de manha pra
   tarde, e cada acerto aqui e uma busca que nao foi cobrada. */
const CACHE_MS = 24 * 60 * 60 * 1000;

type Faixa = { id: string; titulo: string; canal: string; capa: string };

/* O titulo do YouTube vem com entidade HTML (&amp;, &#39;) porque a
   API devolve pronto pra pagina. Aqui vai pra textContent, entao
   apareceria cru. */
function destextar(s: string): string {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST.' }, 405);

  const corpo = await req.json().catch(() => null);
  const acao = String(corpo?.acao || 'buscar').toLowerCase();
  if (acao !== 'buscar' && acao !== 'ruim') return erro('ação desconhecida: ' + acao);

  /* A denuncia nao usa a chave: e so escrita no nosso banco. Conferir
     antes barraria o unico caminho que funciona sem ela. */
  if (acao === 'buscar' && !CHAVE) {
    return erro('a busca não está configurada no servidor.', 503);
  }

  const sb = admin();
  const quem = await quemEh(req);
  if (quem instanceof Response) return quem;
  const barrado = await exigirPerm(sb, quem, 'musica');
  if (barrado) return barrado;

  /* ------------------------------------------------------------
     "essa nao tocou"

     A API do YouTube nao conta quais videos a gravadora proibiu de
     tocar fora do site — nem `videoEmbeddable` nem `videoSyndicated`
     pegam todos, testado. So da pra saber tentando.

     Entao quem descobre e o launcher: quando o player recusa, ele
     avisa aqui, e o id sai das buscas de todo mundo dali em diante.
     A lista se limpa sozinha conforme as pessoas usam.

     So codigo 100, 101 e 150 entram. 2 e 5 sao erro de player ou de
     rede — banir por causa deles apagaria musica boa pra sempre.
     ------------------------------------------------------------ */
  if (acao === 'ruim') {
    const id = String(corpo?.id || '').trim();
    const codigo = Number(corpo?.codigo || 0);
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return erro('id inválido.');
    if (![100, 101, 150].includes(codigo)) return json({ ok: true, ignorado: true });

    await sb.from('musica_ruim').upsert({ id, codigo });
    return json({ ok: true });
  }

  const termo = String(corpo?.termo || '').trim().slice(0, LIMITE_TERMO);
  if (termo.length < 2) return erro('escreva pelo menos duas letras.');

  /* A chave do cache e o termo em minusculo: "Lofi" e "lofi" dao a
     mesma coisa e nao ha por que pagar duas vezes.

     O prefixo e a versao do FILTRO. Quando os parametros da busca
     mudam, o que esta guardado foi montado com a regra antiga e nao
     serve mais — sem isto a correcao so apareceria 24h depois, e nao
     ha como saber quais termos estao contaminados. */
  const chave = 'v2:' + termo.toLowerCase();

  const { data: guardado } = await sb
    .from('busca_musica')
    .select('resultado, criado_em')
    .eq('termo', chave)
    .maybeSingle();

  /* A peneira roda DEPOIS do cache, e nao antes de guardar: assim uma
     faixa denunciada hoje some tambem das buscas ja guardadas ontem,
     sem esperar as 24h. */
  const peneirar = async (faixas: Faixa[]) => {
    if (!faixas.length) return faixas;
    const { data } = await sb
      .from('musica_ruim')
      .select('id')
      .in('id', faixas.map((f) => f.id));
    const fora = new Set((data || []).map((x: { id: string }) => x.id));
    return faixas.filter((f) => !fora.has(f.id));
  };

  if (guardado && Date.now() - new Date(guardado.criado_em).getTime() < CACHE_MS) {
    return json({ ok: true, faixas: await peneirar(guardado.resultado), doCache: true });
  }

  const q = new URLSearchParams({
    key: CHAVE,
    part: 'snippet',
    type: 'video',
    /* Sem isto entram videos que o dono proibiu de embutir: eles
       aparecem na lista, a pessoa clica e o player mostra erro. */
    videoEmbeddable: 'true',
    /* `videoSyndicated` e o que tira os clipes que so tocam dentro do
       youtube.com — VEVO e gravadora, quase sempre. Sem ele a busca
       por musica famosa volta cheia de faixa que o player recusa. */
    videoSyndicated: 'true',
    maxResults: String(QUANTOS),
    q: termo
  });

  let r: Response;
  try {
    r = await fetch(BUSCA + '?' + q.toString());
  } catch {
    return erro('não consegui falar com o YouTube.', 502);
  }

  const j = await r.json().catch(() => null);

  if (!r.ok) {
    const motivo = j?.error?.errors?.[0]?.reason || '';
    /* Cota estourada e o erro que mais vai acontecer, e "403" sozinho
       nao diz pra pessoa que basta esperar o dia virar. */
    if (motivo === 'quotaExceeded' || motivo === 'dailyLimitExceeded') {
      /* Devolve o cache velho em vez de nada: uma lista de ontem
         serve mais que uma tela vazia. */
      if (guardado) {
      return json({ ok: true, faixas: await peneirar(guardado.resultado), doCache: true, velho: true });
    }
      return erro('a busca do dia acabou. tente de novo amanhã.', 429);
    }
    return erro(j?.error?.message || ('o YouTube respondeu ' + r.status + '.'), 502);
  }

  const faixas: Faixa[] = (j?.items || [])
    .filter((it: any) => it?.id?.videoId)
    .map((it: any) => ({
      id: it.id.videoId,
      titulo: destextar(it.snippet?.title),
      canal: destextar(it.snippet?.channelTitle),
      capa: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || ''
    }));

  /* upsert e nao insert: o termo e a chave primaria, e uma busca
     repetida depois das 24h tem que sobrescrever a antiga. */
  await sb.from('busca_musica').upsert({
    termo: chave,
    resultado: faixas,
    criado_em: new Date().toISOString()
  });

  return json({ ok: true, faixas: await peneirar(faixas) });
});
