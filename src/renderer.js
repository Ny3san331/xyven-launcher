import { criarVisor, vestir } from './skin3d.js';

/* ============================================================
   7.z MIGRAÇÃO owl.* -> xyven.* (marca antiga)
   Roda antes de qualquer leitura de storage. Só copia o que existe
   e ainda não foi migrado; depois apaga a chave velha.
   ============================================================ */
(function migrarChaves() {
  const CHAVES = ['theme', 'posts', 'editor', 'customTheme',
                  'profile', 'members', 'skins', 'cape', 'notifs', 'dir',
                  'toggles'];
  try {
    CHAVES.forEach(k => {
      const velha = 'owl.' + k, nova = 'xyven.' + k;
      const valor = localStorage.getItem(velha);
      if (valor === null) return;
      if (localStorage.getItem(nova) === null) localStorage.setItem(nova, valor);
      localStorage.removeItem(velha);
    });
  } catch (e) { /* sem storage */ }
})();

/* ============================================================
   8. DADOS — edite esta parte pra mudar conteúdo
   ============================================================ */
const CONFIG = {
  memory: { min: 1024, max: 7168, step: 256 },
  versions: [
    { id: '1.8.9',  note: 'PvP clássico · Forge' },
    { id: '1.12.2', note: 'Mods pesados · Forge' },
    { id: '1.20.1', note: 'Survival novo · Fabric' }
  ],
  javas: [
    { name: 'Java 8',  path: '...\\jre1.8.0_401\\bin\\javaw.exe', tag: '1.8.X' },
    { name: 'Java 17', path: '...\\jdk-17\\bin\\javaw.exe',       tag: 'INDICADO' },
    { name: 'Java 21', path: '...\\jdk-21\\bin\\javaw.exe',       tag: '1.20+' }
  ],
  /* vazio de proposito: instalacao nova nao vem com conta de ninguem */
  accounts: [],
  toggles: {
    launcher: [
      { key: 'theme',     on: false, label: 'Modo escuro', desc: 'mesmo tema, com a luz apagada' },
      { key: 'close',     on: false, label: 'Fechar ao tocar', desc: 'o launcher sai de cena quando o jogo abre' },
      { key: 'autostart', on: false, label: 'Abrir com o PC',  desc: 'inicia junto com o Windows' }
    ],
    discord: [
      { key: 'rpc',     on: true, label: 'Rich Presence', desc: 'mostrar o Xyven no seu Discord' },
      { key: 'rpcTape', on: true, label: 'Mostrar a fita', desc: 'inclui a versão jogada no status' }
    ]
  }
};

/* estado atual do launcher */
const state = {
  version: '1.8.9',
  mem: 2048,
  memBits: null,          /* bits do Java em uso, pra explicar o teto */
  memTotal: 0,            /* RAM da maquina, em MB */
  java: 'Java 17',
  account: '',
  tab: 'jogo'
};

/* contas e conta ativa persistem: sem isso a conta pirata some ao fechar */
const saveAccounts = () => {
  try { localStorage.setItem('xyven.accounts', JSON.stringify({ lista: CONFIG.accounts, ativa: state.account })); }
  catch (e) { /* sem storage */ }
};
/* ------------------------------------------------------------
   Achar a conta pelo nick

   Duas armadilhas, as duas ja vistas em uso:

   1. MAIUSCULA. Adicionar conta compara sem diferenciar caixa, mas
      quem procurava comparava com ===. Uma entrada gravada "_XVU" com
      a conta ativa "_xvu" nao era encontrada — e quem nao e encontrado
      e tratado como pirata, entao a original entrava offline.

   2. REPETIDA. Instalacao antiga podia ter o mesmo nick duas vezes,
      uma pirata e uma original, de antes de existir a checagem ao
      adicionar. O `find` devolvia a PRIMEIRA da lista: se a pirata
      tivesse sido criada antes, a conta original virava pirata.

   Aqui a busca ignora a caixa e, havendo mais de uma, prefere a que
   NAO e pirata — perder o offline de quem tem a original nao custa
   nada; o contrario custa o login.
   ------------------------------------------------------------ */
function ehTipoPirata(conta) {
  return /pirata|offline/i.test((conta && conta.type) || '');
}

function acharConta(nick) {
  const alvo = String(nick || '').toLowerCase();
  const iguais = CONFIG.accounts.filter((a) => String(a.name).toLowerCase() === alvo);
  return iguais.find((a) => !ehTipoPirata(a)) || iguais[0] || null;
}

(function restoreAccounts() {
  try {
    const s = JSON.parse(localStorage.getItem('xyven.accounts') || 'null');
    if (!s || !Array.isArray(s.lista) || !s.lista.length) return;
    CONFIG.accounts.length = 0;
    /* Uma entrada por nick, e a original ganha da pirata. Conserta
       quem ja tinha as duas gravadas de antes da checagem existir. */
    const vistos = new Set();
    s.lista.forEach((a) => {
      if (!a || !a.name) return;
      const chave = String(a.name).toLowerCase();
      if (vistos.has(chave)) return;
      vistos.add(chave);
      const melhor = s.lista.filter((x) => x && x.name &&
        String(x.name).toLowerCase() === chave);
      CONFIG.accounts.push(melhor.find((x) => !ehTipoPirata(x)) || melhor[0]);
    });
    if (s.ativa && acharConta(s.ativa)) state.account = s.ativa;
  } catch (e) { /* sem storage */ }
})();

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

/* Frameless window controls */
document.getElementById('btnMin').onclick = () => window.api?.window?.minimize?.();
document.getElementById('btnMax').onclick = () => window.api?.window?.maximize?.();
document.getElementById('btnClose').onclick = () => window.api?.window?.close?.();

/* ============================================================
   9. RENDER
   ============================================================ */
/* Modelo REAL da textura da conta, informado pela Mojang. Nulo enquanto nao
   se sabe — e ai a textura e tratada como se casasse com a geometria.
   Declarado AQUI, e nao la embaixo junto do resto da skin: buildSkinInto roda no
   boot, antes daquele ponto, e um 'let' depois do uso da TDZ. Ja derrubou
   este arquivo tres vezes. */
let texturaSlim = null;

function renderStats() {
  $('#versionLabel').textContent = state.version;
  /* os cards de FITA/RAM/JAVA sairam do Inicio pra dar lugar aos servidores.
     A informacao continua em Ajustes; aqui so nao pode explodir se sumir. */
  const porId = (id, txt) => { const e = $(id); if (e) e.textContent = txt; };
  porId('#statVersion', state.version);
  porId('#statMem', state.mem + ' MB');
  porId('#statJava', state.java);
  $('#chipName').textContent = state.account || 'ENTRAR';
  /* A cabeca segue a skin que o perfil esta usando; o nick da conta so entra
     quando nao ha skin escolhida.

     O try nao e decoracao: 'profile' e declarado depois desta funcao, e
     renderStats roda no boot antes disso. E 'typeof profile' NAO resolve —
     typeof so protege variavel nao declarada; num let/const em TDZ ele lanca
     igual. Foi exatamente assim que eu quebrei o boot aqui. */
  let cabeca = state.account;
  try { if (profile && profile.skin) cabeca = profile.skin; }
  catch (e) { /* perfil ainda nao existe neste ponto do boot */ }
  setAvatar($('#chipInitial'), cabeca);
  setAvatar($('#menuInitial'), cabeca);
  $('#menuName').textContent = state.account;
  paintSkins();
}

/* ============================================================
   9.b CABEÇA DO MINECRAFT nos avatares.
   Qualquer .avatar[data-skin="nick"] recebe a cabeça renderizada.
   Se estiver offline ou o nick não existir, fica a inicial.
   ============================================================ */
const SKIN_URL = (nick, px) => 'https://mc-heads.net/avatar/' + encodeURIComponent(nick) + '/' + px;

/* textContent apagaria a <img> da cabeça; só reescreve se o nick mudou.
   use SEMPRE isto pra trocar o nick de um avatar — nunca textContent direto. */
function setAvatar(el, nick) {
  if (!nick) {                       /* sem conta ainda */
    el.textContent = '?';
    delete el.dataset.skin; delete el.dataset.painted;
    el.querySelectorAll('img').forEach((i) => i.remove());
    return;
  }
  if (el.dataset.skin === nick && el.querySelector('img')) return;
  el.textContent = nick[0];
  el.dataset.skin = nick;
  delete el.dataset.painted;
}

function paintSkins(scope) {
  (scope || document).querySelectorAll('.avatar[data-skin]').forEach(el => {
    const nick = el.dataset.skin;
    if (!nick || el.dataset.painted === nick) return;
    el.dataset.painted = nick;
    el.querySelectorAll('img').forEach(i => i.remove());
    const px = Math.max(32, Math.round(parseInt(el.style.width) || 38) * 2);
    const img = new Image();
    img.alt = nick;
    /* falhou (offline, limite do serviço): libera a trava e tenta de novo depois */
    img.onerror = () => {
      img.remove();
      if (el.dataset.painted === nick) delete el.dataset.painted;
      const tries = Number(el.dataset.skinTries || 0);
      if (tries < 3) { el.dataset.skinTries = tries + 1; setTimeout(() => paintSkins(), 1200 * (tries + 1)); }
    };
    img.onload = () => { delete el.dataset.skinTries; };
    img.src = SKIN_URL(nick, px);
    el.appendChild(img);
  });
}

/* repinta sempre que qualquer lista for redesenhada */
new MutationObserver(() => paintSkins()).observe(document.body, { childList: true, subtree: true });

/* cards da home vêm das postagens do fórum marcadas com "mostrar no início" */
/* A imagem da postagem vence a do tema. As do tema eram placeholder
   de mock: servem so enquanto ninguem pos foto na postagem. */
const imgDoCard = (p, doTema) => (p && p.img) ? p.img : (doTema || '');

function renderNews() {
  const newsImages = [
    getComputedStyle(document.documentElement).getPropertyValue('--img-news-1').trim(),
    getComputedStyle(document.documentElement).getPropertyValue('--img-news-2').trim(),
    getComputedStyle(document.documentElement).getPropertyValue('--img-news-3').trim()
  ];
  const destaques = posts.filter(p => p.featured).slice(0, 3);
  if (!destaques.length) {
    $('#newsGrid').innerHTML = '<div class="empty" style="grid-column:1/-1">nada por aqui. publique no lado b e use "mostrar no início".</div>';
    return;
  }
  $('#newsGrid').innerHTML = destaques.map((p, i) => `
    <div class="card news" data-open-post="${p.id}" style="cursor:pointer">
      <div class="news__img" style="${imgDoCard(p, newsImages[i]) ? `background-image:url('${imgDoCard(p, newsImages[i])}');background-size:cover;background-position:center` : ''}">${imgDoCard(p, newsImages[i]) ? '' : 'IMAGEM'}</div>
      <div class="news__body">
        <span class="tag" style="align-self:flex-start;background:${TAG_BG[p.tag] || 'var(--sand)'}">${esc(p.tag)}</span>
        <span class="news__title">${esc(p.title)}</span>
        <span class="news__desc">${esc(p.body.split('\n')[0].slice(0, 90))}</span>
      </div>
    </div>`).join('');
}

function renderVersions() {
  const versionImg = getComputedStyle(document.documentElement).getPropertyValue('--img-version').trim();
  $('#versionGrid').innerHTML = CONFIG.versions.map(v => `
    <button class="version ${v.id === state.version ? 'is-active' : ''}" data-version="${v.id}">
      <div class="version__img" style="${versionImg ? `background-image:url('${versionImg}');background-size:cover;background-position:center` : ''}">${versionImg ? '' : 'PRINT'}</div>
      <div class="version__row">
        <span class="version__name">${v.id}</span>
        <span class="tag" style="background:${v.id === state.version ? 'var(--ink)' : 'var(--sand)'};color:${v.id === state.version ? 'var(--paper)' : 'var(--ink)'}">${v.id === state.version ? 'NA AGULHA' : 'TROCAR'}</span>
      </div>
      <span class="version__note">${v.note}</span>
    </button>`).join('');
}

/* seletor recolhido: mostra só o Java em uso e abre a lista ao clicar.
   A chave é o CAMINHO, não o nome — há máquinas com dois "Java 21". */
let javaAberto = false;

function javaEmUso() {
  return CONFIG.javas.find((j) => j.path === state.javaPath)
      || CONFIG.javas.find((j) => j.name === state.java)
      || CONFIG.javas[0] || null;
}

function renderJava() {
  const atual = javaEmUso();
  const seta = '<svg class="jsel__seta" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';

  if (!CONFIG.javas.length) {
    $('#javaList').innerHTML = '<div class="empty">nenhum Java encontrado nesta máquina.</div>';
    return;
  }

  const opcoes = CONFIG.javas.map((j) => `
    <button class="jsel__opt ${j.path === (atual && atual.path) ? 'is-on' : ''}" data-java="${esc(j.path)}">
      <span class="jsel__meio">
        <span class="jsel__nome">${esc(j.name)}</span>
        <span class="jsel__caminho">${esc(j.path)}</span>
      </span>
      <span class="tag" style="background:${j.path === (atual && atual.path) ? 'var(--teal)' : 'var(--sand)'}">${j.path === (atual && atual.path) ? 'EM USO' : esc(j.tag)}</span>
    </button>`).join('');

  $('#javaList').innerHTML = `
    <div class="jsel ${javaAberto ? 'is-aberto' : ''}" id="jsel">
      <button class="jsel__botao" id="jselBotao">
        <span class="jsel__meio">
          <span class="jsel__nome">${atual ? esc(atual.name) : 'escolher'}</span>
          <span class="jsel__caminho">${atual ? esc(atual.path) : ''}</span>
        </span>
        <span class="tag" style="background:var(--teal)">EM USO</span>
        ${seta}
      </button>
      ${javaAberto ? `<div class="jsel__lista">${opcoes}</div>` : ''}
    </div>`;
}

/* Os toggles viviam so na memoria: qualquer um que voce ligasse voltava
   desligado no proximo boot. Agora o conjunto inteiro vai pra 'xyven.toggles'.
   O tema e a excecao de proposito — ele ja tem a chave 'xyven.theme', que
   continua sendo a fonte da verdade (restoreTheme roda depois e reafirma). */
function salvarToggles() {
  const mapa = {};
  Object.keys(CONFIG.toggles).forEach((grupo) => {
    CONFIG.toggles[grupo].forEach((t) => { mapa[grupo + '.' + t.key] = t.on; });
  });
  try { localStorage.setItem('xyven.toggles', JSON.stringify(mapa)); } catch (e) { /* sem storage */ }
}

function restaurarToggles() {
  let mapa = null;
  try { mapa = JSON.parse(localStorage.getItem('xyven.toggles') || 'null'); } catch (e) { /* json torto */ }
  if (!mapa || typeof mapa !== 'object') return;
  Object.keys(CONFIG.toggles).forEach((grupo) => {
    CONFIG.toggles[grupo].forEach((t) => {
      const v = mapa[grupo + '.' + t.key];
      if (typeof v === 'boolean') t.on = v;
    });
  });
}

/* segundo estado do botao "VERIFICAR": depois de achar versao nova ele
   vira "ATUALIZAR". Declarado aqui em cima porque renderToggles() le a
   variavel e roda no boot — um 'let' abaixo dela daria TDZ, que ja quebrou
   este arquivo duas vezes. */
let modoAtualizar = false;
let soltarProgresso = null;

function renderToggles() {
  const list = state.tab === 'discord' ? CONFIG.toggles.discord : CONFIG.toggles.launcher;
  let html = list.map(t => `
    <div class="switch">
      <span><span class="switch__label">${t.label}</span><br><span class="switch__desc">${t.desc}</span></span>
      <button class="knob ${t.on ? 'is-on' : ''}" data-toggle="${t.key}"><span></span></button>
    </div>`).join('');

  /* a linha de atualização só faz sentido na aba do launcher */
  if (state.tab !== 'discord') {
    html += `
    <div class="switch">
      <span><span class="switch__label">Logs</span><br><span class="switch__desc">o que o jogo escreveu nas últimas sessões</span></span>
      <span class="switch__acao">
        <button class="btn" id="btnLogs" style="height:36px;font-size:11px">ABRIR LOGS</button>
      </span>
    </div>`;
    html += `
    <div class="switch">
      <span><span class="switch__label">Atualização</span><br><span class="switch__desc">ver se saiu versão nova do Xyven</span></span>
      <span class="switch__acao">
        <button class="btn btn--teal" id="btnAtualizar" style="height:36px;font-size:11px">VERIFICAR</button>
        <span class="switch__estado" id="estadoAtualizar"></span>
      </span>
    </div>`;
  }
  $('#panel-toggles').innerHTML = html;
  if ($('#estadoAtualizar')) mostrarVersaoAtual();
  /* o botao e recriado a cada render: devolve o rotulo se havia atualizacao */
  if (modoAtualizar && $('#btnAtualizar')) $('#btnAtualizar').textContent = 'ATUALIZAR';
}

/* mostra a versão instalada assim que a aba abre */
async function mostrarVersaoAtual() {
  if (!temApi() || !window.api.app) return;
  try { $('#estadoAtualizar').textContent = 'versão ' + (await window.api.app.getVersion()); }
  catch (e) { /* sem api */ }
}

/* o botão é recriado a cada render, então vai por delegação */
$('#panel-toggles').addEventListener('click', async (e) => {
  if (!e.target.closest('#btnAtualizar')) return;
  /* o botao tem dois papeis; neste modo quem responde e o handler de baixo */
  if (modoAtualizar) return;
  const botao = $('#btnAtualizar'), estado = $('#estadoAtualizar');
  botao.disabled = true;
  estado.className = 'switch__estado';
  estado.textContent = 'procurando...';

  const r = temApi() && window.api.app ? await window.api.app.atualizacao() : null;
  botao.disabled = false;

  if (!r || !r.ok) { estado.textContent = (r && r.erro) || 'não consegui verificar.'; return; }
  if (r.nenhuma) { estado.textContent = 'versão ' + r.atual + ' · nenhuma publicada ainda'; return; }
  if (r.temNova) {
    estado.className = 'switch__estado switch__estado--nova';
    estado.textContent = 'saiu a ' + r.ultima + ' — você tem a ' + r.atual;
    /* o mesmo botao vira o de instalar: mandar a pessoa pra pagina de
       download significava, na pratica, que ninguem atualizava */
    modoAtualizar = true;
    botao.textContent = 'ATUALIZAR';
    return;
  }
  modoAtualizar = false;
  botao.textContent = 'VERIFICAR';
  estado.textContent = 'versão ' + r.atual + ' · já é a mais recente';
});

$('#panel-toggles').addEventListener('click', async (e) => {
  if (!modoAtualizar || !e.target.closest('#btnAtualizar')) return;
  e.stopImmediatePropagation();
  const botao = $('#btnAtualizar'), estado = $('#estadoAtualizar');
  if (!temApi() || !window.api.app.baixarAtualizacao) { estado.textContent = 'não disponível aqui.'; return; }

  botao.disabled = true;
  estado.className = 'switch__estado';
  estado.textContent = 'baixando... 0%';

  if (soltarProgresso) soltarProgresso();
  soltarProgresso = window.api.app.aoProgressoAtualizacao((d) => {
    if (!d || typeof d.pct !== 'number') return;
    const mb = d.total ? ' (' + (d.baixado / 1048576).toFixed(0) + '/' + (d.total / 1048576).toFixed(0) + ' MB)' : '';
    estado.textContent = 'baixando... ' + d.pct + '%' + mb;
  });

  const r = await window.api.app.baixarAtualizacao();
  if (soltarProgresso) { soltarProgresso(); soltarProgresso = null; }
  botao.disabled = false;

  if (!r || !r.ok) { estado.textContent = (r && r.erro) || 'não consegui baixar.'; return; }

  estado.textContent = 'verificado · atualizando, o Xyven vai reabrir';
  botao.disabled = true;
  const i = await window.api.app.instalarAtualizacao(r.caminho);
  if (!i || !i.ok) {
    botao.disabled = false;
    estado.textContent = (i && i.erro) || 'não consegui atualizar.';
  }
});

function renderAccounts() {
  $('#accountList').innerHTML = CONFIG.accounts.map(a => `
    <button class="account ${a.name === state.account ? 'is-active' : ''}" data-account="${a.name}">
      <span class="avatar" style="width:38px;height:38px;font-size:17px;border-width:3px" data-skin="${a.name}">${a.name[0]}</span>
      <span style="flex:1"><span class="account__name">${a.name}</span><br><span class="account__type">${a.type}</span></span>
      <span style="font-size:9px;font-weight:700;letter-spacing:.12em">${a.name === state.account ? 'ATIVA' : ''}</span>
    </button>`).join('') + `
    <button class="account account--add" id="addAccount">+ ADICIONAR CONTA</button>`;
}

/* o teto do fader vem da maquina, nao do HTML: 32 bits nao passa de ~1 GB,
   e prometer mais RAM do que existe mata a JVM antes de abrir. */
async function aplicarLimitesDeMemoria() {
  if (!temApi() || !window.api.java || !window.api.java.limites) return;
  try {
    const lim = await window.api.java.limites(state.javaPath || undefined);
    if (!lim || !lim.max) return;
    CONFIG.memory.min = lim.min;
    CONFIG.memory.max = lim.max;
    state.memBits = lim.bits;
    state.memTotal = lim.totalMb;
    state.mem = Math.min(Math.max(state.mem, lim.min), lim.max);
    renderMemory();
  } catch (e) { console.warn('não consegui medir a memória disponível', e); }
}

function renderMemory() {
  const { min, max } = CONFIG.memory;
  /* um valor gravado antes de o teto ser medido pode estar acima dele;
     prender aqui evita a barra passar da trilha enquanto isso nao resolve */
  const seguro = Math.min(max, Math.max(min, state.mem));
  /* prende o estado, nao so o texto: exibir 5632 e lancar o jogo com 6144
     seria a tela mentindo justamente sobre o que quebrou a JVM da amiga */
  state.mem = seguro;
  const pct = ((seguro - min) / (max - min)) * 100 + '%';
  $('#memMb').textContent = seguro + ' MB';
  $('#memGb').textContent = '≈ ' + (seguro / 1024).toFixed(2) + ' GB';
  $('#faderFill').style.width = pct;
  $('#faderKnob').style.left = pct;
  $('#memMin').textContent = min + ' MB';
  $('#memMax').textContent = max + ' MB';
  const dica = $('#memHint');
  if (dica) {
    /* a frase antiga dava os dois numeros soltos ("a maquina tem 7.7 GB;
       o teto deixa 2 GB") e parecia contradicao: 7.7 menos 2 nao e o teto
       obvio, porque ainda ha o arredondamento pra baixo de 256 em 256.
       Melhor mostrar a subtracao inteira, com o resultado no fim. */
    dica.textContent = state.memBits === 32
      ? 'este Java é de 32 bits: ele não passa de ~1 GB, por mais RAM que a máquina tenha.'
      : (state.memTotal ? 'dos ' + (state.memTotal / 1024).toFixed(1)
          + ' GB da máquina, 2 GB ficam para o sistema — por isso o teto é '
          + (max / 1024).toFixed(1) + ' GB.' : '');
  }
  renderStats();
}

/* ============================================================
   10. INTERAÇÕES
   ============================================================ */
const open  = (el) => { el.hidden = false; };

/* ------------------------------------------------------------
   PERGUNTA E AVISO no tema

   `confirm()` e `alert()` do sistema abrem uma janela do Windows no
   meio do launcher: fonte errada, cor errada, contorno errado. Estas
   duas devolvem promessa e usam o mesmo modal do resto.

   Diferenca que importa: as nativas TRAVAM tudo ate a resposta. Estas
   nao — por isso todo lugar que pergunta precisa de `await`, senao o
   codigo segue como se a pessoa ja tivesse dito sim.
   ------------------------------------------------------------ */
function perguntar(texto, titulo) {
  return new Promise((resolve) => {
    const ov = $('#askOverlay');
    if (!ov) return resolve(false);   /* sem modal: nao faz o destrutivo */

    $('#askTitulo').textContent = titulo || 'Confirmar';
    $('#askTexto').textContent = texto;
    $('#askSim').hidden = false;
    $('#askNao').textContent = 'NAO';

    const fechar = (resposta) => {
      ov.hidden = true;
      document.removeEventListener('keydown', pelaTecla, true);
      resolve(resposta);
    };
    /* Esc = nao: fechar sem responder nunca pode valer como sim.
       Na fase de captura pra o Esc nao vazar e fechar outro modal. */
    const pelaTecla = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); fechar(false); }
      else if (e.key === 'Enter') { e.stopPropagation(); fechar(true); }
    };

    $('#askSim').onclick = () => fechar(true);
    $('#askNao').onclick = () => fechar(false);
    document.addEventListener('keydown', pelaTecla, true);

    open(ov);
    /* foco no NAO: a tecla mais facil de apertar sem ler nao pode ser
       a que apaga alguma coisa */
    setTimeout(() => $('#askNao').focus(), 30);
  });
}

/* Aviso de uma opcao so. Reusa o mesmo modal: o SIM some e o NAO vira
   ENTENDI, pra nao parecer que ha uma escolha que nao existe. */
function avisar(texto, titulo) {
  return new Promise((resolve) => {
    const ov = $('#askOverlay');
    if (!ov) return resolve();

    $('#askTitulo').textContent = titulo || 'Aviso';
    $('#askTexto').textContent = texto;
    $('#askSim').hidden = true;
    $('#askNao').textContent = 'ENTENDI';

    const fechar = () => {
      ov.hidden = true;
      document.removeEventListener('keydown', pelaTecla, true);
      /* devolve o modal ao estado de pergunta pro proximo uso */
      $('#askSim').hidden = false;
      $('#askNao').textContent = 'NAO';
      resolve();
    };
    const pelaTecla = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); fechar(); }
    };

    $('#askNao').onclick = fechar;
    document.addEventListener('keydown', pelaTecla, true);

    open(ov);
    setTimeout(() => $('#askNao').focus(), 30);
  });
}
const close = (el) => { el.hidden = true; };

/* menu de conta */
const chip = document.getElementById('accountChip');
const accMenu = document.getElementById('accountMenu');
chip.addEventListener('click', (e) => {
  e.stopPropagation();
  accMenu.hidden = !accMenu.hidden;
  /* Os dois abrem no mesmo canto e se sobrepoem. O sino ja fechava
     este menu; faltava o contrario, entao abrir na ordem sino ->
     conta deixava os dois na tela, um por cima do outro. */
  if (!accMenu.hidden) $('#notifPanel').hidden = true;
});
document.addEventListener('click', (e) => {
  if (!accMenu.contains(e.target) && !chip.contains(e.target)) accMenu.hidden = true;
});
$$('[data-open="switch"]').forEach(b => b.onclick = () => { close($('#accountMenu')); open($('#switchOverlay')); renderAccounts(); });

/* fechar modais (clique no fundo, no X, ou Esc) */
$$('.overlay').forEach(ov => ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.x') || e.target.closest('button[data-close]')) close(ov); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.overlay').forEach(close); });

/* rail */
$('#rail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]'); if (!b) return;
  if (b.dataset.nav === 'dev') { abrirTerminal(); return; }
  $$('.rail__btn').forEach(x => x.classList.remove('is-active'));
  b.classList.add('is-active');
  showScreen(b.dataset.nav);
});

/* troca a tela mostrada em <main>. telas ainda sem conteúdo caem no início. */
function showScreen(name) {
  const known = ['home', 'news', 'profile', 'cosmetics'];
  const target = known.includes(name) ? name : 'home';
  $('#screen-home').hidden = target !== 'home';
  $('#screen-news').hidden = target !== 'news';
  $('#screen-profile').hidden = target !== 'profile';
  $('#screen-cosmetics').hidden = target !== 'cosmetics';
  if (target === 'news') { renderFilters(); renderFeed(); }
  /* redesenha ao entrar: o "VOCÊ TEM" depende da conta ativa, que
     pode ter mudado desde a ultima vez que a tela foi montada */
  if (target === 'cosmetics') { renderLoja(); carregarLoja(); }
  if (target === 'profile') {
    renderProfile();
    /* consulta a conta pra acertar braco e capa do boneco */
    carregarCapas(profile.nick).then(() => buildSkin());
  }
}

/* o rail marca o botão certo quando a tela vem do menu de conta */
function goToScreen(name) {
  $$('.rail__btn').forEach(x => x.classList.toggle('is-active', x.dataset.nav === name));
  showScreen(name);
}

/* menu de contas -> tela de perfil (marca o rail junto) */
$$('[data-open="profile"]').forEach(b => b.onclick = () => {
  if (!exigirConta('Entrar para ver o perfil')) return;
  close($('#accountMenu')); goToScreen('profile');
});

/* ---- porteiro: quase tudo depende de ter uma conta ---- */
function temConta() { return CONFIG.accounts.length > 0 && !!state.account; }

function exigirConta(motivo) {
  if (temConta()) return true;
  close($('#accountMenu'));
  open($('#addOverlay'));
  const t = $('#addOverlay').querySelector('.modal__head h3');
  if (t) t.textContent = motivo || 'Entrar para começar';
  return false;
}

/* ---- remover a conta ativa ---- */
$('#removerConta').onclick = async () => {
  const alvo = state.account;
  close($('#accountMenu'));

  if (CONFIG.accounts.length <= 1) {
    await avisar('essa é a única conta do launcher. adicione outra antes de remover.');
    return;
  }
  if (jogoAberto || jogoAbrindo) {
    await avisar('feche o Minecraft antes de remover a conta.');
    return;
  }
  const vaiRemover = !!await perguntar('remover "' + alvo + '" do launcher?\n\no tempo de jogo dessa conta é mantido, e você pode entrar de novo depois.', 'Remover conta');
  if (!vaiRemover) return;

  /* apaga o token da Microsoft guardado no disco, se houver */
  if (temApi() && window.api.auth) {
    try { await window.api.auth.esquecer(alvo); } catch (e) { /* nao havia token */ }
  }
  if (contaMS && contaMS.nick === alvo) contaMS = null;

  CONFIG.accounts = CONFIG.accounts.filter((a) => a.name !== alvo);
  state.account = CONFIG.accounts[0].name;
  profile.nick = state.account; profile.skin = state.account;
  capasDaConta = []; contaEhPremium = false;

  saveAccounts(); saveProfile();
  applyGroup(); renderStats(); renderProfile(); renderAccounts();
  carregarCapas(profile.nick).then(() => { buildSkin(); renderProfile(); });
};
$$('[data-open="add"]').forEach(b => b.onclick = () => { close($('#accountMenu')); close($('#switchOverlay')); open($('#addOverlay')); });

/* ---- adicionar conta: original (Microsoft) ou pirata (só nick) ---- */
const NICK_OK = /^[A-Za-z0-9_]{3,16}$/;

/* ---- login Microsoft: fluxo de codigo (o mesmo do CmlLib) ----
   a Microsoft abre numa janela propria; o launcher nunca ve a senha. */
function msMostra(passo, { codigo, abrir, espera, erro } = {}) {
  $('#msPasso').textContent = passo;
  $('#msCodigo').hidden = !codigo;
  if (codigo) $('#msCodigo').textContent = codigo;
  $('#msAbrir').hidden = !abrir;
  $('#msEspera').hidden = !espera;
  $('#msErro').hidden = !erro;
  if (erro) $('#msErro').textContent = erro;
}

$('#addOriginal').onclick = async () => {
  close($('#addOverlay'));
  if (!temApi() || !window.api.auth) {
    await avisar('o login da Microsoft só funciona no app.');
    return;
  }
  open($('#msOverlay'));
  msMostra('entre na janela da Microsoft.', { espera: true });

  const res = await window.api.auth.entrar();
  /* fechou a janela sem entrar: sai calado, não é erro */
  if (res.cancelado) { close($('#msOverlay')); return; }
  if (!res.ok) { msMostra('o login não foi concluído.', { erro: res.erro }); return; }

  const c = res.conta;
  const jaTem = acharConta(c.nick);
  if (jaTem) { jaTem.name = c.nick; jaTem.type = 'microsoft · premium'; }
  else CONFIG.accounts.push({ name: c.nick, type: 'microsoft · premium' });

  contaMS = c;
  state.account = c.nick;
  profile.nick = c.nick; profile.skin = c.nick;
  saveAccounts();
  applyGroup(); renderStats(); renderProfile(); renderAccounts();
  close($('#msOverlay'));
  sincronizarConta();
};

/* o main narra cada etapa: quando falha, da pra ver onde parou */
if (temApi() && window.api.auth && window.api.auth.aoPasso) {
  window.api.auth.aoPasso((t) => {
    if (!$('#msOverlay').hidden) $('#msPasso').textContent = t;
  });
}

/* a area de transferencia do Electron nao exige janela focada,
   ao contrario de navigator.clipboard (que reclama e assusta o usuario) */
async function copiar(texto) {
  if (temApi() && window.api.copiar) { await window.api.copiar(texto); return true; }
  try { await navigator.clipboard.writeText(texto); return true; } catch (e) { return false; }
}

$('#msCancelar').onclick = () => {
  if (temApi() && window.api.auth) window.api.auth.abortar();
  close($('#msOverlay'));
};

$('#addOffline').onclick = () => {
  close($('#addOverlay'));
  const av = $('#offlineAvatar');
  $('#offlineNick').value = '';
  av.textContent = '?';
  av.querySelectorAll('img').forEach(i => i.remove());
  delete av.dataset.skin; delete av.dataset.painted;
  open($('#offlineOverlay'));
  setTimeout(() => $('#offlineNick').focus(), 30);
};

$('#offlineNick').addEventListener('input', (e) => {
  const nick = e.target.value.trim();
  const av = $('#offlineAvatar');
  av.textContent = nick ? nick[0].toUpperCase() : '?';
  av.querySelectorAll('img').forEach(i => i.remove());
  delete av.dataset.painted;
  if (NICK_OK.test(nick)) { av.dataset.skin = nick; paintSkins(); }
  else delete av.dataset.skin;
});

$('#offlineSave').onclick = () => {
  const nick = $('#offlineNick').value.trim();
  const warn = $('#offlineWarn');
  const fail = (msg) => { warn.textContent = msg; warn.style.color = 'var(--red)'; };
  if (!NICK_OK.test(nick)) return fail('nick inválido. de 3 a 16 caracteres, só letras, números e _.');
  if (CONFIG.accounts.some(a => a.name.toLowerCase() === nick.toLowerCase())) return fail('essa conta já está no launcher.');
  CONFIG.accounts.push({ name: nick, type: 'pirata · offline' });
  state.account = nick;
  /* conta nova pode ter coisa esperando por ela no servidor */
  setTimeout(sincronizarConta, 0);
  profile.nick = nick; profile.skin = nick;
  warn.textContent = 'de 3 a 16 caracteres. letras, números e _ apenas. serve só em servidor offline.';
  warn.style.color = '';
  close($('#offlineOverlay'));
  saveAccounts();
  applyGroup(); renderStats(); renderProfile(); renderAccounts();
};

/* versões */
$('#versionBtn').onclick = () => { renderVersions(); open($('#versionOverlay')); };
$('#versionGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-version]'); if (!b) return;
  state.version = b.dataset.version; renderStats(); close($('#versionOverlay'));
});

/* configurações */
$('#openSettings').onclick = () => { open($('#settingsOverlay')); renderJava(); renderMemory(); };
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  state.tab = b.dataset.tab;
  $$('.tab').forEach(x => x.classList.toggle('is-active', x === b));
  const isJogo = state.tab === 'jogo';
  $('#panel-jogo').hidden = !isJogo;
  $('#panel-toggles').hidden = isJogo;
  $('#settingsTitle').textContent = isJogo ? 'Ajustes do jogo' : 'Ajustes do ' + b.textContent.toLowerCase();
  if (!isJogo) renderToggles();
});
$('#panel-toggles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-toggle]'); if (!b) return;
  const list = state.tab === 'discord' ? CONFIG.toggles.discord : CONFIG.toggles.launcher;
  const item = list.find(t => t.key === b.dataset.toggle);
  item.on = !item.on; b.classList.toggle('is-on', item.on);
  if (item.key === 'theme') applyTheme(item.on);
  if (item.key === 'autostart') aplicarAutostart(item.on, b);
  if (item.key === 'rpc') {
    if (temApi() && window.api.discord) {
      if (item.on) {
        window.api.discord.ligar();
        window.api.discord.estado({ jogando: jogoAberto, versao: state.version, servidor: ondeEstou?.nome, mostrarFita: CONFIG.toggles.discord.find(t => t.key === 'rpcTape')?.on });
      } else {
        /* apaga a presenca em vez de trocar o texto dela */
        window.api.discord.desligar();
      }
    }
  }
  if (item.key === 'rpcTape' && temApi() && window.api.discord) {
    window.api.discord.estado({ jogando: jogoAberto, versao: state.version, servidor: ondeEstou?.nome, mostrarFita: item.on });
  }
  salvarToggles();
});

/* O Windows e quem manda aqui. Se ele recusar, o botao volta atras em vez
   de ficar aceso prometendo uma coisa que nao vai acontecer. */
async function aplicarAutostart(ligar, botao) {
  if (!temApi() || !window.api.app || !window.api.app.autostart) return;
  let real = ligar;
  try { real = await window.api.app.autostart(ligar); } catch (e) { real = !ligar; }
  if (real === ligar) return;
  const item = CONFIG.toggles.launcher.find((t) => t.key === 'autostart');
  if (item) item.on = real;
  if (botao) botao.classList.toggle('is-on', real);
  salvarToggles();
}

/* No boot, quem manda e o Windows, nao o que gravamos. Sem isto o toggle
   mostraria o valor salvo mesmo que o item tivesse sido tirado por fora. */
async function sincronizarAutostart() {
  if (!temApi() || !window.api.app || !window.api.app.autostartEstado) return;
  let real;
  try { real = await window.api.app.autostartEstado(); } catch (e) { return; }
  const item = CONFIG.toggles.launcher.find((t) => t.key === 'autostart');
  if (!item || item.on === real) return;
  item.on = real;
  salvarToggles();
  if (!$('#panel-toggles').hidden) renderToggles();
}
$('#javaList').addEventListener('click', (e) => {
  if (e.target.closest('#jselBotao')) { javaAberto = !javaAberto; renderJava(); return; }
  const b = e.target.closest('[data-java]'); if (!b) return;
  const escolhido = CONFIG.javas.find((j) => j.path === b.dataset.java);
  if (escolhido) { state.javaPath = escolhido.path; state.java = escolhido.name; }
  javaAberto = false;
  renderJava(); renderStats(); aplicarLimitesDeMemoria();
});

/* clicar fora fecha a lista */
document.addEventListener('click', (e) => {
  if (!javaAberto || e.target.closest('#jsel')) return;
  javaAberto = false; renderJava();
});
$('#dirInput').addEventListener('change', (e) => { state.dir = e.target.value; salvarPasta(); carregarVersoes(); });
$('#browseBtn').onclick = () => { /* AQUI: abrir o seletor de pasta do Electron/Tauri */ };
$('#accountList').addEventListener('click', (e) => {
  /* criado por renderAccounts a cada desenho, entao nao da pra ligar direto */
  if (e.target.closest('#addAccount')) { close($('#switchOverlay')); open($('#addOverlay')); return; }
  const b = e.target.closest('[data-account]'); if (!b) return;
  state.account = b.dataset.account;
  profile.nick = state.account; profile.skin = state.account;
  saveAccounts();
  applyGroup(); renderStats(); renderProfile(); close($('#switchOverlay'));
  /* cargos e capas sao por conta: trocar de conta tem que reperguntar
     ao servidor, senao a tela fica mostrando o que era da anterior */
  sincronizarConta();
});

/* fader de memória (arrastar) */
(function fader() {
  const el = $('#fader');
  const setFrom = (x) => {
    /* le CONFIG.memory a cada arrasto, e nao uma vez na carga do modulo:
       o teto so e conhecido depois que o Java e medido, e desestruturar
       aqui em cima congelava o 7168 do HTML. O arrasto entregava valores
       acima do teto real, e o renderMemory, que usa o teto vivo, punha o
       botao em 111% da trilha — dai ele sair pra fora. */
    const { min, max, step } = CONFIG.memory;
    const r = el.firstElementChild.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (x - r.left) / r.width));
    const bruto = Math.round((min + p * (max - min)) / step) * step;
    state.mem = Math.min(max, Math.max(min, bruto));
    renderMemory();
  };
  el.addEventListener('pointerdown', (e) => {
    setFrom(e.clientX);
    const move = (ev) => setFrom(ev.clientX);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
})();

/* ============================================================
   13.b TEMPO DE JOGO E SERVIDORES — contagem real.
   Por conta. Semana zera a cada 7 dias, mes a cada 30.
   ============================================================ */
const SEMANA_MS = 7 * 24 * 3600 * 1000;
const MES_MS = 30 * 24 * 3600 * 1000;

function horasVazias() {
  const agora = Date.now();
  return { total: 0, semana: 0, mes: 0, ultimaSessao: 0, inicioSemana: agora, inicioMes: agora, servidores: {} };
}

let horas = {};
try { horas = JSON.parse(localStorage.getItem('xyven.horas') || '{}'); } catch (e) { horas = {}; }
const salvarHoras = () => { try { localStorage.setItem('xyven.horas', JSON.stringify(horas)); } catch (e) { /* sem storage */ } };

/* devolve o registro da conta ja com as janelas vencidas zeradas */
function horasDe(nick) {
  if (!horas[nick]) horas[nick] = horasVazias();
  const h = horas[nick];
  const agora = Date.now();
  if (agora - h.inicioSemana >= SEMANA_MS) { h.semana = 0; h.inicioSemana = agora; }
  if (agora - h.inicioMes >= MES_MS) { h.mes = 0; h.inicioMes = agora; }
  return h;
}

/* segundos -> "3 h" / "42 min" */
function tempoCurto(seg) {
  if (!seg) return '0 min';
  if (seg < 3600) return Math.max(1, Math.round(seg / 60)) + ' min';
  return Math.round(seg / 3600) + ' h';
}

/* ---- servidores: sai do proprio log do jogo ---- */
const RE_CONECTOU = /Connecting to ([^,]+), *(\d+)/;
const RE_LOCAL = /Starting integrated minecraft server/;
const GENERICOS = ['mc', 'play', 'jogar', 'www', 'br', 's1', 's2', 'host', 'server', 'servidor'];
const TLDS = ['com', 'br', 'net', 'org', 'gg', 'io', 'xyz', 'gay', 'club', 'me', 'tv', 'us',
              'eu', 'fun', 'pro', 'online', 'site', 'store', 'shop', 'top', 'cc', 'lol', 'dev'];

/* "br.mush.com.br" -> "Mush" */
function nomeDoServidor(host) {
  const limpo = String(host).replace(/\.$/, '');
  /* IP nao tem nome pra extrair: usa ele mesmo */
  if (/^[0-9.]+$/.test(limpo)) return limpo;
  const partes = limpo.toLowerCase().split('.').filter(Boolean);
  const miolo = partes.filter((p) => !GENERICOS.includes(p) && !TLDS.includes(p));
  const escolhido = miolo.sort((a, b) => b.length - a.length)[0] || partes[0] || host;
  return escolhido.charAt(0).toUpperCase() + escolhido.slice(1);
}

let ondeEstou = null;   /* { chave, nome, addr, desde } */
let sessaoInicio = 0;

function comecarSessao() { sessaoInicio = Date.now(); ondeEstou = null; }

function fecharSessao() {
  if (!sessaoInicio) return;
  const seg = Math.round((Date.now() - sessaoInicio) / 1000);
  sessaoInicio = 0;
  sairDoServidor();                      /* fecha o servidor que ficou aberto */
  if (seg < 30) return;                  /* abriu e fechou: nao conta */
  const h = horasDe(state.account);
  h.total += seg; h.semana += seg; h.mes += seg;
  h.ultimaSessao = seg;
  salvarHoras();
  renderProfile();
}

function entrarEm(chave, nome, addr) {
  sairDoServidor();
  ondeEstou = { chave, nome, addr, desde: Date.now() };

  /* Discord Rich Presence — atualiza com o servidor */
  if (temApi() && window.api.discord && jogoAberto) {
    const rpcOn = CONFIG.toggles.discord.find(t => t.key === 'rpc')?.on;
    const rpcTapeOn = CONFIG.toggles.discord.find(t => t.key === 'rpcTape')?.on;
    if (rpcOn) {
      window.api.discord.estado({
        jogando: true,
        versao: state.version,
        servidor: nome,
        mostrarFita: !!rpcTapeOn
      });
    }
  }
}

function sairDoServidor() {
  if (!ondeEstou) return;
  const onde = ondeEstou;
  ondeEstou = null;
  const seg = Math.round((Date.now() - onde.desde) / 1000);
  if (seg < 30) return;                 /* entrou e saiu: nao vale registro */
  const h = horasDe(state.account);
  const reg = h.servidores[onde.chave] || { nome: onde.nome, addr: onde.addr, segundos: 0 };
  reg.segundos += seg;
  reg.nome = onde.nome; reg.addr = onde.addr;
  h.servidores[onde.chave] = reg;
  salvarHoras();

  /* Discord Rich Presence — volta para "No menu" ou só a fita */
  if (temApi() && window.api.discord && jogoAberto) {
    const rpcOn = CONFIG.toggles.discord.find(t => t.key === 'rpc')?.on;
    const rpcTapeOn = CONFIG.toggles.discord.find(t => t.key === 'rpcTape')?.on;
    if (rpcOn) {
      window.api.discord.estado({
        jogando: true,
        versao: state.version,
        servidor: undefined,
        mostrarFita: !!rpcTapeOn
      });
    }
  }
}

/* le cada linha do jogo procurando troca de servidor */
function lerLinhaDeServidor(linha) {
  const m = RE_CONECTOU.exec(linha);
  if (m) {
    const host = m[1].trim().replace(/\.$/, '');
    entrarEm(host.toLowerCase(), nomeDoServidor(host), host);
    return;
  }
  if (RE_LOCAL.test(linha)) entrarEm('__local__', 'Mundo local', 'singleplayer · local');
}

/* ============================================================
   14. INICIAR O MINECRAFT — conversa com o processo principal.
   Nada de rede ou disco aqui: tudo por IPC.
   ============================================================ */
/* declaracao de funcao (nao const): e usada no topo do modulo,
   antes deste ponto, e function e hoisted */
function temApi() { return !!(window.api && window.api.mc); }
let jogoAbrindo = false;
let jogoAberto = false;
let erroDoJogo = null;

function mostrarProgresso(mostrar) {
  $('#heroIdle').hidden = mostrar;
  $('#heroProgress').hidden = !mostrar;
  if (!mostrar) { $('#progressFill').style.width = '0%'; $('#progressPct').textContent = '0%'; }
}

function pintarProgresso(p) {
  const pct = p.bytesTotal ? (p.bytesProntos / p.bytesTotal) * 100
            : p.arquivosTotal ? (p.arquivosProntos / p.arquivosTotal) * 100 : 0;
  const n = Math.max(0, Math.min(100, pct));
  $('#progressFill').style.width = n.toFixed(1) + '%';
  $('#progressPct').textContent = Math.round(n) + '%';
  $('#progressLabel').textContent = p.fase + ' ' + state.version;
}

/* o rotulo vive num no de texto ao lado do svg do play;
   trocar so o texto preserva o icone e a estrutura do DOM */
function rotuloPlay(texto) {
  const b = $('#playBtn');
  const no = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  if (no) no.textContent = ' ' + texto + ' ';
}

/* ---- console do jogo (provisorio ate o design da tela chegar) ---- */
function consoleAberto() { return !$('#consoleOverlay').hidden; }

function linhaConsole(texto) {
  const el = document.createElement('span');
  el.className = 'console__linha' + (texto.startsWith('[err] ') ? ' console__linha--err' : '');
  el.textContent = texto;
  return el;
}

function pintarConsole() {
  const out = $('#consoleOut');
  out.textContent = '';
  if (!logDoJogo.length) {
    const v = document.createElement('span');
    v.className = 'console__vazio';
    v.textContent = 'nada ainda. o log aparece assim que o jogo escreve.';
    out.appendChild(v);
  } else {
    logDoJogo.forEach((l) => out.appendChild(linhaConsole(l)));
  }
  out.scrollTop = out.scrollHeight;
  contarConsole();
}

function contarConsole() {
  $('#consoleConta').textContent = logDoJogo.length + (logDoJogo.length === 1 ? ' linha' : ' linhas');
  $('#consoleEstado').textContent = erroDoJogo || (jogoAberto ? 'AO VIVO' : 'ENCERRADO');
  const ponto = $('#consoleOverlay').querySelector('.console__dot');
  if (ponto) ponto.classList.toggle('console__dot--erro', !!erroDoJogo);
}

/* joga o console na frente com tudo que saiu ate o erro */
function abrirConsoleComErro(rotulo) {
  erroDoJogo = rotulo;
  open($('#consoleOverlay'));
  pintarConsole();
  const out = $('#consoleOut');
  out.scrollTop = out.scrollHeight;
}

function acrescentarConsole(texto) {
  if (!consoleAberto()) return;
  const out = $('#consoleOut');
  const vazio = out.querySelector('.console__vazio');
  if (vazio) out.textContent = '';
  /* so acompanha o fim se o usuario ja estava no fim */
  const noFim = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  out.appendChild(linhaConsole(texto));
  if (noFim) out.scrollTop = out.scrollHeight;
  contarConsole();
}

function marcarTocando(tocando) {
  jogoAberto = tocando;
  rotuloPlay(tocando ? 'FECHAR MINECRAFT ' + state.version : 'TOCAR');
  /* com o jogo aberto ele fecha o jogo, entao segue clicavel */
  $('#playBtn').disabled = false;
  $('#playBtn').classList.toggle('is-fechar', tocando);
  /* o seletor de fita sai de cena: trocar de versao com o jogo aberto nao faz sentido */
  $('#versionBtn').disabled = tocando;
  $('#versionBtn').hidden = tocando;
  /* so existe enquanto o jogo estiver aberto */
  $('#consoleBtn').hidden = !tocando;
  /* se deu erro, o console fica na tela pro usuario ler */
  if (!tocando && !erroDoJogo) close($('#consoleOverlay'));
  if ($('#consoleOverlay') && !$('#consoleOverlay').hidden) contarConsole();

  /* Discord Rich Presence */
  if (temApi() && window.api.discord) {
    const rpcOn = CONFIG.toggles.discord.find(t => t.key === 'rpc')?.on;
    const rpcTapeOn = CONFIG.toggles.discord.find(t => t.key === 'rpcTape')?.on;
    if (rpcOn) {
      window.api.discord.estado({
        jogando: tocando,
        versao: state.version,
        servidor: ondeEstou?.nome,
        mostrarFita: !!rpcTapeOn
      });
    } else {
      window.api.discord.estado({ jogando: false, mostrarFita: false });
    }
  }
}

function falhaAoTocar(msg) {
  logDoJogo.push('[err] ' + msg);
  marcarTocando(false);
  abrirConsoleComErro('NÃO ABRIU');
  jogoAbrindo = false;
  mostrarProgresso(false);
  $('#progressLabel').textContent = 'REBOBINANDO A FITA';
  /* o console ja esta na frente com o motivo */
}

if (temApi()) {
  window.api.mc.aoProgredir(pintarProgresso);
  window.api.mc.aoLog((linha) => {
    lerLinhaDeServidor(linha);
    logDoJogo.push(linha);
    if (logDoJogo.length > 5000) logDoJogo.shift();
    acrescentarConsole(linha);
  });
  window.api.mc.aoSair((codigo) => {
    jogoAbrindo = false;
    fecharSessao();
    marcarTocando(false);
    mostrarProgresso(false);
    if (codigo !== 0 && codigo !== null) abrirConsoleComErro('ERRO · CÓDIGO ' + codigo);
  });
}
const logDoJogo = [];

/* Um caminho só pra abrir o jogo. O botão TOCAR chama sem servidor;
   os cards de servidor chamam com o IP, e o jogo entra direto lá. */
async function tocar(servidor) {
  if (jogoAbrindo) return;
  if (!exigirConta('Entrar para jogar')) return;
  if (jogoAberto) {                     /* segundo clique: encerra o jogo */
    if (temApi()) window.api.mc.matar(state.dir);
    return;
  }
  if (!temApi()) { await avisar('a inicialização só funciona no app; no navegador não há acesso ao disco.'); return; }

  let java = javaEmUso();

  /* A lista de Javas e de quando o launcher abriu, e ela envelhece:
     desinstalar ou mover um Java com o launcher aberto deixa uma
     entrada apontando pra lugar nenhum. Sem esta conferencia, a
     checagem de compatibilidade dizia "tem Java 8, serve" e o jogo
     morria com ENOENT — sem baixar o que faltava. */
  if (java && java.path && !java.path.startsWith('...') && temApi() && window.api.java.existe) {
    if (!(await window.api.java.existe(java.path))) {
      await carregarJava();
      java = javaEmUso();
    }
  }

  /* Nenhum Java na maquina nao e mais beco sem saida: o bloco abaixo
     baixa. So desiste quando nem isso e possivel (navegador). */
  if ((!java || !java.path || java.path.startsWith('...')) &&
      !(temApi() && window.api.java.instalar)) {
    await avisar('escolha um Java em Ajustes › Jogo antes de tocar.');
    return;
  }
  if (java && java.path && java.path.startsWith('...')) java = null;
  /* ------------------------------------------------------------
     O Java certo, sem a pessoa precisar saber disso

     Fita velha nao roda em Java novo (o launchwrapper do Forge ate a
     1.12 faz um cast pra URLClassLoader que morreu no Java 9) e fita
     nova nao roda em Java velho. Antes o launcher so avisava e
     deixava a pessoa se virar.

     Agora: se ja existe um compativel instalado, troca calado — nao
     ha decisao a tomar, so a certa. Se nao existe, baixa.
     ------------------------------------------------------------ */
  const exigido = await window.api.java.exigido(state.version);
  const teto = await window.api.java.maximo(state.version);
  const serve = (j) => !!(j && j.maior && j.maior >= exigido && (!teto || j.maior <= teto));

  if (!serve(java)) {
    const outro = (CONFIG.javas || []).find(serve);

    if (outro) {
      state.java = outro.name; state.javaPath = outro.path;
      renderJava(); await aplicarLimitesDeMemoria();
      console.log('[java] a fita ' + state.version + ' pede outro Java: usando ' + outro.name);
    } else {
      const faixa = teto ? ('entre ' + exigido + ' e ' + teto) : (exigido + ' ou mais novo');
      mostrarProgresso(true);
      $('#progressLabel').textContent = 'PROCURANDO O JAVA';

      /* pintarProgresso e do download do jogo: ele calcula a barra a
         partir de bytes/arquivos e reescreve o rotulo com a versao.
         Aqui a conta ja vem pronta. */
      const solta = window.api.java.aoProgresso((d) => {
        const n = Math.max(0, Math.min(100, d.pct || 0));
        $('#progressLabel').textContent = d.fase.toUpperCase();
        $('#progressFill').style.width = n.toFixed(1) + '%';
        $('#progressPct').textContent = Math.round(n) + '%';
      });

      const r = await window.api.java.instalar(exigido, teto);
      solta && solta();

      if (!r || !r.ok) {
        mostrarProgresso(false);
        await avisar('essa fita precisa de Java ' + faixa + ', e eu não consegui baixar:\n' +
          ((r && r.erro) || 'erro desconhecido') +
          '\n\ninstale o Java ' + exigido + ' e escolha ele em Ajustes › Jogo.');
        return;
      }

      /* redetecta pra ele entrar na lista com versao e bits de
         verdade, em vez de eu inventar uma entrada na mao */
      await carregarJava();
      const novo = (CONFIG.javas || []).find((j) => j.path === r.caminho) ||
                   (CONFIG.javas || []).find(serve);
      if (novo) { state.java = novo.name; state.javaPath = novo.path; renderJava(); }
      await aplicarLimitesDeMemoria();
      mostrarProgresso(false);
    }
  }

  jogoAbrindo = true;
  erroDoJogo = null;
  mostrarProgresso(true);
  $('#progressLabel').textContent = 'CONFERINDO A FITA ' + state.version;
  logDoJogo.length = 0;

  /* conta Microsoft: renova o token antes de jogar (dura ~24h) */
  let sessao = null;
  if (!ehPirata(state.account) && window.api.auth) {
    if (contaMS && contaMS.nick === state.account && contaMS.expiraEm > Date.now() + 60000) sessao = contaMS;
    else {
      const rn = await window.api.auth.renovar(state.account);
      if (rn && rn.ok && rn.conta) { contaMS = rn.conta; sessao = rn.conta; }
    }
  }

  /* ---- Forge automatico ----
     fita vanilla escolhida: usa o Forge dela se ja existir, senao
     instala. Se nao houver Forge pra essa versao, segue no vanilla. */
  let versaoAlvo = state.version;
  await carregarVersoes();          /* o disco manda, nao o que carregou no boot */
  const escolhida = CONFIG.versions.find((v) => v.id === state.version);
  if (!escolhida || !escolhida.herda) {
    const jaInstalado = moddedDe[state.version];
    if (jaInstalado) {
      versaoAlvo = jaInstalado;
    } else if (window.api.mc.instalarForge) {
      $('#progressLabel').textContent = 'INSTALANDO O FORGE ' + state.version;
      const rf = await window.api.mc.instalarForge(state.version, state.dir || $('#dirInput').value);
      if (rf && rf.ok) {
        versaoAlvo = rf.id;
        await carregarVersoes();
      } else {
        /* sem Forge pra essa versao: avisa no console e segue vanilla */
        logDoJogo.push('[xyven] sem Forge para ' + state.version + ': ' + ((rf && rf.erro) || 'motivo desconhecido'));
        logDoJogo.push('[xyven] abrindo em vanilla.');
      }
    }
  }

  const r = await window.api.mc.lancar({
    versao: versaoAlvo,
    memoriaMb: state.mem,
    /* de novo, e nao o `java` do topo: se a checagem acima trocou ou
       baixou um Java, aquela referencia ficou velha e o jogo abriria
       justamente com o Java que a gente acabou de descartar */
    javaPath: ((javaEmUso() || java) || {}).path,
    gameDir: state.dir || $('#dirInput').value,
    argsJvm: jvmArgs,
    nick: sessao ? sessao.nick : state.account,
    uuid: sessao ? sessao.uuid : undefined,
    accessToken: sessao ? sessao.accessToken : undefined,
    userType: sessao ? 'msa' : undefined,
    servidor: servidor || undefined
  });

  if (!r || !r.ok) { falhaAoTocar((r && r.erro) || 'erro desconhecido'); return; }

  /* deu certo: some com a barra, marca o estado e respeita o "Fechar ao tocar" */
  jogoAbrindo = false;
  comecarSessao();
  marcarTocando(true);
  mostrarProgresso(false);
  const fechar = CONFIG.toggles.launcher.find((t) => t.key === 'close');
  /* fecha de verdade: o jogo foi iniciado destacado e segue de pé sozinho.
     ao reabrir, o launcher reencontra o processo pelo sessao.json. */
  if (fechar && fechar.on) window.api.window.close();
}

$('#playBtn').onclick = () => tocar(null);

$('#consoleBtn').onclick = () => { open($('#consoleOverlay')); pintarConsole(); };
$('#consoleLimpar').onclick = () => { logDoJogo.length = 0; pintarConsole(); };
$('#consoleCopiar').onclick = async () => {
  const ok = await copiar(logDoJogo.join('\n'));
  $('#consoleCopiar').textContent = ok ? 'COPIADO' : 'FALHOU';
  setTimeout(() => { $('#consoleCopiar').textContent = 'COPIAR'; }, 1400);
};


/* rede de seguranca: se algum evento se perder, o estado real do
   processo manda. evita o botao ficar preso em TOCANDO. */
if (temApi()) {
  setInterval(async () => {
    try {
      const rodando = await window.api.mc.rodando(state.dir);
      if (rodando !== jogoAberto) marcarTocando(rodando);
    } catch (e) { /* janela fechando */ }
  }, 1500);
}

$('#cancelBtn').onclick = () => {
  if (temApi()) window.api.mc.cancelar();
  jogoAbrindo = false;
  mostrarProgresso(false);
  $('#progressLabel').textContent = 'REBOBINANDO A FITA';
};

/* Java de verdade no lugar da lista de exemplo */
/* Forge e Fabric nao sao instalados pelo launcher: o instalador deles
   cria a pasta em versions/. Aqui a gente so lista o que ja existe. */
/* base -> versao modded instalada (ex.: '1.8.9' -> '1.8.9-forge...') */
const moddedDe = {};

/* a pasta do jogo tem que vir da maquina, nao do HTML: o valor fixo
   apontava pro usuario da maquina onde o app foi compilado. */
/* uma versao antiga chegou a salvar 'AppData\Roaming.minecraft', sem a
   barra. Recoloca o separador quando o caminho termina em .minecraft
   grudado no que vem antes. */
function consertarBarra(caminho) {
  const barra = String.fromCharCode(92);
  /* barra dobrada: dentro da classe, uma so escaparia a proxima */
  const m = new RegExp('^(.*[^' + barra + barra + '/])[.]minecraft$').exec(caminho || '');
  return m ? m[1] + barra + '.minecraft' : caminho;
}

async function pastaExiste(caminho) {
  if (!temApi() || !window.api.app || !window.api.app.pastaExiste) return true;
  try { return await window.api.app.pastaExiste(caminho); } catch (e) { return true; }
}

async function definirPastaJogo() {
  let salva = null;
  try { salva = localStorage.getItem('xyven.dir'); } catch (e) { /* sem storage */ }

  const padrao = (temApi() && window.api.app && window.api.app.pastaJogo)
    ? await window.api.app.pastaJogo().catch(() => null)
    : null;

  if (salva) {
    /* caminho salvo torto (ou de uma pasta que sumiu) nao pode mandar
       no launcher: conserta o que da, e o resto volta pro padrao. */
    const consertado = consertarBarra(salva);
    if (consertado !== salva && await pastaExiste(consertado)) salva = consertado;
    else if (!(await pastaExiste(salva))) salva = null;
  }
  if (!salva) salva = padrao;
  if (!salva) return;                 /* navegador: deixa em branco */
  state.dir = salva;
  $('#dirInput').value = salva;
  salvarPasta();                      /* regrava ja saneado */
  /* agora sim da pra procurar as prints: elas moram dentro deste caminho */
  atualizarPrints();
}

const salvarPasta = () => { try { localStorage.setItem('xyven.dir', state.dir || ''); } catch (e) { /* sem storage */ } };

/* ------------------------------------------------------------
   ARGUMENTOS DA JVM

   Texto cru, do jeito que a pessoa digitou. Quem separa em tokens e
   o processo principal, que e quem monta a linha de comando — fazer
   isso aqui so daria duas implementacoes pra divergir.
   ------------------------------------------------------------ */
let jvmArgs = '';
try { jvmArgs = localStorage.getItem('xyven.jvm') || ''; } catch (e) { jvmArgs = ''; }

const salvarJvm = () => {
  try { localStorage.setItem('xyven.jvm', jvmArgs); } catch (e) { /* sem storage */ }
};

function ligarCampoJvm() {
  const campo = $('#jvmInput'); if (!campo) return;
  campo.value = jvmArgs;
  /* 'input' e nao 'change': fechar o modal sem tirar o foco perdia o
     que a pessoa tinha acabado de escrever */
  campo.addEventListener('input', () => { jvmArgs = campo.value; salvarJvm(); });
  const limpar = $('#jvmReset');
  if (limpar) limpar.onclick = () => { jvmArgs = ''; campo.value = ''; salvarJvm(); };
}
ligarCampoJvm();

async function carregarVersoes() {
  if (!temApi() || !window.api.mc.instaladas) return;
  try {
    const raiz = state.dir || $('#dirInput').value;
    const inst = await window.api.mc.instaladas(raiz);
    /* zera antes: se a pasta foi apagada, o vinculo tem que sumir junto */
    Object.keys(moddedDe).forEach((k) => delete moddedDe[k]);
    inst.forEach((v) => {
      if (v.herda) {
        /* Forge/Fabric nao viram fita: sao detalhe de como a base abre.
           guarda so o vinculo base -> versao modded. */
        moddedDe[v.herda] = v.id;
        return;
      }
      if (CONFIG.versions.some((x) => x.id === v.id)) return;
      CONFIG.versions.push({ id: v.id, herda: null, note: 'instalada' });
    });
    renderVersions();
  } catch (e) { console.warn('não consegui listar as versões instaladas', e); }
}

async function carregarJava() {
  if (!temApi()) return;
  try {
    const achados = await window.api.java.detectar();
    if (!achados || !achados.length) return;
    const exigido = await window.api.java.exigido(state.version);
    CONFIG.javas = achados.map((j) => ({
      name: 'Java ' + j.maior,
      path: j.caminho,
      maior: j.maior,
      tag: j.maior === exigido ? 'INDICADO' : String(j.versao)
    }));
    const bom = CONFIG.javas.find((j) => j.maior === exigido) || CONFIG.javas[CONFIG.javas.length - 1];
    state.java = bom.name; state.javaPath = bom.path;
    renderJava(); renderStats(); await aplicarLimitesDeMemoria();
  } catch (e) { console.warn('não consegui detectar o Java', e); }
}

/* pasta do .minecraft */
$('#browseBtn').onclick = async () => {
  if (!temApi()) return;
  const r = await window.api.dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (r && !r.canceled && r.filePaths && r.filePaths[0]) {
    state.dir = r.filePaths[0];
    $('#dirInput').value = state.dir;
    salvarPasta();
    carregarVersoes();
  }
};

/* boot (renderNews fica no boot do fórum — depende dos posts) */
definirPastaJogo().then(async () => { await carregarVersoes(); retomarJogo(); });

/* O jogo pode estar aberto sem o launcher: "Fechar ao tocar" o encerra e
   deixa o Minecraft de pé. Ao voltar, em vez de mostrar TOCAR como se nada
   houvesse, reencontra o processo e volta a acompanhar o log dele. */
async function retomarJogo() {
  if (!temApi() || !window.api.mc.retomar || !state.dir) return;
  let sessao = null;
  try { sessao = await window.api.mc.retomar(state.dir); } catch (e) { return; }
  if (!sessao) return;                       /* o normal: nada rodando */

  /* a sessão guarda o que foi executado de fato, que numa fita com Forge é
     algo como "1.8.9-forge1.8.9-11.15.1.2318-1.8.9". Isso não é o nome da
     fita: o launcher esconde as versões herdadas e mostra a vanilla. Volta
     pelo índice moddedDe (vanilla -> forge) para exibir "1.8.9". */
  if (sessao.versao) {
    const fita = Object.keys(moddedDe).find((v) => moddedDe[v] === sessao.versao);
    state.version = fita || sessao.versao;
  }
  logDoJogo.length = 0;
  logDoJogo.push('[xyven] o Minecraft já estava aberto — retomando o log desta sessão.');
  marcarTocando(true);
  renderVersions(); renderStats();
}
restaurarToggles();
renderStats(); renderVersions(); renderJava(); renderToggles(); renderAccounts(); renderMemory();
sincronizarAutostart();
carregarJava();

/* Discord Rich Presence — inicia se o toggle estiver ligado */
if (temApi() && window.api.discord) {
  const rpcOn = CONFIG.toggles.discord.find(t => t.key === 'rpc')?.on;
  const rpcTapeOn = CONFIG.toggles.discord.find(t => t.key === 'rpcTape')?.on;
  if (rpcOn) {
    window.api.discord.ligar();
    window.api.discord.estado({ jogando: jogoAberto, versao: state.version, servidor: ondeEstou?.nome, mostrarFita: !!rpcTapeOn });
  }
}

/* ============================================================
   11. TEMA ESCURO
   ============================================================ */
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : '';
  try { localStorage.setItem('xyven.theme', dark ? 'dark' : 'light'); } catch (e) { /* sem storage */ }
}

(function restoreTheme() {
  let dark = false;
  try { dark = localStorage.getItem('xyven.theme') === 'dark'; } catch (e) { /* sem storage */ }
  CONFIG.toggles.launcher.find(t => t.key === 'theme').on = dark;
  applyTheme(dark);
})();

/* ============================================================
   12. EDITOR DE TEMA
   ============================================================ */
const editorPanel = document.getElementById('editorPanel');
const editorBody = document.getElementById('editorBody');
const openEditorBtn = document.getElementById('openEditor');
const closeEditorBtn = document.getElementById('closeEditor');
const editorSaveBtn = document.getElementById('editorSave');
const editorResetBtn = document.getElementById('editorReset');

const EDITOR = [
  { title: 'CORES', items: [
    { var: '--ink',       label: 'Contorno / texto', type: 'color' },
    { var: '--paper',     label: 'Papel (cards)',    type: 'color' },
    { var: '--sand',      label: 'Fundo da janela',  type: 'color' },
    { var: '--sand-dark', label: 'Rail / sidebar',   type: 'color' },
    { var: '--salmon',    label: 'Acento 1 (salmão)', type: 'color' },
    { var: '--mustard',   label: 'Acento 2 (mostarda)', type: 'color' },
    { var: '--teal',      label: 'Acento 3 (teal)',type: 'color' },
    { var: '--muted',     label: 'Texto secundário',  type: 'color' }
  ]},
  { title: 'FORMA', items: [
    { var: '--bw', label: 'Contorno',  type: 'range', min: 1, max: 6,  step: 1, unit: 'px' },
    { var: '--shadow', label: 'Sombra',    type: 'range', min: 0, max: 12, step: 1, unit: 'px' },
    { var: '--radius', label: 'Arredondado', type: 'range', min: 0, max: 16, step: 1, unit: 'px' }
  ]},
  { title: 'TIPOGRAFIA', items: [
    { var: '--font-display', label: 'Fonte dos títulos', type: 'select', options: [
      ["'Alfa Slab One',serif", 'Alfa Slab One'],
      ["'Space Mono',monospace", 'Space Mono'],
      ['Georgia,serif', 'Georgia'],
      ['Impact,sans-serif', 'Impact'],
      ['system-ui,sans-serif', 'Sistema']
    ], names: ['Alfa Slab One', 'Space Mono', 'Georgia', 'Impact', 'Sistema'] },
    { var: '--font-ui', label: 'Fonte da interface', type: 'select', options: [
      ["'Space Mono',monospace", 'Space Mono'],
      ["'Alfa Slab One',serif", 'Alfa Slab One'],
      ["Consolas,monospace", 'Consolas'],
      ['system-ui,sans-serif', 'Sistema']
    ], names: ['Space Mono', 'Alfa Slab One', 'Consolas', 'Sistema'] },
    { var: '--font-weight', label: 'Peso da fonte', type: 'range', min: 400, max: 900, step: 100, unit: '' },
    { var: '--h1',    label: 'Tamanho do título', type: 'range', min: 28, max: 72, step: 2, unit: 'px' },
    { var: '--scale', label: 'Tamanho geral',     type: 'range', min: 85, max: 130, step: 5, unit: '%' }
  ]},
  { title: 'IMAGENS', items: [
    { var: '--img-hero',      label: 'Print do hero',       type: 'url' },
    { var: '--img-version',   label: 'Print das versoes',   type: 'url' },
    { var: '--img-news-1',    label: 'Imagem Notícia 1',    type: 'url' },
    { var: '--img-news-2',    label: 'Imagem Notícia 2',    type: 'url' },
    { var: '--img-news-3',    label: 'Imagem Notícia 3',    type: 'url' }
  ]}
];

const EDITOR_DEFAULTS = {
  '--bw': '3', '--sh': '4', '--radius': '0', '--h1': '48', '--scale': '100',
  '--img-hero': '', '--img-version': '', '--img-news-1': '', '--img-news-2': '', '--img-news-3': ''
};

const root = document.documentElement;
const readVar = (name) => (getComputedStyle(root).getPropertyValue(name) || '').trim();

/* Aceita URL pronta (http, data, file) ou caminho local colado do explorador.
   Caminho do Windows precisa virar file:/// com barra normal: em url() a barra
   invertida é escape do CSS e comia o caminho inteiro (C:\Users -> C:Users). */
function toCssUrl(v) {
  const s = String(v || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  if (/^(https?:|data:|blob:|file:)/i.test(s)) return s;
  return 'file:///' + encodeURI(s.replace(/\\/g, '/').replace(/^\/+/, ''));
}

function applyVar(name, value) {
  if (name === '--sh' || name === '--shadow') {
    root.style.setProperty('--shadow', value + 'px ' + value + 'px 0 var(--ink)');
    root.style.setProperty('--shadow-lg', (value * 2) + 'px ' + (value * 2) + 'px 0 var(--ink)');
  } else if (name === '--bw' || name === '--h1') {
    root.style.setProperty(name, value + 'px');
  } else if (name === '--radius') {
    root.style.setProperty(name, value + 'px');
  } else if (name === '--scale') {
    root.style.fontSize = value + '%';
  } else if (name.startsWith('--img-')) {
    const u = toCssUrl(value);
    /* guarda já normalizado: renderNews/renderVersions leem daqui ao redesenhar */
    root.style.setProperty(name, u);
    if (name === '--img-hero' || name === '--img-version') {
      const sel = name === '--img-hero' ? '.polaroid__img' : '.version__img';
      document.querySelectorAll(sel).forEach(el => {
        el.style.backgroundImage = u ? 'url("' + u + '")' : '';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = u ? '' : (name === '--img-hero' ? 'PRINT DO JOGO' : 'PRINT');
      });
    }
  } else {
    root.style.setProperty(name, value);
  }
  edState[name] = value;
}

let edState = {};
try { edState = JSON.parse(localStorage.getItem('xyven.editor') || '{}'); } catch (e) { edState = {}; }

function renderEditor() {
  document.getElementById('editorBody').innerHTML = EDITOR.map(g => `
    <div class="ed__group">
      <span class="ed__title">${g.title}</span>
      ${g.items.map(it => {
        const cur = edState[it.var] ?? (EDITOR_DEFAULTS[it.var] ?? readVar(it.var));
        if (it.type === 'color')  return `<label class="ed__row"><span>${it.label}</span><small>${cur}</small><input type="color" value="${cur}" data-key="${it.var}"></label>`;
        if (it.type === 'range')  return `<label class="ed__row"><span>${it.label}</span><input type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${parseFloat(cur)}" data-key="${it.var}"><small>${parseFloat(cur)}${it.unit}</small></label>`;
        if (it.type === 'select') return `<label class="ed__row"><span>${it.label}</span><select data-key="${it.var}">${it.options.map((o, i) => `<option value="${o}"${o === cur ? ' selected' : ''}>${it.names[i]}</option>`).join('')}</select></label>`;
        return `<label class="ed__field"><span>${it.label}</span><input type="text" placeholder="cole um caminho ou URL" value="${cur}" data-key="${it.var}"></label>`;
      }).join('')}
    </div>`).join('');
}

function syncEditor() {
  document.querySelectorAll('#editorBody [data-key]').forEach(el => {
    const key = el.dataset.key;
    const field = EDITOR.find(g => g.items.some(it => it.var === key)).items.find(it => it.var === key);
    const cur = readVar(el.dataset.key);
    if (el.type === 'range') {
      el.value = cur || field.min || 0;
      const out = el.parentElement.querySelector('small');
      if (out) out.textContent = el.value + (field.unit || '');
    } else if (el.type === 'color') {
      el.value = cur || '#000000';
    } else if (el.tagName === 'SELECT') {
      el.value = cur || field.options[0];
    }
  });
}

function applyEditorChanges() {
  document.querySelectorAll('#editorBody [data-key]').forEach(el => {
    const key = el.dataset.key;
    const val = el.value;
    applyVar(key, val);
    if (el.type === 'range') {
      const out = el.parentElement.querySelector('small');
      if (out) out.textContent = val + (el.dataset.unit || '');
    }
  });
  renderEditorPreview();
}

function renderEditorPreview() {
  renderStats();
  renderNews();
  renderVersions();
  renderJava();
  renderToggles();
  renderAccounts();
  renderMemory();
}

function saveTheme() {
  const theme = {};
  document.querySelectorAll('#editorBody [data-key]').forEach(el => {
    theme[el.dataset.key] = el.value;
  });
  localStorage.setItem('xyven.customTheme', JSON.stringify(edState));
  applyTheme(JSON.parse(localStorage.getItem('xyven.theme')) === 'dark');
}

function resetTheme() {
  localStorage.removeItem('xyven.customTheme');
  Object.keys(edState).forEach(k => root.style.removeProperty(k));
  root.style.removeProperty('--shadow');
  root.style.removeProperty('--shadow-lg');
  root.style.fontSize = '';
  applyVar('--img-hero', '');
  applyVar('--img-version', '');
  edState = {};
  try { localStorage.removeItem('xyven.editor'); } catch (e) { /* sem storage */ }
  renderEditor();
  renderEditorPreview();
}

function openEditor() {
  if (!editorPanel.hidden) return;
  renderEditor();
  syncEditor();
  editorPanel.hidden = false;
}

function closeEditor() {
  editorPanel.hidden = true;
}

function initEditor() {
  // Open editor (only in dev or via Ctrl+Shift+E)
  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isDev) {
    openEditorBtn.hidden = false;
  }
  openEditorBtn.addEventListener('click', openEditor);
  closeEditorBtn.addEventListener('click', closeEditor);
  editorSaveBtn.addEventListener('click', saveTheme);
  editorResetBtn.addEventListener('click', resetTheme);

  // Real-time editor updates
  editorBody.addEventListener('input', (e) => {
    if (e.target.dataset.key) applyEditorChanges();
  });

  // Ctrl+Shift+E to toggle editor
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      editorPanel.hidden ? openEditor() : closeEditor();
    }
  });

  // Load custom theme on boot
  const saved = localStorage.getItem('xyven.customTheme');
  if (saved) {
    try {
      const theme = JSON.parse(saved);
      Object.entries(theme).forEach(([k, v]) => applyVar(k, v));
    } catch (e) { console.warn('Failed to load custom theme', e); }
  }
}

initEditor();

/* ============================================================
   10.b TELA DE NOVIDADES (fórum) — posts em localStorage
   ============================================================ */
const POST_TAGS = ['ATUALIZAÇÃO', 'COMUNIDADE', 'EVENTO', 'CORREÇÃO'];
const TAG_BG = { 'ATUALIZAÇÃO': 'var(--mustard)', 'COMUNIDADE': 'var(--salmon)', 'EVENTO': 'var(--teal)', 'CORREÇÃO': 'var(--sand-dark)' };

/* ------------------------------------------------------------
   As postagens moram no servidor, nao mais aqui.

   Antes eram localStorage: cada pessoa via o proprio mural, e o que
   um dev escrevia nao chegava em ninguem. O cache local continua,
   mas so como plano B — sem rede, mostra o que ja tinha visto em vez
   de uma tela vazia, que pareceria mural apagado.
   ------------------------------------------------------------ */
let posts = [];
try { posts = JSON.parse(localStorage.getItem('xyven.posts') || 'null') || []; }
catch (e) { posts = []; }
let postFilter = 'TODAS';
let editingId = null;

/* cache de leitura, nao fonte da verdade */
const savePosts = () => { try { localStorage.setItem('xyven.posts', JSON.stringify(posts)); } catch (e) { /* sem storage */ } };

/* Converte a linha do banco no formato que a tela ja usava. Traduzir
   num lugar so evitou reescrever renderFeed, renderNews e a leitura. */
function daLinha(r) {
  const d = new Date(r.criado_em);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    id: Number(r.id),
    tag: r.tag,
    pinned: !!r.fixado,
    featured: !!r.destaque,
    author: r.autor_nick,
    date: pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(),
    title: r.titulo,
    body: r.corpo || '',
    img: r.imagem || '',
    secoes: Array.isArray(r.secoes) ? r.secoes : []
  };
}

let buscandoPosts = false;
async function carregarPosts() {
  if (buscandoPosts) return;
  if (!temApi() || !window.api.xyven || !window.api.xyven.listarPosts) return;
  buscandoPosts = true;
  try {
    const r = await window.api.xyven.listarPosts();
    if (r && r.ok) {
      posts = (r.dados.posts || []).map(daLinha);
      savePosts();
      renderFeed(); renderNews();
    } else {
      /* fica com o cache: sem rede o mural nao deve parecer apagado */
      console.log('[xyven] mural: ' + ((r && r.erro) || 'sem resposta'));
    }
  } catch (e) {
    console.log('[xyven] mural falhou: ' + (e && e.message));
  } finally {
    buscandoPosts = false;
  }
}

/* Manda uma acao de escrita e recarrega. Recarregar em vez de mexer
   na lista local: o servidor e quem decide, e assim uma recusa nunca
   deixa a tela mostrando algo que nao aconteceu. */
async function acaoPost(corpo) {
  const token = await tokenAtual();
  if (!token || !window.api.xyven || !window.api.xyven.post) {
    await avisar('precisa de conta original logada — o mural fica no servidor.');
    return false;
  }
  const r = await window.api.xyven.post(token, corpo).catch(() => null);
  if (!r || !r.ok) {
    await avisar((r && r.erro) || 'não consegui falar com a API.');
    return false;
  }
  await carregarPosts();
  return true;
}
/* declaracao de funcao (nao const): e usada bem antes deste ponto,
   no boot, e function e hoisted */
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderFilters() {
  const all = ['TODAS'].concat(POST_TAGS);
  $('#postFilters').innerHTML = all.map(t =>
    `<button class="chip ${t === postFilter ? 'is-active' : ''}" data-filter="${t}">${t}</button>`).join('');
}

function renderFeed() {
  const list = posts
    .filter(p => postFilter === 'TODAS' || p.tag === postFilter)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  if (!list.length) {
    $('#feed').innerHTML = '<div class="empty">nenhuma postagem por aqui ainda.</div>';
    return;
  }

  $('#feed').innerHTML = list.map(p => `
    <article class="post ${p.pinned ? 'is-pinned' : ''}">
      <div class="post__side">
        <span class="avatar" style="width:38px;height:38px;font-size:17px;border-width:3px" data-skin="${esc(p.author)}">${esc(p.author[0])}</span>
        ${p.pinned ? '<span class="post__pin" title="Fixado">FIXADO</span>' : ''}
      </div>
      <div class="post__main">
        <div class="post__top">
          <span class="tag" style="background:${TAG_BG[p.tag] || 'var(--sand)'}">${esc(p.tag)}</span>
          <span class="post__meta">${esc(p.author)} · ${esc(p.date)}</span>
        </div>
        <h3 class="post__title" data-open-post="${p.id}">${esc(p.title)}</h3>
        <p class="post__body post__body--clamp selectable">${esc(semMarcacao(p.body)).replace(/\n/g, '<br>')}</p>
        <div class="post__actions">
          <button class="link-btn" data-open-post="${p.id}">ler tudo</button>
          <button class="link-btn perm perm--escrever" data-edit="${p.id}">editar</button>
          <button class="link-btn perm perm--fixar" data-pin="${p.id}">${p.pinned ? 'desafixar' : 'fixar'}</button>
          <button class="link-btn perm perm--fixar" data-home="${p.id}">${p.featured ? 'tirar do início' : 'mostrar no início'}</button>
          <button class="link-btn link-btn--danger perm perm--apagar" data-del="${p.id}">apagar</button>
        </div>
      </div>
    </article>`).join('');
}

$('#postFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  postFilter = b.dataset.filter; renderFilters(); renderFeed();
});

$('#feed').addEventListener('click', (e) => {
  const rd = e.target.closest('[data-open-post]');
  if (rd) return openPost(Number(rd.dataset.openPost));
  const ed = e.target.closest('[data-edit]'), pin = e.target.closest('[data-pin]'), del = e.target.closest('[data-del]'), home = e.target.closest('[data-home]');
  if (ed) return openPostEditor(Number(ed.dataset.edit));
  if (pin) {
    const p = posts.find(x => x.id === Number(pin.dataset.pin));
    if (p) acaoPost({ acao: 'fixar', id: p.id, fixado: !p.pinned });
  }
  if (home) {
    const p = posts.find(x => x.id === Number(home.dataset.home));
    if (p) acaoPost({ acao: 'destaque', id: p.id, destaque: !p.featured });
  }
  if (del) {
    const id = Number(del.dataset.del);
    const p = posts.find(x => x.id === id);
    /* apagar e o unico sem volta, e agora vale pra todo mundo */
    if (p) {
      /* o ouvinte do feed nao e async: encadeia em vez de esperar */
      perguntar('apagar "' + p.title + '"? isso vale pra todo mundo.', 'Apagar postagem')
        .then((sim) => { if (sim) acaoPost({ acao: 'apagar', id }); });
    }
  }
});

/* cards da home abrem a postagem completa */
$('#newsGrid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-open-post]');
  if (c) openPost(Number(c.dataset.openPost));
});

/* VER TUDO da home leva pro lado b */
$('#seeAllNews').onclick = (e) => {
  e.preventDefault();
  $$('.rail__btn').forEach(x => x.classList.remove('is-active'));
  $('.rail__btn[data-nav="news"]').classList.add('is-active');
  showScreen('news');
};

/* ------------------------------------------------------------
   SEÇÕES

   Bloco de icone + titulo + texto. A mesma funcao serve a leitura da
   postagem e ao modal do /update: fossem duas, uma ia divergir da
   outra no primeiro ajuste.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   TEXTO FORMATADO

     # titulo        maior
     ## titulo       maior ainda
     ### titulo      o maior
     &c vermelho     as mesmas cores do /title

   A marca de tamanho vale pra LINHA, e a de cor pra qualquer pedaco
   dela. Reusa o pintarMinecraft: inventar uma segunda sintaxe de cor
   so criaria duas coisas pra lembrar.
   ------------------------------------------------------------ */
function formatarTexto(txt) {
  return String(txt || '').split('\n').map((linha) => {
    const m = /^(#{1,3})\s*(.*)$/.exec(linha);
    const classe = m ? ' t' + m[1].length : '';
    /* pintarMinecraft ja escapa cada caractere: nada do que a pessoa
       escreve chega aqui como HTML */
    const dentro = pintarMinecraft(m ? m[2] : linha);
    return '<div class="lin' + classe + '">' + dentro + '</div>';
  }).join('');
}

/* Sem marca nenhuma, pro cartao do feed: la o texto e cortado em duas
   linhas, e `### &eTITULO` cru apareceria no meio da previa. */
function semMarcacao(txt) {
  return String(txt || '')
    .replace(/^#{1,3}\s*/gm, '')
    .replace(/[&\u00a7]([0-9a-fk-or])/gi, '');
}

function htmlDasSecoes(secoes) {
  if (!Array.isArray(secoes) || !secoes.length) return '';
  return secoes.map((sc) => {
    const ic = sc.icone
      ? '<span class="sec__ic" style="background-image:url(\'' + esc(sc.icone) + '\')"></span>'
      : '<span class="sec__ic"></span>';
    return '<div class="sec">' + ic +
      '<div><h4 class="sec__tit">' + esc(sc.titulo || '') + '</h4>' +
      '<div class="sec__txt">' + formatarTexto(sc.texto || '') + '</div></div></div>';
  }).join('');
}

/* leitura da postagem completa */
let readingId = null;
function openPost(id) {
  const p = posts.find(x => x.id === id); if (!p) return;
  readingId = id;
  $('#readTag').textContent = p.tag;
  $('#readTag').style.background = TAG_BG[p.tag] || 'var(--sand)';
  $('#readPin').hidden = !p.pinned;
  $('#readMeta').textContent = p.author + ' · ' + p.date;
  setAvatar($('#readAvatar'), p.author);
  const ri = $('#readImg');
  ri.hidden = !p.img;
  /* limpa o src quando nao ha foto: sem isto o <img> guarda a da
     postagem anterior e pisca com ela ao abrir a proxima */
  ri.src = p.img || '';
  $('#readSecs').className = 'secs mc-claro';
  $('#readSecs').innerHTML = htmlDasSecoes(p.secoes);
  $('#readTitle').textContent = p.title;
  /* mc-claro: o modal de leitura e papel, e as cores palidas do
     Minecraft precisam escurecer pra continuarem legiveis */
  $('#readBody').className = 'read__body selectable mc-claro';
  $('#readBody').innerHTML = formatarTexto(p.body);
  open($('#readOverlay'));
}
$('#readEdit').onclick = () => { close($('#readOverlay')); openPostEditor(readingId); };

/* modal de escrever / editar */
function openPostEditor(id) {
  editingId = id ?? null;
  const p = id ? posts.find(x => x.id === id) : null;
  $('#postModalTitle').textContent = p ? 'Editar postagem' : 'Nova postagem';
  $('#postTitle').value = p ? p.title : '';
  $('#postBody').value = p ? p.body : '';
  $('#postTag').innerHTML = POST_TAGS.map(t => `<option ${p && p.tag === t ? 'selected' : ''}>${t}</option>`).join('');
  $('#postPin').checked = p ? !!p.pinned : false;
  $('#postImg').value = p ? (p.img || '') : '';
  const cx = $('#secEditor');
  cx.innerHTML = '';
  ((p && p.secoes) || []).forEach((sc) => cx.appendChild(linhaDeSecao(sc)));
  previewImg();
  open($('#postOverlay'));
  setTimeout(() => $('#postTitle').focus(), 30);
}

/* ------------------------------------------------------------
   IMAGEM DA POSTAGEM

   Aceita link colado ou arquivo. O arquivo sobe pro Storage do
   Supabase e vira link: guardar os bytes na linha do banco deixaria
   toda leitura do mural lenta pra carregar algo que a lista nem usa.
   ------------------------------------------------------------ */
/* 1400x600 = 7:3, a proporcao da moldura do card e desta previa.
   Fora dessa proporcao o `cover` corta as bordas — nao importa se a
   foto e maior ou menor, so a proporcao conta. */
const MEDIDA_IMG = '1400 x 600';

function previewImg() {
  const url = $('#postImg').value.trim();
  const prev = $('#postImgPrev');
  /* a caixa nao some mais: sem foto ela vira o aviso da medida, que e
     onde a pessoa vai olhar antes de escolher o arquivo */
  prev.hidden = false;
  prev.classList.toggle('postimg--vazio', !url);
  prev.style.backgroundImage = url ? "url('" + url + "')" : '';
  prev.innerHTML = url ? '' :
    '<b>' + MEDIDA_IMG + '</b><span>ou qualquer foto em 7:3 &mdash; fora dessa proporcao as bordas somem</span>' +
    '<span>png, jpg, gif ou webp &middot; ate 2 MB</span>';
}

$('#postImg').addEventListener('input', previewImg);
$('#postImgClear').onclick = () => { $('#postImg').value = ''; previewImg(); };
$('#postImgPick').onclick = () => $('#postImgFile').click();

$('#postImgFile').addEventListener('change', async (e) => {
  const arq = e.target.files && e.target.files[0];
  /* zera o input: escolher o MESMO arquivo de novo nao dispara
     'change' se o valor continuar o mesmo */
  e.target.value = '';
  if (!arq) return;

  const botao = $('#postImgPick');
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'ENVIANDO...';

  try {
    const b64 = await new Promise((ok, falhou) => {
      const fr = new FileReader();
      /* o resultado vem como data:...;base64,XXXX — o servidor quer so o XXXX */
      fr.onload = () => ok(String(fr.result).split(',')[1] || '');
      fr.onerror = () => falhou(new Error('não consegui ler o arquivo.'));
      fr.readAsDataURL(arq);
    });

    const token = await tokenAtual();
    if (!token || !window.api.xyven || !window.api.xyven.post) {
      await avisar('precisa de conta original logada pra enviar imagem.');
      return;
    }
    const r = await window.api.xyven.post(token, { acao: 'imagem', nome: arq.name, dados: b64 })
      .catch(() => null);
    if (!r || !r.ok) {
      await avisar((r && r.erro) || 'não consegui enviar a imagem.');
      return;
    }
    $('#postImg').value = r.dados.url;
    previewImg();
  } catch (err) {
    await avisar((err && err.message) || 'não consegui enviar a imagem.');
  } finally {
    botao.disabled = false; botao.textContent = rotulo;
  }
});

/* ------------------------------------------------------------
   editor de secoes

   O estado vive no DOM, e nao num array a parte: com array eu teria
   que sincronizar os dois a cada tecla, e e exatamente ai que some
   texto sem ninguem entender por que.
   ------------------------------------------------------------ */
function linhaDeSecao(sc) {
  const d = document.createElement('div');
  d.className = 'secrow';
  d.innerHTML =
    '<div class="secrow__top">' +
      '<input class="input sec-in-ic" placeholder="link do ícone (opcional)" spellcheck="false">' +
      '<button type="button" class="btn sec-pick" style="padding:0 14px">ÍCONE</button>' +
      '<button type="button" class="btn sec-del" style="padding:0 14px">TIRAR</button>' +
    '</div>' +
    '<input class="input sec-in-tit" placeholder="TÍTULO DA SEÇÃO" maxlength="60">' +
    '<textarea class="input sec-in-txt" placeholder="o que mudou, em duas ou três linhas."></textarea>';
  if (sc) {
    d.querySelector('.sec-in-ic').value = sc.icone || '';
    d.querySelector('.sec-in-tit').value = sc.titulo || '';
    d.querySelector('.sec-in-txt').value = sc.texto || '';
  }
  return d;
}

function lerSecoes() {
  return [...$('#secEditor').querySelectorAll('.secrow')].map((r) => ({
    icone: r.querySelector('.sec-in-ic').value.trim(),
    titulo: r.querySelector('.sec-in-tit').value.trim(),
    texto: r.querySelector('.sec-in-txt').value.trim()
  })).filter((x) => x.titulo || x.texto);
}

$('#secAdd').onclick = () => {
  $('#secEditor').appendChild(linhaDeSecao(null));
};

$('#secEditor').addEventListener('click', async (e) => {
  const linha = e.target.closest('.secrow');
  if (!linha) return;

  if (e.target.closest('.sec-del')) { linha.remove(); return; }
  if (!e.target.closest('.sec-pick')) return;

  /* o mesmo upload da imagem da postagem, so que pro icone */
  const arq = await escolherArquivo();
  if (!arq) return;
  const botao = e.target.closest('.sec-pick');
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = '...';
  const url = await enviarImagemPost(arq);
  botao.disabled = false; botao.textContent = rotulo;
  if (url) linha.querySelector('.sec-in-ic').value = url;
});

/* abre o seletor de arquivo e devolve o que a pessoa escolheu */
function escolherArquivo() {
  return new Promise((ok) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/gif,image/webp';
    inp.onchange = () => ok(inp.files && inp.files[0]);
    inp.click();
  });
}

async function enviarImagemPost(arq) {
  try {
    const b64 = await new Promise((ok, falhou) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1] || '');
      fr.onerror = () => falhou(new Error('não consegui ler o arquivo.'));
      fr.readAsDataURL(arq);
    });
    const token = await tokenAtual();
    if (!token || !window.api.xyven) {
      await avisar('precisa de conta original logada pra enviar imagem.');
      return '';
    }
    const r = await window.api.xyven.post(token, { acao: 'imagem', nome: arq.name, dados: b64 })
      .catch(() => null);
    if (!r || !r.ok) { await avisar((r && r.erro) || 'não consegui enviar a imagem.'); return ''; }
    return r.dados.url;
  } catch (err) {
    await avisar((err && err.message) || 'não consegui enviar a imagem.');
    return '';
  }
}

/* ------------------------------------------------------------
   PREVIEW da postagem

   Mostra o que o /update joga na tela de todo mundo, montado do que
   esta no formulario AGORA — sem salvar e sem ir ao servidor.

   Nao passa pelo mostrarAviso de proposito: aquele grava em
   localStorage que o aviso foi visto, e um preview marcando recado
   como lido faria a pessoa perder o proximo de verdade. */
function previewPostagem() {
  const titulo = $('#postTitle').value.trim() || '(sem título)';
  const corpo = $('#postBody').value.trim();
  const img = $('#postImg').value.trim();
  const secoes = lerSecoes();

  $('#avisoTitulo').innerHTML = pintarMinecraft(titulo);
  $('#avisoTexto').innerHTML = '';

  const caixa = $('#avisoPost');
  const banner = img ? '<img class="aviso__banner" src="' + esc(img) + '" alt="">' : '';
  const texto = corpo
    ? '<div class="sec__txt" style="margin-bottom:4px">' + formatarTexto(corpo) + '</div>'
    : '';
  caixa.innerHTML = banner + texto + htmlDasSecoes(secoes);
  caixa.hidden = !(banner || texto || secoes.length);

  /* fecha e pronto: nada de marcar como visto */
  $('#avisoFechar').onclick = () => close($('#avisoOverlay'));
  open($('#avisoOverlay'));
}

$('#postPreview').onclick = previewPostagem;

$('#newPostBtn').onclick = () => openPostEditor(null);

$('#postSave').onclick = async () => {
  const title = $('#postTitle').value.trim();
  const body = $('#postBody').value.trim();
  if (!title) { $('#postTitle').focus(); return; }

  const botao = $('#postSave');
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'ENVIANDO...';

  const ok = await acaoPost({
    acao: editingId ? 'editar' : 'criar',
    id: editingId || undefined,
    titulo: title,
    corpo: body,
    tag: $('#postTag').value,
    fixado: $('#postPin').checked,
    imagem: $('#postImg').value.trim(),
    secoes: lerSecoes()
  });

  botao.disabled = false; botao.textContent = rotulo;
  /* fecha so quando deu certo: recusar com o modal fechado faria o
     texto escrito sumir junto */
  if (ok) close($('#postOverlay'));
};

/* ============================================================
   10.c LOJA DE COSMÉTICOS

   Card com a imagem EM CIMA e o texto embaixo — ao contrario do
   mural, onde a foto vem depois do texto.

   TOTAL nao e categoria: e o filtro "tudo", como o TODAS do mural.
   Nao tem linha no banco, entao ninguem apaga sem querer.
   ============================================================ */
let lojaFiltro = 'TOTAL';
let itemEditando = null;

/* Recorte da frente da textura de capa (10x16 a partir de 1,1 numa
   folha 64x32). O mesmo calculo do editor de skin — a textura crua
   mostrada inteira nao parece capa nenhuma. */
function arteDeCapa(url, escala) {
  const e = escala || 6;
  return 'background-image:url(' + url + ');' +
    'background-size:' + (64 * e) + 'px ' + (32 * e) + 'px;' +
    'background-position:' + (-1 * e) + 'px ' + (-1 * e) + 'px;' +
    'width:' + (10 * e) + 'px;height:' + (16 * e) + 'px';
}

function renderFiltrosLoja() {
  const alvos = ['TOTAL'].concat(CATEGORIAS.map((c) => c.nome));
  const el = $('#lojaFiltros');
  if (!el) return;
  el.innerHTML = alvos.map((t) =>
    '<button class="chip ' + (t === lojaFiltro ? 'is-active' : '') +
    '" data-loja-filtro="' + esc(t) + '">' + esc(t) + '</button>').join('');
}

function renderLoja() {
  renderFiltrosLoja();
  const grade = $('#lojaGrade');
  if (!grade) return;

  /* Servidor fora: fala, e nao finge. O que aparece abaixo sao as
     quatro capas que vem dentro do launcher — elas existem de
     verdade, mas nao da pra criar nem editar nada sem o servidor. */
  if (lojaFora) {
    grade.innerHTML = '<div class="empty" style="grid-column:1/-1">' +
      'a loja não respondeu: ' + esc(lojaFora) + '<br><br>' +
      'abaixo estão só as capas que vêm dentro do launcher. ' +
      'criar e editar precisam do servidor.</div>';
  } else {
    grade.innerHTML = '';
  }

  const cat = CATEGORIAS.find((c) => c.nome === lojaFiltro);
  const lista = COSMETICOS.filter((c) => lojaFiltro === 'TOTAL' || (cat && c.categoria === cat.id));

  if (!lista.length) {
    grade.innerHTML += '<div class="empty" style="grid-column:1/-1">' +
      (lojaFiltro === 'TOTAL' ? 'nenhum item ainda.' : 'nada em ' + esc(lojaFiltro) + '.') +
      '</div>';
    return;
  }

  const meus = capasDisponiveis().map((c) => c.id);

  grade.innerHTML += lista.map((c) => {
    const url = urlDoItem(c);
    let arte;
    if (!url) {
      arte = '<span class="ph" style="width:100%;height:100%">SEM IMAGEM</span>';
    } else if (ehCapa(c)) {
      arte = '<span class="item__tex" style="' + arteDeCapa(url, 6) + '"></span>';
    } else {
      /* categoria que nao e capa: a imagem e arte, mostrada inteira */
      arte = '<span style="width:100%;height:100%;background:url(' + esc(url) +
             ') center/contain no-repeat"></span>';
    }
    const tem = meus.includes(c.id) ? '<span class="item__tem">VOCÊ TEM</span>' : '';
    return '<div class="item">' +
      '<div class="item__art">' + arte + '</div>' +
      '<div class="item__corpo">' +
        '<span class="item__nome">' + esc(c.nome) + '</span>' +
        '<p class="item__desc">' + esc(c.descricao || '') + '</p>' +
        '<div class="item__pe">' +
          '<button class="link-btn" data-prev="' + esc(c.id) + '">preview</button>' +
          '<button class="link-btn perm perm--loja" data-item-edit="' + esc(c.id) + '">editar</button>' +
          '<button class="link-btn link-btn--danger perm perm--loja" data-item-del="' + esc(c.id) + '">apagar</button>' +
          tem +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

$('#lojaFiltros').addEventListener('click', (e) => {
  const b = e.target.closest('[data-loja-filtro]');
  if (!b) return;
  lojaFiltro = b.dataset.lojaFiltro;
  renderLoja();
});

/* ------------------------------------------------------------
   preview: veste na SUA skin

   So capa da pra vestir — o skinview3d renderiza skin e capa, e mais
   nada. Pras outras categorias a arte aparece ao lado, com o aviso de
   que ali e ilustracao e nao o item no corpo.
   ------------------------------------------------------------ */
let visorPreview = null;

function abrirPreview(id) {
  const c = COSMETICOS.find((x) => x.id === id);
  if (!c) return;
  const url = urlDoItem(c);

  $('#previewTitulo').textContent = c.nome;
  $('#prevDesc').textContent = c.descricao || 'sem descrição.';

  const arte = $('#prevArte');
  arte.hidden = ehCapa(c) || !url;
  arte.style.backgroundImage = (!ehCapa(c) && url) ? "url('" + url + "')" : '';

  $('#prevNota').textContent = ehCapa(c)
    ? 'arraste pra girar · roda do mouse aproxima'
    : 'este tipo de item não é desenhado no corpo — o mod do jogo é que mostra.';

  open($('#previewOverlay'));

  /* o visor so nasce quando o modal ja tem tamanho: criado escondido,
     ele mediria zero e a camera ficaria fora de enquadramento */
  setTimeout(() => {
    visorPreview = visorPreview || criarVisor($('#prevBody'));
    if (!visorPreview) return;
    vestir(visorPreview, SKIN_TEX(profile.skin), ehCapa(c) ? url : '', null);
  }, 40);
}

/* ------------------------------------------------------------
   editor de item
   ------------------------------------------------------------ */
/* A medida MUDA com a categoria, e por isso nao dá pra copiar o aviso
   da postagem: la e 1400x600 porque o card e 7:3. Capa e outra coisa —
   e a textura do Minecraft, 64x32, e o launcher recorta a frente dela
   pra fazer o card e veste ela no boneco. */
function previewItemImg() {
  const url = $('#itemImg').value.trim();
  const prev = $('#itemImgPrev');
  const capa = $('#itemCat').value === 'capas';

  prev.hidden = false;
  prev.classList.toggle('postimg--vazio', !url);
  prev.style.backgroundImage = url ? "url('" + url + "')" : '';

  if (url) {
    prev.innerHTML = '';
    /* capa: mostra o recorte da frente, que e o que vai virar o card */
    prev.classList.toggle('postimg--capa', capa);
    prev.style.cssText = capa
      ? arteDeCapa(url, 5) + ';border:2px solid var(--ink);margin:0 auto'
      : "background-image:url('" + url + "')";
    return;
  }

  prev.classList.remove('postimg--capa');
  prev.style.cssText = '';
  prev.innerHTML = capa
    ? '<b>64 x 32</b>' +
      '<span>a textura de capa do Minecraft, do mesmo jeito que o jogo usa</span>' +
      '<span>o launcher recorta a frente pro card e veste ela no boneco</span>'
    : '<b>quadrada</b>' +
      '<span>o card é quadrado e mostra a imagem inteira, sem cortar</span>' +
      '<span>png, jpg, gif ou webp &middot; até 2 MB</span>';
}

function abrirEditorItem(id) {
  itemEditando = id || null;
  const c = id ? COSMETICOS.find((x) => x.id === id) : null;

  $('#itemModalTitulo').textContent = c ? 'Editar item' : 'Novo item';
  $('#itemId').value = c ? c.id : '';
  $('#itemId').disabled = !!c;      /* id e chave: mudar seria outro item */
  $('#itemNome').value = c ? c.nome : '';
  $('#itemDesc').value = c ? (c.descricao || '') : '';
  $('#itemImg').value = c ? (c.imagem || '') : '';
  $('#itemCat').innerHTML = CATEGORIAS.map((x) =>
    '<option value="' + esc(x.id) + '"' +
    (c && c.categoria === x.id ? ' selected' : '') + '>' + esc(x.nome) + '</option>').join('');
  previewItemImg();
  open($('#itemOverlay'));
  setTimeout(() => { if (!c) $('#itemId').focus(); }, 30);
}

$('#itemImg').addEventListener('input', previewItemImg);
/* trocar a categoria troca a medida pedida */
$('#itemCat').addEventListener('change', previewItemImg);
$('#itemImgClear').onclick = () => { $('#itemImg').value = ''; previewItemImg(); };
$('#itemImgPick').onclick = () => $('#itemImgFile').click();

$('#itemImgFile').addEventListener('change', async (e) => {
  const arq = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!arq) return;

  const botao = $('#itemImgPick');
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'ENVIANDO...';
  try {
    const b64 = await new Promise((ok, falhou) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1] || '');
      fr.onerror = () => falhou(new Error('não consegui ler o arquivo.'));
      fr.readAsDataURL(arq);
    });
    const token = await tokenAtual();
    if (!token || !window.api.xyven) {
      await avisar('precisa de conta original logada pra enviar imagem.');
      return;
    }
    const r = await window.api.xyven.loja(token, { acao: 'imagem', nome: arq.name, dados: b64 })
      .catch(() => null);
    if (!r || !r.ok) { await avisar((r && r.erro) || 'não consegui enviar a imagem.'); return; }
    $('#itemImg').value = r.dados.url;
    previewItemImg();
  } catch (err) {
    await avisar((err && err.message) || 'não consegui enviar a imagem.');
  } finally {
    botao.disabled = false; botao.textContent = rotulo;
  }
});

$('#novoItemBtn').onclick = () => abrirEditorItem(null);

/* ------------------------------------------------------------
   categorias

   TOTAL nao entra aqui: e o filtro "tudo", nao tem linha no banco.
   ------------------------------------------------------------ */
$('#novaCatBtn').onclick = () => {
  $('#catId').value = '';
  $('#catNome').value = '';
  open($('#catOverlay'));
  setTimeout(() => $('#catId').focus(), 30);
};

$('#catSalvar').onclick = async () => {
  const id = $('#catId').value.trim().toLowerCase();
  if (!id) { $('#catId').focus(); return; }

  const token = await tokenAtual();
  if (!token || !window.api.xyven) {
    return avisar('precisa de conta original logada — a loja fica no servidor.');
  }

  const botao = $('#catSalvar');
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'ENVIANDO...';

  const r = await window.api.xyven.loja(token, {
    acao: 'categoria', modo: 'criar', id,
    nome: $('#catNome').value.trim() || id.toUpperCase()
  }).catch(() => null);

  botao.disabled = false; botao.textContent = rotulo;
  if (!r || !r.ok) return avisar((r && r.erro) || 'não consegui falar com a API.');

  close($('#catOverlay'));
  lojaFiltro = (r.dados.categoria && r.dados.categoria.nome) || lojaFiltro;
  await carregarLoja();
};

$('#apagarCatBtn').onclick = async () => {
  const cat = CATEGORIAS.find((c) => c.nome === lojaFiltro);
  if (!cat) return avisar('escolha uma categoria antes. TOTAL não é categoria.');

  if (!await perguntar('apagar a categoria "' + cat.nome + '"?', 'Apagar categoria')) return;

  const token = await tokenAtual();
  if (!token || !window.api.xyven) {
    return avisar('precisa de conta original logada — a loja fica no servidor.');
  }
  const r = await window.api.xyven.loja(token, { acao: 'categoria', modo: 'apagar', id: cat.id })
    .catch(() => null);
  if (!r || !r.ok) return avisar((r && r.erro) || 'não consegui falar com a API.');

  lojaFiltro = 'TOTAL';
  await carregarLoja();
};

$('#itemSalvar').onclick = async () => {
  const id = $('#itemId').value.trim().toLowerCase();
  if (!id) { $('#itemId').focus(); return; }

  const token = await tokenAtual();
  if (!token || !window.api.xyven) {
    return avisar('precisa de conta original logada — a loja fica no servidor.');
  }

  const botao = $('#itemSalvar');
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'ENVIANDO...';

  const r = await window.api.xyven.loja(token, {
    acao: 'cosmetico',
    modo: itemEditando ? 'editar' : 'criar',
    id,
    nome: $('#itemNome').value.trim() || id.toUpperCase(),
    descricao: $('#itemDesc').value.trim(),
    categoria: $('#itemCat').value,
    imagem: $('#itemImg').value.trim()
  }).catch(() => null);

  botao.disabled = false; botao.textContent = rotulo;
  if (!r || !r.ok) return avisar((r && r.erro) || 'não consegui falar com a API.');

  close($('#itemOverlay'));
  await carregarLoja();
};

$('#lojaGrade').addEventListener('click', async (e) => {
  const pv = e.target.closest('[data-prev]');
  if (pv) return abrirPreview(pv.dataset.prev);

  const ed = e.target.closest('[data-item-edit]');
  if (ed) return abrirEditorItem(ed.dataset.itemEdit);

  const del = e.target.closest('[data-item-del]');
  if (!del) return;
  const id = del.dataset.itemDel;
  const c = COSMETICOS.find((x) => x.id === id);
  if (!await perguntar('apagar "' + (c ? c.nome : id) + '"? quem tem perde na hora.',
                       'Apagar item')) return;

  const token = await tokenAtual();
  if (!token || !window.api.xyven) {
    return avisar('precisa de conta original logada — a loja fica no servidor.');
  }
  const r = await window.api.xyven.loja(token, { acao: 'cosmetico', modo: 'apagar', id })
    .catch(() => null);
  if (!r || !r.ok) return avisar((r && r.erro) || 'não consegui falar com a API.');
  await carregarLoja();
  sincronizarConta();
});

/* boot do forum
paintSkins();
renderFilters(); renderFeed(); renderNews();
carregarPosts();

/* Alguem escreveu, fixou ou apagou: chega na hora, sem reabrir. */
if (temApi() && window.api.xyven && window.api.xyven.aoMudarPosts) {
  window.api.xyven.aoMudarPosts(() => {
    /* o mesmo canal traz mudanca de cargo: os dois sao publicos e
       valem pra todo mundo, entao nao vale abrir um segundo socket */
    console.log('[xyven] mural ou cargos mudaram; recarregando');
    carregarPosts();
    carregarCargos();
    carregarLoja();
  });
}

/* ============================================================
   10.c TELA DE PERFIL — skin 3D, horas e servidores
   ============================================================ */
/* ------------------------------------------------------------
   CARGOS

   Deixaram de ser lista fixa no codigo: agora sao linhas da tabela
   `cargos`, criadas pelo /cargo create. Um cargo carrega o nome, a
   cor da etiqueta e as permissoes — nao ha mais grupo separado. Se a
   pessoa tem o cargo, tem a etiqueta; se tem a etiqueta, tem o que o
   cargo carrega.

   A cor e um TOKEN do tema, nunca hex: o modo escuro troca os tokens,
   e cor fixa no banco ficaria ilegivel quando o tema virasse.
   ------------------------------------------------------------ */
const CORES_CARGO = {
  teal:    { bg: 'var(--teal)',      fg: '#f4e7ca' },
  salmon:  { bg: 'var(--salmon)',    fg: 'var(--on-accent,#33261c)' },
  mustard: { bg: 'var(--mustard)',   fg: 'var(--on-accent,#33261c)' },
  sand:    { bg: 'var(--sand-dark)', fg: 'var(--ink)' },
  ink:     { bg: 'var(--ink)',       fg: 'var(--paper)' },
  /* Estas tres ja existiam no tema e nenhum cargo usava. Sao as
     ultimas: passar daqui exige token novo no :root, e cor nova e
     decisao de quem faz o design, nao minha. */
  red:     { bg: 'var(--red)',       fg: 'var(--paper)' },
  muted:   { bg: 'var(--muted)',     fg: 'var(--paper)' },
  paper:   { bg: 'var(--paper)',     fg: 'var(--ink)' }
};

/* Os cinco que sempre existiram. Servem de plano B enquanto a
   resposta do servidor nao chega e quando nao ha rede — sem isto o
   perfil abriria sem etiqueta nenhuma e pareceria que a pessoa
   perdeu os cargos. */
let ALL_BADGES = [
  { id: 'dev',      label: 'DEV',      cor: 'teal',    permissoes: ['*'] },
  { id: 'fundador', label: 'FUNDADOR', cor: 'salmon',  permissoes: [] },
  { id: 'pro',      label: 'PRO',      cor: 'mustard', permissoes: [] },
  { id: 'beta',     label: 'BETA',     cor: 'sand',    permissoes: [] },
  { id: 'campeao',  label: 'CAMPEÃO',  cor: 'ink',     permissoes: [] }
];

const corDoCargo = (c) => CORES_CARGO[(c && c.cor) || 'sand'] || CORES_CARGO.sand;

let buscandoCargos = false;
async function carregarCargos() {
  if (buscandoCargos) return;
  if (!temApi() || !window.api.xyven || !window.api.xyven.listarCargos) return;
  buscandoCargos = true;
  try {
    const r = await window.api.xyven.listarCargos();
    if (r && r.ok && Array.isArray(r.dados.cargos) && r.dados.cargos.length) {
      ALL_BADGES = r.dados.cargos.map((c) => ({
        id: c.id, label: c.nome, cor: c.cor, permissoes: c.permissoes || []
      }));
      renderProfile();
    } else if (r && !r.ok) {
      console.log('[xyven] cargos: ' + r.erro);
    }
  } catch (e) {
    console.log('[xyven] cargos falhou: ' + (e && e.message));
  } finally {
    buscandoCargos = false;
  }
}

const PROFILE_DEFAULT = {
  nick: 'Ny3san', skin: 'Ny3san', since: '03/2024', slim: false,
  total: 412, week: 9, longest: 7,
  servers: [
    { name: 'Redes do Norte',  addr: 'norte.mc.br',     hours: 168 },
    { name: 'Bedwars Brasil',  addr: 'bw.br',           hours: 96 },
    { name: 'Survival do Zé',  addr: 'ze.survival.net', hours: 74 },
    { name: 'Anarquia 1.8',    addr: 'anarquia.gg',     hours: 41 },
    { name: 'Mundo do Amigo',  addr: 'lan · local',     hours: 33 }
  ]
};

let profile;
try { profile = Object.assign({}, PROFILE_DEFAULT, JSON.parse(localStorage.getItem('xyven.profile') || '{}')); }
catch (e) { profile = Object.assign({}, PROFILE_DEFAULT); }
const saveProfile = () => { try { localStorage.setItem('xyven.profile', JSON.stringify(profile)); } catch (e) { /* sem storage */ } };

/* ---- cargos por conta. É isso que o painel dev administra. ---- */
/* Vazio de proposito. Quem manda em cargo e o Supabase: conta que nao
   estiver la nao tem nada. Antes havia quatro contas semeadas aqui com
   selos e grupo dev — o que fazia o launcher conceder por conta propria,
   sem ninguem ter concedido. Agora o local so guarda o que o servidor
   ja disse (e serve de cache quando ele nao responde). */
const MEMBERS_DEFAULT = [];

const freshMembers = () => MEMBERS_DEFAULT.map(m => Object.assign({}, m, { badges: m.badges.slice() }));
/* Uma limpeza unica: quem ja rodou versao antiga tem as quatro contas
   semeadas gravadas, e elas continuariam dando cargo sem respaldo do
   servidor. A marca evita repetir a limpeza a cada boot. */
try {
  if (localStorage.getItem('xyven.members.v') !== '2') {
    localStorage.removeItem('xyven.members');
    localStorage.setItem('xyven.members.v', '2');
  }
} catch (e) { /* sem storage */ }

let members;
try { members = JSON.parse(localStorage.getItem('xyven.members') || 'null') || freshMembers(); }
catch (e) { members = freshMembers(); }
const saveMembers = () => { try { localStorage.setItem('xyven.members', JSON.stringify(members)); } catch (e) { /* sem storage */ } };

const memberOf = (nick) => members.find(m => m.nick.toLowerCase() === String(nick).toLowerCase());
const badgesOf = (nick) => (memberOf(nick) || { badges: [] }).badges;
/* `group` fica na estrutura local so porque o cache antigo em
   localStorage ainda tem esse campo; nada le mais o valor. */

/* Permissoes da conta ativa, ditas pelo servidor. Vazio ate a
   primeira resposta: melhor esconder um botao por um segundo do que
   mostrar um que a pessoa nao pode usar. */
let permissoesAtuais = [];

/* O que aparece na tela sai daqui: body[data-perms~="terminal"] libera
   o .dev-only, e assim por diante. Isto e SO aparencia — cada acao e
   conferida de novo no servidor, que e onde a trava vale. */
function applyGroup() {
  /* `data-group` saiu junto com o conceito de grupo. Nada no CSS
     olha pra ele desde que a visibilidade passou a sair das
     permissoes — deixar so daria a impressao de que ainda decide
     alguma coisa. */
  delete document.body.dataset.group;
  document.body.dataset.perms = permissoesAtuais.join(' ');
}

function renderProfile() {
  $('#profName').textContent = profile.nick;
  /* Estava escrito "microsoft · premium" direto no HTML, do mock de
     design, e ninguem nunca sobrescrevia: conta pirata aparecia como
     premium. O tipo vem da conta ativa. */
  const contaAtiva = acharConta(state.account);
  $('#profNick').textContent = (contaAtiva && contaAtiva.type) || '—';
  $('#profSince').textContent = 'na fita desde ' + profile.since;
  const av = $('#profAvatar');
  if (av.dataset.skin !== profile.skin) { av.textContent = profile.nick[0]; av.dataset.skin = profile.skin; delete av.dataset.painted; }

  $('#profBadges').innerHTML = badgesOf(profile.nick).map(id => {
    const b = ALL_BADGES.find(x => x.id === id); if (!b) return '';
    const c = corDoCargo(b);
    return `<span class="badge" style="background:${c.bg};color:${c.fg}">${esc(b.label)}</span>`;
  }).join('');

  const t = horasDe(profile.nick);
  $('#profHours').innerHTML = [
    { label: 'TOTAL',   value: tempoCurto(t.total),        note: 'no client, in-game' },
    { label: 'SEMANA',  value: tempoCurto(t.semana),       note: 'últimos sete dias' },
    { label: 'SESSÃO',  value: tempoCurto(t.ultimaSessao), note: 'a última' }
  ].map(h => `<div class="hours__card"><span class="hours__label">${h.label}</span><span class="hours__value">${h.value}</span><span class="hours__note">${h.note}</span></div>`).join('');

  const jogados = Object.values(t.servidores).sort((a, b) => b.segundos - a.segundos).slice(0, 6);
  if (!jogados.length) {
    $('#serverList').innerHTML = '<div class="empty">nenhum servidor ainda. entre em um e o tempo aparece aqui.</div>';
  } else {
    const top = Math.max.apply(null, jogados.map(s => s.segundos).concat([1]));
    $('#serverList').innerHTML = jogados.map(s => `
    <div class="server">
      <span class="server__name">${esc(s.nome)}<br><span class="server__addr">${esc(s.addr)}</span></span>
      <span class="server__bar"><span class="server__fill" style="width:${Math.round(s.segundos / top * 100)}%"></span></span>
      <span class="server__hrs">${tempoCurto(s.segundos)}</span>
    </div>`).join('');
  }

  buildSkin();
  paintSkins();
}

/* ---- skin 3D: caixas de CSS com a textura do skin recortada por face ---- */
const SKIN_TEX = (nick) => 'https://mc-heads.net/skin/' + encodeURIComponent(nick);

/* ------------------------------------------------------------
   Qual é o modelo da skin: braço de 3px (slim) ou de 4px (clássico)?

   Antes isso só era conhecido para a skin da própria conta; para
   qualquer nick salvo o código assumia que a textura casava com a
   caixa. Quando não casava — skin slim desenhada na caixa clássica —
   ele lia 4px de largura de um braço que só tem 3, e a coluna a mais
   caía em cima de pixel transparente. Era daí que vinham as faixas
   vazias no braço, na perna e no PADRÃO.

   A Mojang responde isso para qualquer nick, então não há por que
   adivinhar. A resposta fica em cache e a prévia se redesenha sozinha
   quando ela chega.
   ------------------------------------------------------------ */
const modeloPorNick = Object.create(null);   /* nick -> true = slim */
const modeloPedido = Object.create(null);

function modeloDoNick(nick, aoSaber) {
  const k = String(nick || '').toLowerCase();
  if (!k) return null;
  if (k in modeloPorNick) return modeloPorNick[k];
  if (!modeloPedido[k] && temApi() && window.api.mc && window.api.mc.conta) {
    modeloPedido[k] = true;
    window.api.mc.conta(nick)
      .then((info) => {
        modeloPorNick[k] = !!(info && info.modelo === 'slim');
        if (aoSaber) aoSaber();
      })
      .catch(() => { modeloPorNick[k] = null; });   /* offline: segue no palpite */
  }
  return null;
}

/* a capa escolhida no editor só vale depois do USAR ESTA SKIN */
let capeApplied;
try { capeApplied = localStorage.getItem('xyven.cape') || 'none'; } catch (e) { capeApplied = 'none'; }

function buildSkin() { buildSkinInto('#skinBody', profile.skin, 9, capeApplied, profile.slim); }

/* ------------------------------------------------------------
   Um visor por palco, criado sob demanda e reaproveitado.

   Criar um SkinViewer custa caro (contexto WebGL). O codigo antigo
   remontava o DOM inteiro a cada troca de skin; aqui so trocamos a
   textura de um visor que ja existe.
   ------------------------------------------------------------ */
const visores = {};

function visorDe(sel) {
  if (visores[sel]) return visores[sel];
  const canvas = $(sel);
  if (!canvas) return null;
  visores[sel] = criarVisor(canvas);
  return visores[sel];
}

/* `sc` continua na assinatura so pra nao mexer em quem chama: o
   tamanho agora sai do palco, nao de um multiplicador fixo.

   `forcar` = a pessoa clicou PADRAO ou SLIM. Ai a escolha dela vale
   acima de tudo; sem isso os dois botoes do editor nao mexeriam em
   nada quando a Mojang ja tivesse respondido pelo nick. */
function buildSkinInto(sel, nick, sc, capeId, slim, forcar) {
  const v = visorDe(sel);
  if (!v) return;

  const capeDef = capasDisponiveis().find((c) => c.id === capeId);
  const capeTex = (capeDef && capeDef.url) ? String(capeDef.url).replace(/^http:/, 'https:') : '';

  /* null = "deixa a biblioteca decidir pela textura". So passamos um
     valor quando ele veio da Mojang; palpite pelo nick errava em
     conta pirata, e a textura nunca erra. */
  const sabido = modeloDoNick(nick, () => buildSkinInto(sel, nick, sc, capeId, slim, forcar));
  const modelo = forcar ? !!slim
    : ((sabido !== null) ? sabido
      : ((texturaSlim !== null && nick === profile.nick) ? texturaSlim : null));

  vestir(v, SKIN_TEX(nick), capeTex, modelo);
}

let skinView = null;
/* Compat: antes isto repintava a transformacao na mao. O loop do
   Three pinta sozinho, entao so garantimos que o visor existe. */
function applySkinRotation() { skinView = skinView || visorDe('#skinBody'); }

/* ============================================================
   SERVIDORES FIXOS

   Lista que vai igual pra todo mundo — não é o servers.dat do
   jogador. Pra mexer, é só editar aqui embaixo.

   Ícone e jogadores online vêm do próprio servidor, pelo Server
   List Ping (o mesmo handshake da lista de servidores do jogo).
   Nenhum serviço de terceiro no meio.
   ============================================================ */
/* ipStatus só existe quando o endereço público não responde ao ping.
   O Kaizen é assim: quem joga digita kaizenmc.gg, mas quem responde o
   Server List Ping é o srv.  O jogador entra pelo público; a consulta
   de status usa o outro. */
const SERVIDORES_FIXOS = [
  { nome: 'HYLEX',  ip: 'pirata.hylex.gg:25594' },
  { nome: 'KAIZEN', ip: 'kaizenmc.gg', ipStatus: 'srv.kaizenmc.gg' }
];

/* os que o jogador adiciona ficam só na máquina dele */
let servidoresMeus;
try { servidoresMeus = JSON.parse(localStorage.getItem('xyven.servidores') || '[]'); }
catch (e) { servidoresMeus = []; }
const salvarServidores = () => {
  try { localStorage.setItem('xyven.servidores', JSON.stringify(servidoresMeus)); }
  catch (e) { /* sem storage */ }
};

const todosServidores = () => SERVIDORES_FIXOS.concat(
  servidoresMeus.map((s) => Object.assign({}, s, { meu: true }))
);

function renderServidores(status) {
  const grade = $('#serversGrid'); if (!grade) return;
  grade.innerHTML = todosServidores().map((s) => {
    const st = (status && status[s.ipStatus || s.ip]) || null;
    const vivo = st && st.online !== null;
    const linha = !st ? 'consultando…'
      : (vivo ? st.online.toLocaleString('pt-BR') + ' online' : 'fora do ar');
    const fundo = (st && st.icone) ? 'background-image:url(' + st.icone + ')' : '';
    return '<button class="srv" data-ip="' + esc(s.ip) + '" title="' + esc(s.ip) + '">' +
      (s.meu ? '<span class="srv__x" data-rm="' + esc(s.ip) + '" title="remover">×</span>' : '') +
      '<span class="srv__icon" style="' + fundo + '"></span>' +
      '<span class="srv__info">' +
        '<span class="srv__name">' + esc(s.nome) + '</span>' +
        '<span class="srv__on"><span class="srv__dot' + (vivo ? '' : ' srv__dot--off') + '"></span>' +
          esc(linha) + '</span>' +
      '</span></button>';
  }).join('');
}

/* O que já se sabe sobre cada servidor, mantido entre atualizações:
   sem isso, a cada minuto a lista inteira voltava pra "consultando…"
   e só reaparecia junta, no tempo do mais lento. */
let statusServidores = {};

async function atualizarServidores() {
  renderServidores(statusServidores);
  if (!temApi() || !window.api.servidoresStatus) return;

  /* um pedido por servidor, em paralelo: cada card se acende assim que
     o seu responde, em vez de todos esperarem o último */
  await Promise.all(todosServidores().map(async (s) => {
    const alvo = s.ipStatus || s.ip;
    const r = await window.api.servidoresStatus([alvo]).catch(() => null);
    if (r && r.ok) {
      Object.assign(statusServidores, r.status);
      renderServidores(statusServidores);
    }
  }));
}

/* ---- adicionar servidor ---- */
const formServidor = (mostrar) => {
  const f = $('#serverAdd'); if (!f) return;
  f.hidden = !mostrar;
  if (mostrar) { $('#newServerNome').value = ''; $('#newServerIp').value = ''; $('#newServerNome').focus(); }
};

$('#addServerBtn').onclick = (e) => { e.preventDefault(); formServidor($('#serverAdd').hidden); };
$('#newServerCancel').onclick = () => formServidor(false);
$('#newServerOk').onclick = () => {
  const ip = $('#newServerIp').value.trim();
  /* host[:porta]. sem isso, um endereço torto vira card morto pra sempre */
  if (!/^[A-Za-z0-9._-]+(:\d{1,5})?$/.test(ip)) {
    avisarServidor('endereço inválido. use algo como mc.servidor.com ou mc.servidor.com:25565');
    return;
  }
  if (todosServidores().some((s) => s.ip.toLowerCase() === ip.toLowerCase())) {
    avisarServidor('esse servidor já está na lista.');
    return;
  }
  const nome = ($('#newServerNome').value.trim() || ip.split(':')[0].split('.')[0]).toUpperCase();
  servidoresMeus.push({ nome: nome, ip: ip });
  salvarServidores();
  formServidor(false);
  atualizarServidores();
};
$('#newServerIp').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#newServerOk').click(); });
$('#newServerNome').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#newServerIp').focus(); });

/* Clique abre o jogo já conectando no servidor.
   Botão direito copia o IP, pra quem só quer o endereço. */
document.addEventListener('click', (e) => {
  /* o × fica dentro do card: sem sair aqui, remover abriria o jogo junto */
  const x = e.target.closest && e.target.closest('.srv__x');
  if (x) {
    e.stopPropagation();
    servidoresMeus = servidoresMeus.filter((s) => s.ip !== x.dataset.rm);
    salvarServidores();
    atualizarServidores();
    return;
  }
  /* `.srv` e nao `.server`: a segunda ainda existe, e a lista de
     "servidores mais tocados" do perfil. Clicar la nao abre jogo. */
  const b = e.target.closest && e.target.closest('.srv');
  if (!b) return;
  if (jogoAberto) { avisarServidor('o Minecraft já está aberto. feche antes de entrar em outro servidor.'); return; }
  if (jogoAbrindo) return;
  avisarServidor('abrindo o Minecraft em ' + b.dataset.ip + '…');
  tocar(b.dataset.ip);
});

document.addEventListener('contextmenu', async (e) => {
  const b = e.target.closest && e.target.closest('.srv');
  if (!b) return;
  e.preventDefault();
  avisarServidor((await copiar(b.dataset.ip))
    ? 'IP copiado: ' + b.dataset.ip
    : 'não consegui copiar. o IP é ' + b.dataset.ip);
});

let dicaServidorAntes = null, dicaServidorTimer = 0;
function avisarServidor(txt) {
  const dica = $('#serversHint'); if (!dica) return;
  if (dicaServidorAntes === null) dicaServidorAntes = dica.textContent;
  dica.textContent = txt;
  clearTimeout(dicaServidorTimer);
  dicaServidorTimer = setTimeout(() => {
    dica.textContent = dicaServidorAntes;
    dicaServidorAntes = null;
  }, 3000);
}

atualizarServidores();
/* atualiza sozinho: número de online envelhece rápido */
setInterval(atualizarServidores, 60000);

/* ============================================================
   10.d EDITOR DE SKIN — prévia, capas e skins salvas
   Capas do Minecraft: cada uma é uma textura 64×32 e a capa
   ocupa 10×16 a partir de 1,1. Coloque os .png em assets/capes/
   e tanto os cards quanto a prévia passam a mostrar a capa real.
   ============================================================ */
/* a lista fixa de capas do design saiu: agora vem da conta (capasDaConta) */

/* capas reais da conta ativa.
   pirata nao tem capa da Mojang -> so "SEM CAPA" com X.
   premium: a API publica devolve so a capa EQUIPADA; o catalogo
   completo depende do login Microsoft (api.minecraftservices.com). */
/* capas do proprio launcher: nao dependem da Mojang, entao valem
   tambem para conta offline. ARTE PROVISORIA (design pendente). */
/* As quatro que vem dentro do launcher. Continuam aqui porque o .png
   delas e arquivo local: a linha no banco so declara que existem, sem
   imagem, pra nao obrigar a reenviar o que ja esta empacotado. */
const CAPAS_LOCAIS = [
  { id: 'caveira',   name: 'CAVEIRA',   arquivo: 'caveira.png' },
  { id: 'moonlight', name: 'MOONLIGHT', arquivo: 'moonlight.png' },
  { id: 'broken',    name: 'BROKEN',    arquivo: 'broken.png' },
  { id: 'enderman',  name: 'ENDERMAN',  arquivo: 'enderman.png' }
].map((c) => Object.assign({}, c, { url: 'capes/' + c.arquivo, origem: 'launcher' }));

/* Catalogo da loja. Comeca com as locais e e substituido pelo que o
   servidor manda — sem rede, o editor de skin continua funcionando
   com as quatro de sempre em vez de abrir vazio. */
let CATEGORIAS = [{ id: 'capas', nome: 'CAPAS', ordem: 1 }];
let COSMETICOS = CAPAS_LOCAIS.map((c) => ({
  id: c.id, nome: c.name, descricao: '', imagem: null, categoria: 'capas'
}));

/* A URL do .png que veste. Item da loja traz a sua; as quatro locais
   nao tem imagem no banco e caem no arquivo empacotado. */
function urlDoItem(c) {
  if (!c) return '';
  if (c.imagem) return c.imagem;
  const local = CAPAS_LOCAIS.find((x) => x.id === c.id);
  return local ? local.url : '';
}

const ehCapa = (c) => !!c && c.categoria === 'capas';

/* As capas no formato que o editor de skin ja espera. `let` e nao
   `const`: e refeita quando o catalogo chega do servidor, e os cinco
   lugares que leem isto pegam o valor na hora da chamada. */
let CAPAS_XYVEN = CAPAS_LOCAIS.slice();

function refazerCapas() {
  CAPAS_XYVEN = COSMETICOS.filter(ehCapa).map((c) => ({
    id: c.id, name: c.nome, url: urlDoItem(c), origem: 'launcher'
  }));
}

/* Null = ainda nao perguntei. String = o servidor recusou, e a tela
   precisa DIZER isso: o plano B local faz a loja parecer viva, e sem
   este aviso a pessoa so descobre que nada esta la na hora de salvar. */
let lojaFora = null;

let buscandoLoja = false;
async function carregarLoja() {
  if (buscandoLoja) return;
  if (!temApi() || !window.api.xyven || !window.api.xyven.listarLoja) return;
  buscandoLoja = true;
  try {
    const r = await window.api.xyven.listarLoja();
    if (r && r.ok) {
      lojaFora = '';
      if ((r.dados.categorias || []).length) CATEGORIAS = r.dados.categorias;
      if ((r.dados.cosmeticos || []).length) COSMETICOS = r.dados.cosmeticos;
      refazerCapas();
      renderLoja();
      /* o editor de skin lista capas: se estiver aberto, redesenha */
      if ($('#skinOverlay') && !$('#skinOverlay').hidden) renderSkinEditor();
    } else if (r && !r.ok) {
      lojaFora = r.erro || 'a loja não respondeu.';
      console.log('[xyven] loja: ' + r.erro);
      renderLoja();
    }
  } catch (e) {
    lojaFora = (e && e.message) || 'a loja não respondeu.';
    console.log('[xyven] loja falhou: ' + (e && e.message));
    renderLoja();
  } finally {
    buscandoLoja = false;
  }
}

/* declarado aqui em cima, e nao junto de sincronizarConta: capasDisponiveis()
   roda no primeiro desenho da tela, antes daquele bloco. um let depois do uso
   e TDZ, e isso ja quebrou este arquivo mais de uma vez. */
let contaRemota = null;

let capasDaConta = [];        /* [{ id, name, url }] — vem da Mojang */

/* Capas que ESTA conta pode usar.

   Da Mojang vem o que a pessoa realmente tem — capa de evento, de
   migracao, o que for. Do launcher, so o que foi dado por /gift e
   esta gravado no servidor.

   Antes o catalogo inteiro do client aparecia pra todo mundo, o que
   fazia da capa um enfeite sem valor: ninguem "ganha" algo que ja
   estava ali. Agora ganhar significa alguma coisa.

   Conta pirata nao tem registro no servidor, entao fica so com o que
   a Mojang der — ou seja, nada. E de proposito: sem UUID nao da pra
   provar de quem e a capa, e qualquer um que digitasse o nick a teria. */
function capasDisponiveis() {
  const liberadas = (contaRemota && Array.isArray(contaRemota.capas)) ? contaRemota.capas : [];
  return capasDaConta.concat(CAPAS_XYVEN.filter((c) => liberadas.includes(c.id)));
}
let contaMS = null;           /* conta Microsoft logada nesta sessao */
let contaEhPremium = false;

const ehPirata = (nick) => {
  const c = acharConta(nick);
  return !c || ehTipoPirata(c);
};

/* o tipo de braco vem da conta; so redesenha se mudou */
function aplicarModelo(slim) {
  if (!!profile.slim === !!slim) return;
  profile.slim = !!slim;
  saveProfile();
  buildSkin();
}

async function carregarCapas(nick) {
  capasDaConta = [];
  contaEhPremium = false;
  if (!temApi() || ehPirata(nick)) return;

  /* logado pela Microsoft: o perfil devolve o catalogo inteiro */
  if (contaMS && contaMS.nick.toLowerCase() === String(nick).toLowerCase()) {
    contaEhPremium = true;
    capasDaConta = (contaMS.capas || []).map((c) => ({ id: c.id, name: c.nome, url: c.url }));
    return;
  }
  /* sem login: a API publica so mostra a capa equipada */
  try {
    const info = await window.api.mc.conta(nick);
    contaEhPremium = !!(info && info.premium);
    if (info && info.capa) capasDaConta = [{ id: 'mojang-ativa', name: 'CAPA DA CONTA', url: info.capa }];
    /* respeita o tipo de braco da conta em vez de assumir o classico */
    if (info && info.modelo) { texturaSlim = info.modelo === 'slim'; aplicarModelo(texturaSlim); }
  } catch (e) { /* offline: segue sem capa */ }
}

const SKINS_DEFAULT = [];   /* enche conforme o usuario salva */
let savedSkins, skinDraft, capeDraft, slimDraft;
try { savedSkins = JSON.parse(localStorage.getItem('xyven.skins') || 'null') || SKINS_DEFAULT.slice(); }
catch (e) { savedSkins = SKINS_DEFAULT.slice(); }
try { capeDraft = localStorage.getItem('xyven.cape') || 'none'; } catch (e) { capeDraft = 'none'; }
const saveSkins = () => { try { localStorage.setItem('xyven.skins', JSON.stringify(savedSkins)); localStorage.setItem('xyven.cape', capeApplied); } catch (e) { /* sem storage */ } };

function renderSkinEditor() {
  $('#skinEdName').textContent = skinDraft;
  const escolhida = [{ id: 'none', name: 'sem capa' }].concat(capasDisponiveis()).find(c => c.id === capeDraft);
  $('#skinEdMeta').textContent = 'capa: ' + ((escolhida && escolhida.name) || 'sem capa').toLowerCase() + ' · arraste pra girar';
  const totalCapas = capasDisponiveis().length;
  $('#capeCount').textContent = totalCapas + (totalCapas === 1 ? ' capa' : ' capas')
    + (capasDaConta.length ? '' : (contaEhPremium ? ' · nenhuma da conta' : ' · só do launcher'));
  $('#skinCount').textContent = savedSkins.length + ' salvas';

  /* lista = SEM CAPA + o que a conta realmente tem */
  const lista = [{ id: 'none', name: 'SEM CAPA', url: '' }].concat(capasDisponiveis());
  const semNenhuma = capasDaConta.length === 0;
  const X = '<span class="cape__x"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>';

  $('#capeList').innerHTML = lista.map(c => {
    const art = c.url
      ? `background-image:url(${c.url});background-size:${64 * 5}px ${32 * 5}px;background-position:${-1 * 5}px ${-1 * 5}px;image-rendering:pixelated;width:${10 * 5}px;height:${16 * 5}px`
      : `width:${10 * 5}px;height:${16 * 5}px;background:var(--sand);border:2px solid var(--ink)`;
    /* o X so entra no quadrado do "sem capa" quando nao ha capa nenhuma */
    const marca = (c.id === 'none' && semNenhuma) ? X : '';
    return `
    <button class="cape ${c.id === capeDraft ? 'is-on' : ''}" data-cape="${c.id}">
      <span class="cape__art"><span class="cape__tex" style="${art}"></span>${marca}</span>
      <span class="cape__name">${esc(c.name)}</span>
    </button>`;
  }).join('');

  $('#skinList').innerHTML = savedSkins.map(n => `
    <button class="skincard ${n === skinDraft ? 'is-on' : ''}" data-skinpick="${esc(n)}">
      <span class="skincard__img" style="background-image:url('https://mc-heads.net/body/${encodeURIComponent(n)}/180')"></span>
      <span class="skincard__name">${esc(n)}</span>
      ${n === skinDraft ? `<span class="skincard__remover" data-skindel="${esc(n)}">REMOVER</span>` : ''}
    </button>`).join('');

  buildSkinInto('#skinEdBody', skinDraft, 5, capeDraft, slimDraft, true);
  $$('[data-model]').forEach(b => b.classList.toggle('is-on', (b.dataset.model === 'slim') === !!slimDraft));
  if (skinEdView) skinEdView.paint();
}

$$('[data-model]').forEach(b => b.onclick = () => { slimDraft = b.dataset.model === 'slim'; renderSkinEditor(); });

$('#openSkinEditor').onclick = () => {
  skinDraft = profile.skin;
  capeDraft = capeApplied;
  slimDraft = !!profile.slim;
  renderSkinEditor();
  open($('#skinOverlay'));
  /* busca na Mojang e redesenha quando responder */
  carregarCapas(profile.nick).then(() => {
    if (!capasDisponiveis().some((c) => c.id === capeDraft)) capeDraft = 'none';
    renderSkinEditor();
  });
};

$('#capeList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cape]'); if (!b || b.disabled) return;
  capeDraft = b.dataset.cape; renderSkinEditor();
});

$('#skinList').addEventListener('click', (e) => {
  /* o remover vive dentro do card: precisa ser atendido antes, senao o
     clique nele tambem contaria como escolher a skin */
  const del = e.target.closest('[data-skindel]');
  if (del) {
    const nome = del.dataset.skindel;
    savedSkins = savedSkins.filter((x) => x !== nome);
    /* removeu a que estava em uso: cai para a primeira que sobrou, ou para o
       nick da conta, para a previa nao ficar apontando pro vazio */
    if (skinDraft === nome) skinDraft = savedSkins[0] || profile.nick || state.account;
    saveSkins(); renderSkinEditor();
    return;
  }
  const b = e.target.closest('[data-skinpick]'); if (!b) return;
  skinDraft = b.dataset.skinpick; renderSkinEditor();
});

$('#skinAdd').onclick = () => {
  const nick = $('#skinNewNick').value.trim();
  if (!nick) { $('#skinNewNick').focus(); return; }
  if (!savedSkins.includes(nick)) savedSkins.push(nick);
  skinDraft = nick; $('#skinNewNick').value = '';
  saveSkins(); renderSkinEditor();
};

$('#skinApply').onclick = async () => {
  const nick = skinDraft, slim = slimDraft;
  profile.skin = nick;
  profile.slim = slim;
  capeApplied = capeDraft;
  saveProfile(); saveSkins(); renderProfile();
  gravarCosmeticos();
  close($('#skinOverlay'));
  await subirSkinPraMojang(nick, slim);
};

/* Token válido da conta ativa, ou null se for pirata / não der pra renovar.
   Vale pra tudo que precisa provar quem você é: subir skin, falar com a API. */
async function tokenAtual() {
  if (!temApi() || !window.api.auth) return null;
  if (ehPirata(state.account)) return null;          /* pirata nao tem o que provar */

  /* o que ja esta em memoria, se ainda vale */
  if (contaMS && contaMS.nick === state.account && contaMS.expiraEm > Date.now() + 60000) {
    return contaMS.accessToken;
  }
  /* senao renova pelo refresh guardado. No boot o contaMS e SEMPRE null
     (so um login novo o preenche), entao sem este caminho o launcher
     nunca falaria com a API depois de reiniciar. */
  const rn = await window.api.auth.renovar(state.account).catch(() => null);
  if (rn && rn.ok && rn.conta) { contaMS = rn.conta; return rn.conta.accessToken; }
  return null;
}

/* A skin do jogo vem da Mojang, não daqui: sem subir, você troca no
   launcher e entra no servidor com a antiga. Só dá pra fazer com conta
   original logada — em conta pirata a escolha continua sendo só local. */
async function subirSkinPraMojang(nick, slim) {
  if (!temApi() || !window.api.auth || !window.api.auth.trocarSkin) return;
  if (!contaMS || contaMS.nick !== state.account) return;   /* pirata: nada a fazer */

  let sessao = contaMS;
  if (!(sessao.expiraEm > Date.now() + 60000)) {
    const rn = await window.api.auth.renovar(state.account).catch(() => null);
    if (rn && rn.ok && rn.conta) { contaMS = rn.conta; sessao = rn.conta; }
    else { avisarSkin('não consegui renovar a sessão pra trocar a skin. entre de novo na conta.', false); return; }
  }

  const r = await window.api.auth.trocarSkin({
    token: sessao.accessToken, url: SKIN_TEX(nick), slim: !!slim
  }).catch((e) => ({ ok: false, erro: String(e && e.message || e) }));

  /* Sucesso nao avisa: voce acabou de clicar em USAR ESTA SKIN e ve a
     mudanca na tela — o sino so repetia o obvio. Falha continua
     avisando, porque ai nada muda visualmente e o silencio enganaria. */
  if (!r || !r.ok) avisarSkin('a skin não trocou no jogo: ' + esc((r && r.erro) || 'erro desconhecido'), false);
}

function avisarSkin(html, ok) {
  notifs.unshift({
    ts: Date.now(), read: false, badge: ok ? 'skin-ok' : 'skin-erro',
    text: (ok ? '<b>SKIN TROCADA</b><br>' : '<b>SKIN NÃO TROCOU</b><br>') + html
  });
  notifs = notifs.slice(0, 30);
  saveNotifs(); renderNotifs(); ringBell();
}

/* escreve <gameDir>/xyven/cosmetics.json + a textura, pro mod dentro
   do jogo ler. o launcher nao precisa estar aberto depois disso. */
async function gravarCosmeticos() {
  if (!temApi() || !window.api.cosmeticos) return;
  const capa = capasDisponiveis().find((c) => c.id === capeApplied) || null;
  try {
    await window.api.cosmeticos({
      gameDir: state.dir || $('#dirInput').value,
      nick: state.account,
      uuid: contaMS && contaMS.nick === state.account ? contaMS.uuid : null,
      slim: !!profile.slim,
      capa: capa ? { id: capa.id, origem: capa.origem || 'mojang', arquivo: capa.arquivo || null, url: capa.url } : null,
      /* o catalogo inteiro: sem isto o launcher so copiava a capa escolhida,
         e o menu do mod dentro do jogo listava uma opcao so */
      /* so o que a conta tem: o menu do B dentro do jogo le este catalogo,
         e listar capa bloqueada seria mostrar o que nao da pra usar */
      catalogo: CAPAS_XYVEN
        .filter((c) => capasDisponiveis().some((d) => d.id === c.id))
        .map((c) => ({ id: c.id, name: c.name, arquivo: c.arquivo }))
    });
  } catch (e) { console.warn('não consegui gravar os cosméticos', e); }
}

/* gira a prévia do editor de forma independente da tela de perfil */
const skinEdView = { paint: () => {} };   /* o visor 3D repinta sozinho */

/* ---- painéis dev… ---- */
/* ============================================================
   PRINTS DO JOGO — o polaroid do Início e a galeria

   A lista traz só nome e data; a imagem de cada uma é buscada
   quando vai aparecer na tela. Trinta prints de 1080p carregadas
   de uma vez seriam dezenas de MB parados na memória da janela.
   ============================================================ */
let listaPrints = [];
let printAtual = 0;
const cachePrints = Object.create(null);   /* arquivo -> data URL já lida */

const dirDoJogo = () => state.dir || ($('#dirInput') ? $('#dirInput').value : '');

function quandoLegivel(ms) {
  const d = new Date(ms);
  const dois = (n) => String(n).padStart(2, '0');
  return dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + ' — ' + dois(d.getHours()) + ':' + dois(d.getMinutes());
}

async function lerPrint(arquivo) {
  if (cachePrints[arquivo]) return cachePrints[arquivo];
  if (!temApi() || !window.api.prints) return null;
  const r = await window.api.prints.ler(dirDoJogo(), arquivo).catch(() => null);
  if (r && r.ok && r.dados) { cachePrints[arquivo] = r.dados; return r.dados; }
  return null;
}

async function atualizarPrints() {
  if (!temApi() || !window.api.prints) return;
  const r = await window.api.prints.listar(dirDoJogo()).catch(() => null);
  listaPrints = (r && r.ok && r.prints) ? r.prints : [];

  const img = $('#heroPrintImg'), cap = $('#heroPrintCap');
  if (!img || !cap) return;

  if (!listaPrints.length) {
    img.classList.add('ph');
    img.style.backgroundImage = '';
    img.textContent = 'PRINT DO JOGO';
    cap.textContent = 'nenhuma print ainda · F2 no jogo';
    return;
  }

  const ultima = listaPrints[0];
  const dados = await lerPrint(ultima.arquivo);
  if (dados) {
    img.classList.remove('ph');
    img.textContent = '';
    img.style.backgroundImage = 'url(' + dados + ')';
  }
  cap.textContent = 'SALVO EM ' + quandoLegivel(ultima.quando);
}

/* ---- galeria ---- */
/* zoom e deslocamento da foto em exibição */
const vista = { escala: 1, x: 0, y: 0 };

function pintarVista() {
  const f = $('#galFoto'); if (!f) return;
  f.style.transform = 'translate(' + vista.x + 'px,' + vista.y + 'px) scale(' + vista.escala + ')';
  /* 0% = a foto inteira cabendo no quadro, que e onde ela comeca.
     Mostrar "100%" ali dava a impressao de zoom no maximo. */
  const btn = $('#galZoomReset');
  if (btn) btn.textContent = Math.round((vista.escala - 1) * 100) + '%';
}

function zerarVista() { vista.escala = 1; vista.x = 0; vista.y = 0; pintarVista(); }

async function mostrarPrint(i) {
  if (!listaPrints.length) return;
  printAtual = Math.max(0, Math.min(listaPrints.length - 1, i));
  const p = listaPrints[printAtual];
  const foto = $('#galFoto'), aviso = $('#galAviso');

  /* cada foto começa sem zoom: manter o anterior deixa a próxima
     entrando cortada, e a pessoa não entende por quê */
  zerarVista();
  foto.hidden = true;
  aviso.hidden = false;
  aviso.textContent = 'CARREGANDO…';

  const dados = await lerPrint(p.arquivo);
  /* a pessoa pode ter passado pra outra enquanto esta carregava */
  if (listaPrints[printAtual] !== p) return;

  if (dados) { foto.src = dados; foto.hidden = false; aviso.hidden = true; }
  else { aviso.textContent = 'NÃO CONSEGUI ABRIR ESTA IMAGEM'; }

  $('#galQuando').textContent = quandoLegivel(p.quando);
  $('#galConta').textContent = (printAtual + 1) + ' de ' + listaPrints.length + ' · ' + p.arquivo;
  $('#galAnterior').disabled = printAtual === 0;
  $('#galProxima').disabled = printAtual >= listaPrints.length - 1;
}

/* ---- zoom com a roda, arraste com o botão esquerdo ---- */
if ($('#galImg')) {
  const palco = $('#galImg');

  palco.addEventListener('wheel', (e) => {
    e.preventDefault();
    const antes = vista.escala;
    const nova = Math.max(1, Math.min(6, antes * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (nova === antes) return;                 /* ja no limite */

    /* Amplia em cima do CURSOR, nao do centro. Com o centro fixo, o
       pedaco que a pessoa quer ver foge da tela e ela precisa arrastar
       atras — e ai o zoom parece que nao obedece. */
    const r = palco.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    /* ponto da imagem que esta sob o cursor agora */
    const px = (cx - vista.x) / antes;
    const py = (cy - vista.y) / antes;

    vista.escala = nova;
    if (nova === 1) { vista.x = 0; vista.y = 0; }   /* voltou ao inicio: recentraliza */
    else { vista.x = cx - px * nova; vista.y = cy - py * nova; }
    pintarVista();
  }, { passive: false });

  let arrasto = null;
  palco.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || vista.escala === 1) return;
    arrasto = { x: e.clientX, y: e.clientY, ox: vista.x, oy: vista.y };
    palco.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  palco.addEventListener('pointermove', (e) => {
    if (!arrasto) return;
    vista.x = arrasto.ox + (e.clientX - arrasto.x);
    vista.y = arrasto.oy + (e.clientY - arrasto.y);
    pintarVista();
  });
  const soltar = () => { arrasto = null; };
  palco.addEventListener('pointerup', soltar);
  palco.addEventListener('pointercancel', soltar);
  palco.addEventListener('dblclick', zerarVista);
}

if ($('#galZoomReset')) $('#galZoomReset').onclick = zerarVista;

/* ---- copiar a imagem ---- */
if ($('#galCopiar')) {
  $('#galCopiar').onclick = async () => {
    const b = $('#galCopiar');
    const p = listaPrints[printAtual];
    if (!p || !temApi() || !window.api.prints || !window.api.prints.copiar) return;
    const r = await window.api.prints.copiar(dirDoJogo(), p.arquivo).catch(() => null);
    b.textContent = (r && r.ok) ? 'COPIADO' : 'FALHOU';
    setTimeout(() => { b.textContent = 'COPIAR'; }, 1600);
  };
}

if ($('#heroPrint')) {
  $('#heroPrint').onclick = async () => {
    await atualizarPrints();          /* pode ter tirado print desde o boot */
    if (!listaPrints.length) return;
    open($('#printsOverlay'));
    mostrarPrint(0);
  };
}
if ($('#galAnterior')) $('#galAnterior').onclick = () => mostrarPrint(printAtual - 1);
if ($('#galProxima')) $('#galProxima').onclick = () => mostrarPrint(printAtual + 1);

document.addEventListener('keydown', (e) => {
  const ov = $('#printsOverlay');
  if (!ov || ov.hidden) return;
  if (e.key === 'ArrowLeft') mostrarPrint(printAtual - 1);
  else if (e.key === 'ArrowRight') mostrarPrint(printAtual + 1);
});

/* Sem chamada no boot: `state.dir` so e definido dentro da restauracao
   da pasta, que e assincrona. Chamar aqui rodava com o caminho vazio e
   a lista voltava sempre sem nada. Quem dispara e a propria restauracao. */

/* ============================================================
   CONTA NO SERVIDOR

   Cargos e capas moram no Supabase, não mais só nesta máquina.
   O launcher pergunta no boot e guarda o resultado; se a API
   estiver fora, o cache manda.

   Isso importa mais do que parece: sem cache, uma queda de rede
   faria todos os cargos sumirem da tela como se tivessem sido
   removidos. A API separa "não consegui falar" de "você não tem",
   e aqui só a segunda apaga alguma coisa.
   ============================================================ */
const cacheContaChave = (nick) => 'xyven.remoto.' + String(nick).toLowerCase();

function lerCacheConta(nick) {
  try { return JSON.parse(localStorage.getItem(cacheContaChave(nick)) || 'null'); }
  catch (e) { return null; }
}
function gravarCacheConta(nick, dados) {
  try { localStorage.setItem(cacheContaChave(nick), JSON.stringify(dados)); }
  catch (e) { /* sem storage */ }
}

/* joga o que veio do servidor na lista local, que é quem pinta os
   selos e libera o rail do dev */
function aplicarConta(c) {
  if (!c || !c.nick) return;
  let m = memberOf(c.nick);
  if (!m) { m = { nick: c.nick, group: 'player', badges: [] }; members.push(m); }
  m.nick = c.nick;
  m.group = c.grupo || 'player';
  m.badges = Array.isArray(c.cargos) ? c.cargos.slice() : [];
  /* so a conta ATIVA manda no que aparece; ver /account info de um
     terceiro nao pode liberar botao nenhum */
  if (String(c.nick).toLowerCase() === String(state.account).toLowerCase()) {
    permissoesAtuais = Array.isArray(c.permissoes) ? c.permissoes.slice() : [];
  }
  saveMembers();

  /* A capa em uso e guardada uma vez so, nao por conta. Trocando de
     conta, a escolha antiga vinha junto — e aparecia mesmo em quem
     nao tem aquela capa. Se nao esta liberada, cai pra nenhuma. */
  if (capeApplied !== 'none' && !capasDisponiveis().some((x) => x.id === capeApplied)) {
    capeApplied = 'none';
    capeDraft = 'none';
    saveSkins();
  }

  applyGroup(); renderProfile(); renderAccounts(); buildSkin();
  /* a lista de capas depende do que o servidor liberou; se o editor
     estiver aberto ele precisa se redesenhar com o resultado novo */
  if (!$('#skinOverlay').hidden) renderSkinEditor();
}


/* Avisa o que MUDOU desde a ultima vez.

   Sem isto a pessoa so descobria um cargo novo se reparasse sozinha no
   perfil — e como a sincronizacao so acontece ao abrir o launcher, o
   item podia estar la ha dias sem ninguem notar.

   Compara com o cache, entao a PRIMEIRA sincronizacao de uma conta nao
   avisa nada: tudo seria "novo" e o sino viraria uma enxurrada. */
function avisarNovidades(antes, depois) {
  if (!antes || !depois) return;

  const nomeDoItem = (id) => {
    const b = ALL_BADGES.find((x) => x.id === id);
    if (b) return { rotulo: b.label, tipo: 'cargo', badge: id };
    const c = CAPAS_XYVEN.find((x) => x.id === id);
    if (c) return { rotulo: c.name, tipo: 'capa', badge: null };
    return { rotulo: String(id).toUpperCase(), tipo: 'item', badge: null };
  };

  const so = (a, b) => (b || []).filter((x) => !(a || []).includes(x));
  const ganhou = so(antes.cargos, depois.cargos).concat(so(antes.capas, depois.capas));
  const perdeu = so(depois.cargos, antes.cargos).concat(so(depois.capas, antes.capas));

  ganhou.forEach((id) => {
    const i = nomeDoItem(id);
    notifs.unshift({
      ts: Date.now(), read: false, badge: i.badge,
      text: '<b>' + esc(i.rotulo) + '</b><br>você recebeu ' +
            (i.tipo === 'capa' ? 'uma capa nova' : 'um cargo novo') + ' no client.'
    });
  });

  perdeu.forEach((id) => {
    const i = nomeDoItem(id);
    notifs.unshift({
      ts: Date.now(), read: false, badge: i.badge,
      text: '<b>' + esc(i.rotulo) + '</b><br>saiu da sua conta.'
    });
  });

  if (ganhou.length || perdeu.length) {
    notifs = notifs.slice(0, 30);
    saveNotifs(); renderNotifs(); ringBell();
  }
}

/* ============================================================
   AVISO DO /title

   Codigo de cor do Minecraft: & seguido de 0-9a-f (cor) ou
   l/o/n/m (negrito, italico, sublinhado, riscado) e r (reseta).

   O texto vem de quem publicou o recado, entao passa por esc()
   ANTES de virar HTML. Sem isso, um < no meio do aviso quebraria a
   tela — e um aviso e a unica coisa aqui que uma pessoa escreve
   pra aparecer na tela de outra. */
const CORES_MC = '0123456789abcdef';
const FORMATOS_MC = 'lonm';

function pintarMinecraft(texto) {
  const bruto = String(texto || '');
  let html = '';
  let abertas = 0;
  let cor = null;
  const formatos = new Set();

  const abrir = () => {
    const classes = (cor ? ['mc-' + cor] : []).concat([...formatos].map((f) => 'mc-' + f));
    if (!classes.length) return;
    html += '<span class="' + classes.join(' ') + '">';
    abertas++;
  };
  const fechar = () => { while (abertas > 0) { html += '</span>'; abertas--; } };

  for (let i = 0; i < bruto.length; i++) {
    const c = bruto[i];
    /* aceita & (o que se digita) e § (o que o jogo usa) */
    if ((c === '&' || c === '§') && i + 1 < bruto.length) {
      const cod = bruto[i + 1].toLowerCase();
      if (CORES_MC.includes(cod) || FORMATOS_MC.includes(cod) || cod === 'r' || cod === 'k') {
        fechar();
        if (cod === 'r') { cor = null; formatos.clear(); }
        else if (CORES_MC.includes(cod)) { cor = cod; formatos.clear(); }  /* cor reseta formato, como no jogo */
        else if (FORMATOS_MC.includes(cod)) formatos.add(cod);
        /* k (embaralhado) e reconhecido so pra nao aparecer cru na tela */
        abrir();
        i++;
        continue;
      }
    }
    html += esc(c);
  }
  fechar();
  return html;
}

/* ---- mostrar o recado, uma vez por aviso ---- */
const avisoVistoChave = 'xyven.avisoId';
function mostrarAviso(aviso) {
  if (!aviso || !aviso.id) return;
  let visto = null;
  try { visto = localStorage.getItem(avisoVistoChave); } catch (e) { /* sem storage */ }
  if (String(visto) === String(aviso.id)) return;      /* ja viu este */

  $('#avisoTitulo').innerHTML = pintarMinecraft(aviso.titulo);
  $('#avisoTexto').innerHTML = pintarMinecraft(aviso.texto || '');

  /* Aviso do /update carrega a postagem inteira: banner e seções.
     O do /title nao tem `post` e cai no caminho simples de sempre. */
  const caixa = $('#avisoPost');
  const post = aviso.post;
  if (post) {
    const banner = post.imagem
      ? '<img class="aviso__banner" src="' + esc(post.imagem) + '" alt="">'
      : '';
    const corpo = post.corpo
      ? '<div class="sec__txt" style="margin-bottom:4px">' + formatarTexto(post.corpo) + '</div>'
      : '';
    caixa.innerHTML = banner + corpo + htmlDasSecoes(post.secoes);
    caixa.hidden = false;
  } else {
    caixa.innerHTML = '';
    caixa.hidden = true;
  }

  open($('#avisoOverlay'));

  /* so marca como visto ao FECHAR: se a pessoa matar o launcher
     antes de ler, o recado volta na proxima */
  $('#avisoFechar').onclick = () => {
    try { localStorage.setItem(avisoVistoChave, String(aviso.id)); } catch (e) { /* sem storage */ }
    close($('#avisoOverlay'));
  };
}

async function sincronizarConta() {
  /* Zera ANTES de perguntar. Sem isto, trocar de conta mantinha o
     contaRemota da anterior enquanto a resposta nao chegava — e se
     ela nunca chegasse, ficava pra sempre. Foi assim que uma capa
     da Ny3san apareceu numa conta que nao tinha capa nenhuma. */
  contaRemota = null;
  const deQuem = state.account;

  /* Passa a escutar esta conta. Fica aqui, e nao num lugar so, porque
     a conta ativa muda: cada sincronizacao reaponta a campainha. */
  if (deQuem && temApi() && window.api.xyven && window.api.xyven.seguir) {
    window.api.xyven.seguir(deQuem).catch(() => { /* sem tempo real: o boot resolve */ });
  }

  /* Sem conta ativa nao ha o que sincronizar. Sem esta guarda a
     chamada saia com o nick vazio, a API respondia "mande o nick" e
     o erro poluia o log escondendo o que importava. */
  if (!deQuem) return;
  if (!temApi() || !window.api.xyven) return;

  const token = await tokenAtual();

  /* Conta pirata nao tem token, mas pode ter cosmetico: a leitura dela
     e publica, pela chave `pirata:<nick>`. Sem isto o /gift gravaria e
     o launcher dela nunca leria. */
  if (!token && ehPirata(state.account)) {
    /* true = "esta e a conta ativa de alguem", nao uma consulta solta.
       So a conta que a pessoa esta usando entra na tabela; /account info
       de terceiro continua sendo leitura pura. */
    const rp = await window.api.xyven.consultar(deQuem, true).catch(() => null);
    /* trocou de conta enquanto a resposta vinha: joga fora */
    if (deQuem !== state.account) return;
    if (rp && rp.ok) {
      avisarNovidades(lerCacheConta(deQuem), rp.dados);
      mostrarAviso(rp.dados.aviso);
      /* grupo vem sempre 'player' do servidor; conta pirata nao manda em nada */
      contaRemota = rp.dados;
      gravarCacheConta(state.account, rp.dados);
      aplicarConta({ ...rp.dados, nick: state.account, grupo: 'player' });
      console.log('[xyven] ' + state.account + ' (pirata): capas=[' + (rp.dados.capas || []).join(',') + ']');
    } else {
      const g = lerCacheConta(state.account);
      if (g) { contaRemota = g; aplicarConta({ ...g, grupo: 'player' }); }
      console.log('[xyven] pirata ' + state.account + ': ' + ((rp && rp.erro) || 'sem resposta'));
    }
    return;
  }

  if (!token) {
    /* Falar alto aqui foi decisao consciente: este caminho ja falhou em
       silencio duas vezes (TDZ, e refresh vencido) e nos dois casos o
       sintoma foi identico — nada acontece, nenhum sinal. */
    console.log('[xyven] sem token para ' + state.account + ' (renovacao falhou)');

    /* Nao poder CONFIRMAR quem voce e nao e o mesmo que voce nao ser
       nada. Sem este cache, uma renovacao que falha derruba o dev na
       hora, e a pessoa acha que so relogando resolve. */
    const g = lerCacheConta(state.account);
    if (g) {
      contaRemota = g;
      aplicarConta(g);
      console.log('[xyven] usando o cache da ultima vez: grupo=' + g.grupo +
        ' cargos=[' + (g.cargos || []).join(',') + ']');
    }
    return;
  }

  /* Renovar o token preencheu o contaMS, e e nele que vem o catalogo
     COMPLETO de capas da Mojang. No boot ele e null, e carregarCapas
     ja tinha rodado pelo caminho publico, que so conhece a capa ativa
     — por isso aparecia uma so, como "CAPA DA CONTA". */
  if (contaMS && contaMS.nick === deQuem) {
    await carregarCapas(deQuem);
    if (deQuem === state.account && !$('#skinOverlay').hidden) renderSkinEditor();
  }

  const r = await window.api.xyven.identificar(token).catch(() => null);
  if (deQuem !== state.account) return;
  if (r && r.ok) {
    avisarNovidades(lerCacheConta(deQuem), r.dados);
    mostrarAviso(r.dados.aviso);
    contaRemota = r.dados;
    gravarCacheConta(r.dados.nick, r.dados);
    aplicarConta(r.dados);
    console.log('[xyven] ' + r.dados.nick + ': grupo=' + r.dados.grupo +
      ' cargos=[' + (r.dados.cargos || []).join(',') + ']' +
      ' capas=[' + (r.dados.capas || []).join(',') + ']');
    return;
  }

  console.log('[xyven] a API nao respondeu: ' + ((r && r.erro) || 'erro desconhecido'));
  /* servidor fora do ar: usa o que sabiamos da ultima vez */
  const guardado = lerCacheConta(state.account);
  if (guardado) {
    contaRemota = guardado;
    aplicarConta(guardado);
    console.log('[xyven] usando o cache local.');
  }
}

/* ============================================================
   TERMINAL DO DEV

   Substituiu o painel de cargos com cliques. A ideia é a mesma
   coisa, digitada — e digitada escala melhor: dar um cargo pra
   dez contas era dez idas ao mouse.

   TUDO AQUI É LOCAL. O `members` mora no localStorage desta
   máquina, então mudar o cargo de outra pessoa muda só a SUA
   cópia — no launcher dela nada acontece. Não há canal entre
   os dois hoje.

   Por isso a camada de dados está isolada em `dadosDev`: no dia
   que existir um servidor, só estas funções mudam de dentro. Os
   comandos que você digita continuam idênticos.
   ============================================================ */
const dadosDev = {
  listar: () => members.slice(),
  achar: (nick) => memberOf(nick),
  criar(nick) {
    members.push({ nick: nick, group: 'player', badges: [] });
    this.gravar();
  },
  remover(nick) {
    const alvo = String(nick).toLowerCase();
    members = members.filter((m) => m.nick.toLowerCase() !== alvo);
    this.gravar();
  },
  restaurar() {
    members = freshMembers();
    try { localStorage.removeItem('xyven.members'); } catch (e) { /* sem storage */ }
    this.gravar();
  },
  /* qualquer mudança passa por aqui: grava e repinta o que depende */
  gravar() {
    saveMembers();
    applyGroup();
    renderProfile();
    renderAccounts();
  }
};

/* ---- saída ---- */
/* Linha com um quadradinho da cor na frente.

   O termLinha normal usa textContent de proposito — tudo que entra no
   terminal e texto de fora e nao pode virar HTML. Aqui a cor nao vem
   do usuario: vem de CORES_CARGO, que so tem token do tema. Por isso
   monto os elementos na mao em vez de aceitar uma string de estilo. */
function termCor(token, texto) {
  const out = $('#termOut'); if (!out) return;
  const def = CORES_CARGO[token]; if (!def) return;

  const linha = document.createElement('div');
  linha.style.display = 'flex';
  linha.style.alignItems = 'center';
  linha.style.gap = '10px';

  const amostra = document.createElement('span');
  amostra.style.width = '30px';
  amostra.style.height = '14px';
  amostra.style.flex = 'none';
  /* 2px como as molduras internas de imagem do tema; o contorno e o
     que separa a amostra `sand` do fundo, que e quase a mesma cor */
  amostra.style.border = '2px solid var(--ink)';
  amostra.style.background = def.bg;

  const rotulo = document.createElement('span');
  rotulo.textContent = texto;

  linha.appendChild(amostra);
  linha.appendChild(rotulo);
  out.appendChild(linha);
  out.scrollTop = out.scrollHeight;
}

function termLinha(texto, classe) {
  const out = $('#termOut'); if (!out) return;
  const d = document.createElement('div');
  if (classe) d.className = 'term__l--' + classe;
  d.textContent = texto;
  out.appendChild(d);
  out.scrollTop = out.scrollHeight;
}
const termOk = (t) => termLinha(t);
const termErro = (t) => termLinha(t, 'erro');
const termDim = (t) => termLinha(t, 'dim');

/* Espelho do catalogo do servidor (_shared/perms.ts). Existe aqui so
   pra o /perms list poder explicar cada uma sem ida a rede; quem
   recusa de verdade e o servidor, que tem a lista de verdade. */
const PERMISSOES = [
  ['*',              'tudo, inclusive o que for criado depois'],
  ['terminal',       'abrir o terminal (Ctrl+Shift+E)'],
  ['gift',           'dar e tirar cargo e capa'],
  ['title',          'mandar recado pra alguém'],
  ['cargos',         'criar, editar e apagar cargo'],
  ['posts.escrever', 'escrever e editar no mural'],
  ['posts.fixar',    'fixar e destacar postagem'],
  ['posts.apagar',   'apagar postagem'],
  ['loja',           'criar item e categoria na loja'],
  ['musica',         'abrir o tocador e pesquisar musica']
];
const CORES_VALIDAS = ['teal', 'salmon', 'mustard', 'sand', 'ink', 'red', 'muted', 'paper'];

/* ------------------------------------------------------------
   Lista de alvos separada por virgula

     /gift add Ny3san, Alaninha, _xvu caveira
     /title Ny3san, Alaninha &4Oi | &ctudo bem?

   O terminal ja quebrou a linha em espacos, entao a virgula chega
   grudada no nick ("Ny3san,"). Aqui os pedacos sao remontados.

   Para no primeiro que NAO parece nick. Sem essa checagem, uma
   virgula dentro do texto do /title ("&4Ola, pessoal") faria "&4Ola"
   virar alvo — e o recado ia pra um nick que nao existe em vez de
   pra quem devia.
   ------------------------------------------------------------ */
/* NICK_OK ja existe la em cima, no cadastro de conta pirata: a regra
   do que e um nick valido e a mesma, e duas copias divergiriam. */
function lerNicks(a) {
  const nicks = [];
  let i = 0;

  while (i < a.length) {
    const bruto = String(a[i]);
    /* "Ny3san,Alaninha" sem espaco e um pedaco so pro terminal, mas
       sao dois nicks. Por isso corta a virgula DENTRO do pedaco, e
       nao so a do fim. */
    const partes = bruto.split(',');
    const seguiu = bruto.endsWith(',');

    /* junta antes de aceitar: se qualquer parte nao parecer nick, o
       pedaco inteiro volta pro resto, sem deixar metade pra tras */
    const candidatos = [];
    let presta = true;
    for (const parte of partes) {
      const nick = parte.trim();
      if (!nick) continue;                    /* virgula dupla ou solta */
      if (!NICK_OK.test(nick)) { presta = false; break; }
      candidatos.push(nick);
    }
    if (!presta) break;

    nicks.push(...candidatos);
    i++;
    if (!seguiu) break;                       /* sem virgula no fim, acabou */
  }

  /* sem repetir: /gift add Ny3san, Ny3san mandaria duas vezes */
  const vistos = new Set();
  const unicos = nicks.filter((x) => {
    const k = x.toLowerCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return { nicks: unicos, resto: a.slice(i) };
}

const idsDeCargo = () => ALL_BADGES.map((b) => b.id);
const idsDeCapa = () => CAPAS_XYVEN.map((c) => c.id);
/* o servidor aceita cargo e capa no mesmo comando; o terminal precisa
   conhecer os dois, senao recusa antes mesmo de perguntar */
const ehItemValido = (x) => idsDeCargo().includes(x) || idsDeCapa().includes(x);
const listaDeItens = () => 'cargos: ' + idsDeCargo().join(', ') + ' · capas: ' + idsDeCapa().join(', ');

function descreverMembro(m) {
  const cargos = m.badges.length ? m.badges.join(', ') : '—';
  return '  ' + m.nick.padEnd(18) + cargos;
}

/* ---- comandos ----

   Tudo que é sobre conta ficou sob /account, com subcomando. Antes
   eram cinco comandos soltos (/contas, /delconta, /info, /buscar,
   /grupo) que só se distinguiam por decorar o nome de cada um.
   ---- */
const COMANDOS = [
  {
    nome: 'help', uso: '/help', ajuda: 'mostra esta lista',
    roda: () => {
      termOk('comandos:');
      COMANDOS.forEach((c) => termOk('  ' + c.uso.padEnd(34) + c.ajuda));
      termDim('');
      termDim('exemplos:');
      termDim('  /gift add Fulano caveira        dá a capa; se ele nunca entrou,');
      termDim('                                  fica guardado até entrar');
      termDim('  /gift remove Fulano pro');
      termDim('  /gift add Fulano dev            dá o cargo, e com ele o poder');
      termDim('  /cargo create vip VIP mustard title gift');
      termDim('                                  cria o cargo e o que ele libera');
      termDim('  /title Fulano &e&lANÚNCIO! | &aVocê recebeu um vip!!');
      termDim('');
      termDim('cores: &0-&9 &a-&f · &l negrito &o itálico &n sublinhado &m riscado &r reseta');
      termDim('');
      termDim(listaDeItens());
      termDim('cargo é etiqueta E permissão: /cargo list · /perms list · /color help');
    }
  },
  {
    nome: 'gift', uso: '/gift add|remove <nick[, nick...]> <item>',
    ajuda: 'dá ou tira cargo e capa',
    roda: async (a) => {
      const acao = String(a[0] || '').toLowerCase();
      if (acao !== 'add' && acao !== 'remove') {
        return termErro('uso: /gift add <nick> <item>   ou   /gift remove <nick> <item>');
      }

      const { nicks, resto } = lerNicks(a.slice(1));
      const item = String(resto[0] || '').toLowerCase();
      if (!nicks.length || !item) {
        termErro('uso: /gift ' + acao + ' <nick> <item>');
        return termDim('vários de uma vez: /gift add Ny3san, Alaninha, _xvu caveira');
      }
      if (!ehItemValido(item)) return termErro('"' + item + '" não existe. ' + listaDeItens());

      const token = await tokenAtual();

      /* ---- com conta original: vale pra todo mundo ---- */
      if (token && window.api.xyven) {
        let feitos = 0;
        let mexeuEmMim = false;

        /* um de cada vez, de proposito: em paralelo o servidor leria e
           gravaria a mesma lista de cargos ao mesmo tempo quando dois
           alvos fossem a mesma linha, e uma das escritas se perderia */
        for (const alvo of nicks) {
          const r = await window.api.xyven.gift(token, alvo, item, acao === 'add' ? 'dar' : 'tirar')
            .catch(() => null);

          if (!r || !r.ok) {
            termErro(alvo + ': ' + ((r && r.erro) || 'não consegui falar com a API.'));
            if (r && r.fora) break;   /* API fora: nao adianta insistir nos outros */
            continue;
          }

          const d = r.dados;
          feitos++;
          if (d.pendente) {
            termOk(acao === 'add'
              ? item + ' guardado para ' + d.nick + ' (ainda não entrou).'
              : item + ' tirado da espera de ' + d.nick + '.');
          } else if (acao === 'add') {
            termOk(d.nick + (d.jaTinha ? ' já tinha ' : ' recebeu ') + item + '.');
          } else {
            termOk(item + (d.naoTinha ? ' já não estava em ' : ' saiu de ') + d.nick + '.');
          }
          if (String(d.nick).toLowerCase() === String(state.account).toLowerCase()) mexeuEmMim = true;
        }

        if (nicks.length > 1) termDim(feitos + ' de ' + nicks.length + ' contas.');
        if (feitos) termDim('vale em qualquer PC — quem estiver com o launcher aberto vê na hora.');
        if (mexeuEmMim) sincronizarConta();
        return;
      }

      /* ---- sem conta original: só o que é local ---- */
      if (idsDeCapa().includes(item)) {
        return termErro('capa só com conta original logada — ela mora no servidor.');
      }
      for (const alvo of nicks) {
        const m = dadosDev.achar(alvo);
        if (!m) { termErro('não conheço "' + alvo + '" e não há sessão pra consultar o servidor.'); continue; }
        if (acao === 'add') {
          if (m.badges.includes(item)) { termDim(m.nick + ' já tem ' + item + '.'); continue; }
          m.badges.push(item);
        } else {
          if (!m.badges.includes(item)) { termDim(m.nick + ' não tem ' + item + '.'); continue; }
          m.badges = m.badges.filter((x) => x !== item);
        }
        termOk(m.nick + (acao === 'add' ? ' recebeu ' : ' perdeu ') + item + '.');
      }
      dadosDev.gravar();
      termDim('sem conta original logada: isto valeu só nesta máquina.');
    }
  },
  {
    nome: 'update', uso: '/update <id da postagem>', ajuda: 'mostra a postagem pra todo mundo',
    roda: async (a) => {
      const id = Number(a[0]);
      if (!id) {
        termErro('uso: /update <id da postagem>');
        return termDim('o id de cada postagem sai no /posts');
      }

      const token = await tokenAtual();
      if (!token || !window.api.xyven) {
        return termErro('precisa de conta original logada — isso vai pro servidor.');
      }
      const r = await window.api.xyven.post(token, { acao: 'anunciar', id }).catch(() => null);
      if (!r || !r.ok) return termErro((r && r.erro) || 'não consegui falar com a API.');

      termOk('"' + r.dados.titulo + '" foi pra todo mundo.');
      termDim('quem está com o launcher aberto vê na hora; o resto, ao abrir.');
      sincronizarConta();
    }
  },
  {
    nome: 'posts', uso: '/posts', ajuda: 'lista as postagens com o id',
    roda: () => {
      if (!posts.length) return termDim('nenhuma postagem ainda.');
      posts.forEach((p) => {
        const marcas = (p.pinned ? 'fixada ' : '') + (p.featured ? 'início ' : '') +
                       ((p.secoes || []).length ? (p.secoes.length + ' seções') : '');
        termOk('  #' + String(p.id).padEnd(6) + p.title.slice(0, 40).padEnd(42) + marcas);
      });
      termDim(posts.length + ' postagens   ·   /update <id> manda pra todo mundo');
    }
  },
  {
    nome: 'title', uso: '/title <nick[, nick...]> <título> | <descrição>',
    ajuda: 'recado pra uma ou várias pessoas',
    roda: async (a) => {
      const { nicks, resto } = lerNicks(a);
      const tudo = resto.join(' ');
      if (!nicks.length || !tudo.trim()) {
        termErro('uso: /title <nick> <título> | <descrição>');
        termDim('exemplo: /title Fulano &e&lANÚNCIO! | &aVocê recebeu um vip!!');
        return termDim('vários: /title Ny3san, Alaninha &e&lANÚNCIO! | &aleiam isso');
      }
      /* o | separa porque os dois lados tem espaco; sem ele, nao
         haveria como saber onde o titulo acaba */
      const corte = tudo.indexOf('|');
      const titulo = (corte >= 0 ? tudo.slice(0, corte) : tudo).trim();
      const texto = corte >= 0 ? tudo.slice(corte + 1).trim() : '';
      if (!titulo) return termErro('falta o título antes do |.');

      const token = await tokenAtual();
      if (!token || !window.api.xyven) {
        return termErro('precisa de conta original logada — o recado vai pro servidor.');
      }
      let feitos = 0;
      let mexeuEmMim = false;

      /* um de cada vez, como no /gift: cada recado e uma linha nova e o
         servidor carimba a campainha do alvo depois de gravar */
      for (const alvo of nicks) {
        const r = await window.api.xyven.title(token, alvo, titulo, texto).catch(() => null);
        if (!r || !r.ok) {
          termErro(alvo + ': ' + ((r && r.erro) || 'não consegui falar com a API.'));
          if (r && r.fora) break;
          continue;
        }
        feitos++;
        termOk('recado enviado pra ' + r.dados.nick + ' (#' + r.dados.aviso.id + ').');
        if (String(r.dados.nick).toLowerCase() === String(state.account).toLowerCase()) {
          mexeuEmMim = true;
        }
      }

      if (nicks.length > 1) termDim(feitos + ' de ' + nicks.length + ' contas.');
      if (feitos) termDim('quem estiver com o launcher aberto vê na hora; quem nunca entrou, ao entrar.');
      /* mandou pra si mesmo: busca agora em vez de esperar o boot */
      if (mexeuEmMim) sincronizarConta();
    }
  },
  {
    nome: 'account', uso: '/account <sub>', ajuda: 'list · info · find · group · remove',
    roda: async (a) => {
      const sub = String(a[0] || '').toLowerCase();
      const arg = a.slice(1);

      if (sub === 'list') {
        CONFIG.accounts.forEach((c) => {
          const ativa = c.name.toLowerCase() === String(state.account).toLowerCase();
          termOk('  ' + (ativa ? '* ' : '  ') + c.name.padEnd(18) + c.type);
        });
        return termDim(CONFIG.accounts.length + ' no launcher   (* = ativa)');
      }

      if (sub === 'find') {
        if (!arg[0]) return termErro('uso: /account find <nick>');
        const q = arg[0].toLowerCase();
        const achou = dadosDev.listar().filter((m) => m.nick.toLowerCase().includes(q));
        if (!achou.length) return termDim('nada com "' + arg[0] + '" no que este launcher conhece.');
        return achou.forEach((m) => termOk(descreverMembro(m)));
      }

      if (sub === 'info') {
        if (!arg[0]) return termErro('uso: /account info <nick>');
        /* o servidor sabe mais que a lista local; pergunta a ele */
        if (temApi() && window.api.xyven) {
          const r = await window.api.xyven.consultar(arg[0]).catch(() => null);
          if (r && r.ok) {
            const d = r.dados;
            termOk('nick   ' + d.nick);
            termOk('cargos ' + ((d.cargos || []).join(', ') || '—'));
            termOk('capas  ' + ((d.capas || []).join(', ') || '—'));
            if (d.pendente) termDim('há coisa esperando: essa conta ainda não entrou no launcher.');
            return;
          }
        }
        const m = dadosDev.achar(arg[0]);
        if (!m) return termErro('não conheço "' + arg[0] + '".');
        termOk('nick   ' + m.nick);
        return termOk('cargos ' + (m.badges.join(', ') || '—'));
      }

      if (sub === 'group') {
        /* Grupo nao existe mais.

           Antes havia dois conceitos: `grupo` (player/dev) mandava no
           que a pessoa podia, e `cargos` era so etiqueta. Ninguem
           entendia por que ter a tag DEV nao dava acesso a nada. Agora
           e um so — dar o cargo E dar o poder. */
        termErro('grupo não existe mais: quem manda é o cargo.');
        termDim('pra dar poder a alguém, dê um cargo que carregue a permissão:');
        termDim('  /gift add ' + (arg[0] || '<nick>') + ' dev        dá tudo');
        termDim('  /cargo list                      vê o que cada cargo carrega');
        return;
      }

      if (sub === 'remove') {
        if (!arg[0]) return termErro('uso: /account remove <nick>   (veja em /account list)');
        const conta = acharConta(arg[0]);
        if (!conta) return termErro('"' + arg[0] + '" não está logada neste launcher.');

        /* as mesmas travas do botão de remover conta */
        if (CONFIG.accounts.length <= 1) return termErro('é a única conta. adicione outra antes.');
        if (jogoAberto || jogoAbrindo) return termErro('feche o Minecraft antes de remover conta.');

        const alvo = conta.name;
        if (temApi() && window.api.auth) {
          try { await window.api.auth.esquecer(alvo); } catch (e) { /* não havia token */ }
        }
        if (contaMS && contaMS.nick === alvo) contaMS = null;

        CONFIG.accounts = CONFIG.accounts.filter((c) => c.name !== alvo);
        if (String(state.account).toLowerCase() === alvo.toLowerCase()) {
          state.account = CONFIG.accounts[0].name;
          profile.nick = state.account; profile.skin = state.account;
          capasDaConta = []; contaEhPremium = false;
          termDim('era a conta ativa; troquei pra ' + state.account + '.');
        }
        saveAccounts(); saveProfile();
        applyGroup(); renderStats(); renderProfile(); renderAccounts();
        return termOk(alvo + ' saiu do launcher. o token guardado dela foi apagado.');
      }

      termErro('subcomando desconhecido.');
      termDim('use: /account list | info <nick> | find <nick> | group <nick> <grupo> | remove <nick>');
    }
  },
  {
    nome: 'cargo', uso: '/cargo <sub>', ajuda: 'list · info · create · edit · perm · delete',
    roda: async (a) => {
      const sub = String(a[0] || '').toLowerCase();
      const arg = a.slice(1);

      if (!sub || sub === 'list') {
        ALL_BADGES.forEach((b) => {
          const perms = (b.permissoes || []).join(', ') || '—';
          termOk('  ' + b.id.padEnd(12) + String(b.label).padEnd(14) +
                 String(b.cor || 'sand').padEnd(9) + perms);
        });
        termDim(ALL_BADGES.length + ' cargos   (id · nome · cor · permissões)');
        termDim('capas: ' + idsDeCapa().join(', ') + '  — capa não é cargo, vem no launcher');
        return;
      }

      if (sub === 'info') {
        if (!arg[0]) return termErro('uso: /cargo info <id>');
        const b = ALL_BADGES.find((x) => x.id === String(arg[0]).toLowerCase());
        if (!b) return termErro('não existe cargo "' + arg[0] + '".');
        termOk('id     ' + b.id);
        termOk('nome   ' + b.label);
        termOk('cor    ' + (b.cor || 'sand'));
        termOk('perms  ' + ((b.permissoes || []).join(', ') || '—'));
        const donos = dadosDev.listar().filter((m) => m.badges.includes(b.id));
        return termDim(donos.length ? 'quem tem: ' + donos.map((m) => m.nick).join(', ')
                                    : 'ninguém tem este cargo neste launcher.');
      }

      if (sub === 'create' || sub === 'edit') {
        if (!arg[0]) return termErro('uso: /cargo ' + sub + ' <id> <nome> <cor> [permissões...]');
        const id = String(arg[0]).toLowerCase();

        /* nome, cor e permissoes sao opcionais no edit: mandar so o que
           muda evita apagar sem querer o que nao foi citado */
        const resto = arg.slice(1);
        const cor = resto.find((x) => CORES_VALIDAS.includes(String(x).toLowerCase()));
        const perms = resto.filter((x) => String(x).includes('.') || x === '*' ||
                                          PERMISSOES.some((pp) => pp[0] === x));
        const nome = resto.find((x) => x !== cor && !perms.includes(x));

        const ruim = perms.find((x) => !PERMISSOES.some((pp) => pp[0] === x));
        if (ruim) return termErro('permissão "' + ruim + '" não existe. veja /perms list.');

        const corpo = { acao: sub === 'create' ? 'criar' : 'editar', id };
        if (nome !== undefined) corpo.nome = nome;
        if (cor !== undefined) corpo.cor = cor;
        if (perms.length || sub === 'create') corpo.permissoes = perms;

        const token = await tokenAtual();
        if (!token || !window.api.xyven) {
          return termErro('precisa de conta original logada — cargo mora no servidor.');
        }
        const r = await window.api.xyven.cargo(token, corpo).catch(() => null);
        if (!r || !r.ok) return termErro((r && r.erro) || 'não consegui falar com a API.');

        const c = r.dados.cargo;
        termOk(c.nome + ' (' + c.id + ') ' + (sub === 'create' ? 'criado' : 'atualizado') + '.');
        termDim('cor ' + c.cor + ' · permissões: ' + ((c.permissoes || []).join(', ') || 'nenhuma'));
        await carregarCargos();
        sincronizarConta();
        return;
      }

      if (sub === 'perm') {
        const modo = String(arg[0] || '').toLowerCase();
        const alvoId = String(arg[1] || '').toLowerCase();
        const perm = String(arg[2] || '');
        if ((modo !== 'add' && modo !== 'remove') || !alvoId || !perm) {
          termErro('uso: /cargo perm add|remove <cargo> <permissão>');
          return termDim('exemplo: /cargo perm remove vip posts.apagar');
        }
        if (!PERMISSOES.some((pp) => pp[0] === perm)) {
          return termErro('permissão "' + perm + '" não existe. veja /perms list.');
        }

        const token = await tokenAtual();
        if (!token || !window.api.xyven) {
          return termErro('precisa de conta original logada — cargo mora no servidor.');
        }
        const r = await window.api.xyven
          .cargo(token, { acao: 'perm', id: alvoId, modo, permissao: perm })
          .catch(() => null);
        if (!r || !r.ok) return termErro((r && r.erro) || 'não consegui falar com a API.');

        const d = r.dados;
        if (d.jaTinha) return termDim(alvoId + ' já tinha ' + perm + '.');
        if (d.naoTinha) return termDim(alvoId + ' não tinha ' + perm + '.');

        termOk(perm + (modo === 'add' ? ' entrou em ' : ' saiu de ') + alvoId + '.');
        termDim('agora: ' + ((d.cargo.permissoes || []).join(', ') || 'nenhuma'));
        await carregarCargos();
        sincronizarConta();
        return;
      }

      if (sub === 'delete') {
        if (!arg[0]) return termErro('uso: /cargo delete <id>');
        const id = String(arg[0]).toLowerCase();
        if (!await perguntar('apagar o cargo "' + id + '"? quem tem perde na hora.', 'Apagar cargo')) return;

        const token = await tokenAtual();
        if (!token || !window.api.xyven) {
          return termErro('precisa de conta original logada — cargo mora no servidor.');
        }
        const r = await window.api.xyven.cargo(token, { acao: 'apagar', id }).catch(() => null);
        if (!r || !r.ok) return termErro((r && r.erro) || 'não consegui falar com a API.');

        termOk('cargo ' + id + ' apagado.');
        if (r.dados.tirados) termDim('tirado de ' + r.dados.tirados + ' conta(s).');
        await carregarCargos();
        sincronizarConta();
        return;
      }

      termErro('subcomando desconhecido.');
      termDim('use: /cargo list | info <id> | create <id> <nome> <cor> [perms] | edit | delete');
      termDim('     /cargo perm add|remove <id> <permissão>   mexe numa só');
      termDim('cores: ' + CORES_VALIDAS.join(', ') + '   (/color help mostra cada uma)');
    }
  },
  {
    nome: 'color', uso: '/color help', ajuda: 'mostra as cores de cargo',
    roda: (a) => {
      const sub = String(a[0] || 'help').toLowerCase();
      if (sub !== 'help' && sub !== 'list') return termErro('uso: /color help');

      /* Onde cada uma ja e usada no tema. Serve de referencia: escolher
         `salmon` pra um cargo qualquer faz ele competir com o TOCAR. */
      const ONDE = {
        teal:    'barras e toggle ligado',
        salmon:  'TOCAR e item ativo do rail',
        mustard: 'hover e selecionado',
        sand:    'rail e sidebar',
        ink:     'contorno e texto',
        red:     'destrutivo (remover conta)',
        muted:   'texto secundário',
        paper:   'fundo de card'
      };
      CORES_VALIDAS.forEach((c) => termCor(c, c.padEnd(9) + (ONDE[c] || '')));
      termDim('');
      termDim('são as do tema, e mudam junto no modo escuro — por isso não há hex.');
      termDim('cor nova exige token novo no tema; isso é decisão de quem faz o design.');
      termDim('uso: /cargo create vip VIP mustard title');
    }
  },
  {
    nome: 'perms', uso: '/perms list', ajuda: 'lista as permissões que existem',
    roda: (a) => {
      const sub = String(a[0] || 'list').toLowerCase();
      if (sub !== 'list') return termErro('uso: /perms list');
      PERMISSOES.forEach(([id, oque]) => termOk('  ' + id.padEnd(16) + oque));
      termDim('');
      termDim('as suas: ' + (permissoesAtuais.join(', ') || 'nenhuma'));
      termDim('permissão vive no cargo: /cargo create vip VIP mustard title gift');
      termDim('tirar uma sem mexer nas outras: /cargo perm remove vip gift');
    }
  },
  {
    nome: 'limpar', uso: '/limpar', ajuda: 'limpa a tela',
    roda: () => { $('#termOut').innerHTML = ''; }
  }
];

/* ---- interpretador ---- */
function rodarComando(linha) {
  /* a barra é opcional: quem vem do Minecraft digita com, quem vem
     de terminal digita sem. aceitar os dois evita atrito à toa. */
  const limpo = linha.trim().replace(/^\//, '');
  if (!limpo) return;
  const partes = limpo.split(/\s+/);
  const nome = partes[0].toLowerCase();
  const args = partes.slice(1);

  const cmd = COMANDOS.find((c) => c.nome === nome);
  if (!cmd) {
    termErro('não conheço "' + nome + '".');
    /* sugere o mais parecido em vez de só reclamar */
    const perto = COMANDOS.find((c) => c.nome.startsWith(nome.slice(0, 3)));
    termDim(perto ? 'você quis dizer /' + perto.nome + '?' : 'digite /help pra ver a lista.');
    return;
  }
  /* alguns comandos são async (delconta apaga token no disco).
     await num retorno não-promessa é inofensivo, então trata igual. */
  Promise.resolve()
    .then(() => cmd.roda(args))
    .catch((e) => termErro('o comando quebrou: ' + (e && e.message ? e.message : String(e))));
}

/* ---- entrada, com histórico ---- */
const termHist = [];
let termHistPos = -1;

function abrirTerminal() {
  const out = $('#termOut');
  if (out && !out.childElementCount) {
    termDim('terminal do Xyven');
    termDim(contaRemota
      ? 'ligado ao servidor como ' + contaRemota.nick +
        ' (' + ((contaRemota.cargos || []).join(', ') || 'sem cargo') + '). /help pra começar.'
      : 'sem conta original logada: os comandos valem só nesta máquina. /help pra começar.');
    termDim('');
  }
  open($('#devOverlay'));
  setTimeout(() => { const i = $('#termIn'); if (i) i.focus(); }, 30);
}

/* ------------------------------------------------------------
   MANTER O FOCO NO CAMPO

   O foco era dado uma vez so, ao abrir. Bastava clicar na area de
   saida, um aviso abrir por cima ou alternar de janela pra digitacao
   parar de ir a lugar nenhum — e a unica saida era acertar o clique
   no campo, que e uma faixa fina no rodape.
   ------------------------------------------------------------ */
const terminalAberto = () => {
  const ov = $('#devOverlay');
  return !!ov && !ov.hidden;
};

const focarTerminal = () => {
  const i = $('#termIn');
  if (i && terminalAberto()) i.focus();
};

if ($('#devOverlay')) {
  /* clicar em qualquer lugar do painel volta pro campo, como num
     terminal de verdade. mouseup e nao click: em click a selecao
     ainda nao terminou, e roubar o foco no meio cancela o arraste. */
  $('#devOverlay').addEventListener('mouseup', (e) => {
    /* selecionou texto pra copiar: deixa quieto */
    const sel = window.getSelection();
    if (sel && String(sel).length) return;
    /* clicou num botao ou noutro campo: o alvo e ele, nao o terminal */
    if (e.target.closest('button, a, input, textarea, select')) return;
    focarTerminal();
  });
}

/* Comecou a digitar com o foco perdido: em vez de engolir a tecla,
   leva o foco pro campo e escreve a letra la. Sem isto a primeira
   letra sumia e a pessoa achava que o teclado tinha travado. */
document.addEventListener('keydown', (e) => {
  if (!terminalAberto()) return;
  const alvo = document.activeElement;
  if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const i = $('#termIn');
  if (!i) return;
  i.focus();
  if (e.key.length === 1) { i.value += e.key; e.preventDefault(); }
});

/* voltou pro launcher com o terminal aberto: o foco volta junto */
window.addEventListener('focus', focarTerminal);

if ($('#termIn')) {
  $('#termIn').addEventListener('keydown', (e) => {
    const campo = e.target;
    if (e.key === 'Enter') {
      const linha = campo.value;
      campo.value = '';
      if (!linha.trim()) return;
      termLinha('> ' + linha, 'eco');
      termHist.unshift(linha);
      termHistPos = -1;
      rodarComando(linha);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (termHistPos + 1 < termHist.length) campo.value = termHist[++termHistPos];
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (termHistPos > 0) campo.value = termHist[--termHistPos];
      else { termHistPos = -1; campo.value = ''; }
    }
  });
}

/* ============================================================
   10.e NOTIFICAções — o sino apita quando a conta ativa ganha cargo
   ============================================================ */
let notifs;
try { notifs = JSON.parse(localStorage.getItem('xyven.notifs') || '[]'); } catch (e) { notifs = []; }
const saveNotifs = () => { try { localStorage.setItem('xyven.notifs', JSON.stringify(notifs)); } catch (e) { /* sem storage */ } };

function whenLabel(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  return 'há ' + Math.round(h / 24) + ' d';
}

function renderNotifs() {
  const unread = notifs.filter(n => !n.read).length;
  $('#bellDot').hidden = unread === 0;

  $('#notifList').innerHTML = notifs.length
    ? notifs.map(n => {
        const b = ALL_BADGES.find(x => x.id === n.badge);
        const selo = b ? b.label.slice(0, 4) : (n.acao === 'atualizar' ? 'NOVA' : '—');
        const fundo = b ? b.bg : (n.acao === 'atualizar' ? 'var(--teal)' : 'var(--sand)');
        const tinta = b ? b.fg : (n.acao === 'atualizar' ? 'var(--on-accent)' : 'var(--ink)');
        return `<div class="notif__item ${n.read ? '' : 'is-new'}${n.acao ? ' is-clicavel' : ''}"${n.acao ? ' data-acao="' + n.acao + '"' : ''}>
          <span class="notif__mark" style="background:${fundo};color:${tinta}">${selo}</span>
          <span class="notif__txt">${n.text}<span class="notif__when">${whenLabel(n.ts)}</span></span>
        </div>`;
      }).join('')
    : '<div class="notif__empty">nada por aqui. quando você ganhar um cargo, o sino apita.</div>';
}

function ringBell() {
  const btn = $('#bellBtn');
  btn.classList.remove('bell--ring');
  void btn.offsetWidth;            /* reinicia a animação */
  btn.classList.add('bell--ring');
}

/* chamada quando um cargo entra ou sai da conta ativa */
function notifyBadge(badgeId, gained) {
  const b = ALL_BADGES.find(x => x.id === badgeId); if (!b) return;
  notifs.unshift({
    ts: Date.now(), read: false, badge: badgeId,
    text: gained
      ? '<b>' + b.label + '</b><br>você recebeu um cargo novo no client.'
      : '<b>' + b.label + '</b><br>este cargo saiu da sua conta.'
  });
  notifs = notifs.slice(0, 30);
  saveNotifs(); renderNotifs(); ringBell();
}

$('#bellBtn').onclick = (e) => {
  e.stopPropagation();
  const p = $('#notifPanel');
  p.hidden = !p.hidden;
  if (!p.hidden) {
    close($('#accountMenu'));
    notifs.forEach(n => { n.read = true; });
    saveNotifs(); renderNotifs();
  }
};

$('#notifClear').onclick = () => { notifs = []; saveNotifs(); renderNotifs(); };

/* a notificação de versão nova leva direto ao lugar de atualizar — mandar
   a pessoa procurar o caminho sozinha é o que ela ja teria feito sem aviso */
$('#notifList').addEventListener('click', (e) => {
  if (!e.target.closest('[data-acao="atualizar"]')) return;
  $('#notifPanel').hidden = true;
  open($('#settingsOverlay')); renderJava(); renderMemory();
  /* $$ devolve NodeList, que nao tem .find — espalhar antes */
  const aba = [...$$('.tab')].find((t) => t.dataset.tab === 'launcher');
  if (aba) aba.click();
  /* ja dispara a verificação: quem veio pela notificação não deveria
     precisar clicar em VERIFICAR pra descobrir o que o aviso já disse */
  const botao = $('#btnAtualizar');
  if (botao && !modoAtualizar) botao.click();
});

document.addEventListener('click', (e) => {
  const p = $('#notifPanel');
  if (!p.hidden && !p.contains(e.target) && !$('#bellBtn').contains(e.target)) p.hidden = true;
});

/* boot das telas novas — depois dos blocos, senao pega TDZ */
/* Verificacao silenciosa no boot. Antes so existia o botao em Ajustes:
   quem nunca abrisse aquela aba jamais ficava sabendo que saiu versao
   nova. Agora o sininho avisa sozinho — uma vez por versao, senao viraria
   ruido a cada abertura do launcher. */
async function conferirAtualizacaoNoBoot() {
  if (!temApi() || !window.api.app || !window.api.app.atualizacao) return;
  let r;
  try { r = await window.api.app.atualizacao(); } catch (e) { return; }
  if (!r || !r.ok || !r.temNova || !r.ultima) return;

  let avisada = null;
  try { avisada = localStorage.getItem('xyven.avisoVersao'); } catch (e) { /* sem storage */ }
  if (avisada === r.ultima) return;
  try { localStorage.setItem('xyven.avisoVersao', r.ultima); } catch (e) { /* sem storage */ }

  notifs.unshift({
    ts: Date.now(), read: false,
    acao: 'atualizar',
    text: '<b>Saiu a versão ' + esc(r.ultima) + '</b><br>você está na ' + esc(r.atual) +
          '. clique aqui para atualizar.'
  });
  notifs = notifs.slice(0, 30);
  saveNotifs(); renderNotifs(); ringBell();
}

renderNotifs();
conferirAtualizacaoNoBoot();
/* primeira execucao: nao deixa usar sem conta */
if (!temConta()) setTimeout(() => exigirConta('Entrar para começar'), 400);
if (profile.nick !== state.account) { profile.nick = state.account; profile.skin = state.account; }
applyGroup(); renderProfile();

/* ============================================================
   Ultima linha de proposito.

   `sincronizarConta` depende de `contaMS` e `ehPirata`, declarados
   com const/let mais acima. Chamada la em cima, ela caía no TDZ —
   e como e async, o erro virava promessa rejeitada e sumia calada:
   a API simplesmente nunca era chamada, sem nenhum sinal.

   Aqui embaixo todo mundo ja existe. Continua sem await: se a API
   estiver dormindo no plano gratis, a tela nao pode esperar.
   ============================================================ */
sincronizarConta();

/* Servidor tocou a campainha (/gift ou /title em cima desta conta):
   refaz a consulta. Nao ha dado no evento — ele so diz "olha de novo".
   Assim a pessoa ve na hora, sem fechar o launcher nem trocar de conta. */
if (temApi() && window.api.xyven && window.api.xyven.aoMudar) {
  window.api.xyven.aoMudar(() => {
    console.log('[xyven] o servidor avisou que algo mudou; resincronizando');
    sincronizarConta();
  });
}

/* Aqui embaixo pelo mesmo motivo de sincronizarConta: carregarCargos
   mexe em ALL_BADGES e CORES_CARGO, declarados la pelo meio do
   arquivo. Chamada no boot do forum, caia no TDZ — e como e async, o
   erro virava promessa rejeitada: o app abria com "Cannot access 'Ns'
   before initialization" e nada dizia de onde vinha. */
carregarCargos();
carregarLoja();

/* ============================================================
   TOCADOR

   Quem toca e o player oficial do YouTube. O launcher so manda nele:
   play, pause, pular, e le o tempo pra desenhar a barra. Nao ha audio
   passando por aqui — e por isso que isto e permitido.

   O player NAO vive nesta pagina. Ele mora num iframe servido por
   http://127.0.0.1 (electron/tocador.ts), porque numa pagina file://
   o embed responde "Este vídeo não está disponível — código 152". A
   janela continua em file:// pra nao trocar a origem do localStorage,
   que levaria contas, servidores e tema junto.

   Como as origens sao diferentes, a conversa e por postMessage.

   Fica no fim do arquivo de proposito: usa tokenAtual, temApi e esc,
   todos declarados acima. Chamada antes da declaracao ja quebrou
   este arquivo duas vezes, e como e tudo async o erro sumia calado.
   ============================================================ */

/* Os numeros do YT.PlayerState. Escritos a mao porque a biblioteca do
   YouTube nao existe nesta pagina — ela esta do outro lado do iframe. */
const MUS_TOCANDO = 1;
const MUS_ACABOU = 0;

let musQuadro = null;      /* o <iframe> do tocador */
let musPronto = false;
let musEstado = -1;
let musFila = [];          /* o resultado da ultima busca */
let musIndice = -1;
let musAbrindo = null;     /* promessa unica: dois cliques nao criam dois iframes */
let musTotal = 0;          /* duracao da faixa, dita pelo iframe a cada 500ms */
/* Ja denunciadas nesta sessao. Uma sequencia de faixas bloqueadas
   virava uma denuncia por pulo, e cada uma faz o servidor perguntar
   pra Mojang de quem e o token — foi assim que apareceu o 429. */
const musDenunciadas = new Set();
let musArrastando = false; /* enquanto arrasta, o tempo do iframe e ignorado */
let musVolume = 70;
let musMudo = false;

const musMin = (seg) => {
  const s = Math.max(0, Math.floor(seg || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function musMandar(tipo, dados) {
  if (!musQuadro || !musQuadro.contentWindow) return;
  musQuadro.contentWindow.postMessage(Object.assign({ de: 'launcher', tipo }, dados || {}), '*');
}

/* Cria o iframe na primeira vez que alguem manda tocar. Nao no boot:
   quem nao usa o tocador nao carrega o player do YouTube. */
function abrirQuadro() {
  if (musPronto) return Promise.resolve();
  if (musAbrindo) return musAbrindo;

  musAbrindo = (async () => {
    if (!temApi() || !window.api.xyven || !window.api.xyven.urlTocador) {
      throw new Error('o tocador não está disponível aqui.');
    }
    const url = await window.api.xyven.urlTocador();
    musQuadro = document.createElement('iframe');
    musQuadro.setAttribute('allow', 'autoplay; encrypted-media');
    musQuadro.src = url;
    $('#musPlayer').appendChild(musQuadro);

    /* Espera o 'pronto' do outro lado. Sem isto o primeiro
       loadVideoById se perderia no vazio. */
    await new Promise((resolve) => {
      const espera = (e) => {
        if (!e.data || e.data.de !== 'tocador' || e.data.tipo !== 'pronto') return;
        window.removeEventListener('message', espera);
        musPronto = true;
        /* o player nasce em 100: aplica o que estava guardado antes
           que a primeira faixa comece, ou ela entra no volume errado */
        musMandar('volume', { valor: musMudo ? 0 : musVolume });
        resolve();
      };
      window.addEventListener('message', espera);
    });
  })();

  return musAbrindo;
}

window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.de !== 'tocador') return;

  if (m.tipo === 'tempo') {
    musTotal = m.total || 0;
    /* Enquanto o dedo esta na barra, quem manda e o dedo. Sem isto a
       barra voltava pro tempo real a cada 500ms e a bolinha brigava
       com o arraste. */
    if (musArrastando) return;
    $('#musAgora').textContent = musMin(m.agora);
    $('#musTotal').textContent = musMin(m.total);
    $('#musFill').style.width = (m.total ? (m.agora / m.total) * 100 : 0) + '%';
  }

  if (m.tipo === 'estado') {
    musEstado = m.estado;
    musBotaoPlay(m.estado === MUS_TOCANDO);
    /* acabou: emenda a proxima, como qualquer tocador */
    if (m.estado === MUS_ACABOU) musTocar(musIndice + 1);
  }

  if (m.tipo === 'erro') {
    /* Video bloqueado, removido, ou que o dono so deixa assistir no
       YouTube — o "Assistir no YouTube" no lugar do play.

       Sai da fila em vez de so pular: senao o "proxima" volta pra ele
       depois de dar a volta, e a pessoa fica presa num carrossel de
       videos que nao tocam. */
    const ruim = musIndice;
    const faixaRuim = musFila[ruim];
    $('#musNome').textContent = 'essa não deu — pulando';

    /* Conta pro servidor pra ninguem mais receber esta faixa numa
       busca. Sem await e sem tratar o erro: se a denuncia falhar, o
       pior que acontece e alguem tropecar nela de novo — nao vale
       segurar a proxima musica por causa disso. */
    const vale = faixaRuim && !musDenunciadas.has(faixaRuim.id) &&
      /* so o que o servidor aceita: 100 nao existe, 101 e 150 o dono
         proibiu. Mandar os outros era ida a rede pra receber um
         "ignorado" de volta. */
      [100, 101, 150].includes(m.codigo);

    if (vale && temApi() && window.api.xyven && window.api.xyven.musicaRuim) {
      musDenunciadas.add(faixaRuim.id);
      tokenAtual().then((t) => window.api.xyven.musicaRuim(t || '', faixaRuim.id, m.codigo))
        .catch(() => { /* denuncia e melhor-esforco */ });
    }
    setTimeout(() => {
      if (ruim >= 0 && ruim < musFila.length) musFila.splice(ruim, 1);
      musBotoes();
      if (!musFila.length) {
        $('#musNome').textContent = 'nenhuma dessas toca fora do YouTube';
        $('#musCanal').textContent = '';
        return;
      }
      /* o splice ja empurrou a seguinte pra este indice */
      musTocar(ruim);
    }, 1200);
  }
});

function musBotaoPlay(tocando) {
  const b = $('#musPlay');
  b.title = tocando ? 'Pausar' : 'Tocar';
  b.innerHTML = tocando
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"></path></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7L8 5Z"></path></svg>';
}

async function musTocar(i) {
  if (!musFila.length) return;
  /* da a volta nas duas pontas: "anterior" na primeira faixa vai pra
     ultima, em vez de nao fazer nada */
  const n = ((i % musFila.length) + musFila.length) % musFila.length;
  musIndice = n;
  const f = musFila[n];

  $('#musNome').textContent = f.titulo;
  $('#musCanal').textContent = f.canal;

  try { await abrirQuadro(); }
  catch (err) { $('#musNome').textContent = err.message; return; }

  $('#musVazio').hidden = true;
  musMandar('carregar', { id: f.id });
  /* O parar so liga quando existe player, e o player acabou de nascer
     aqui dentro. Sem esta linha ele continuava apagado depois de
     tocar pelo dado ou pela lista — e o botao "as vezes nao
     funcionava" era isso: estava desabilitado. */
  musBotoes();
}

function musBotoes() {
  const tem = musFila.length > 0;
  $('#musAnt').disabled = !tem;
  $('#musProx').disabled = !tem;
  $('#musPlay').disabled = !tem;
  /* so faz sentido parar o que existe */
  $('#musParar').disabled = !musQuadro;
}

/* ------------------------------------------------------------
   Parar de vez

   Pausar deixa o player de pe: o processo do iframe continua vivo,
   com os ~130 MB dele, e o YouTube segue com uma aba aberta atras.
   Aqui o iframe e ARRANCADO do DOM — o Chromium derruba o processo
   junto, e a memoria volta.

   A fila fica. Apertar play depois recria o player e volta na mesma
   faixa, do comeco: quem parou nao quer continuar de onde estava,
   quer que sumisse.
   ------------------------------------------------------------ */
function musParar() {
  if (musQuadro) musQuadro.remove();
  musQuadro = null;
  musPronto = false;
  musAbrindo = null;
  musEstado = -1;
  musTotal = 0;

  $('#musVazio').hidden = false;
  $('#musNome').textContent = '—';
  $('#musCanal').textContent = '';
  $('#musAgora').textContent = '0:00';
  $('#musTotal').textContent = '0:00';
  $('#musFill').style.width = '0%';
  musBotaoPlay(false);
  musBotoes();
}

/* O `min(300px,38vh)` do CSS nao chegava: o que limita a lista e o
   espaco ACIMA do cartao, e o cartao cresceu quando o player teve que
   ir pros 200px do minimo do YouTube. Aqui a conta e feita com a
   posicao real, entao vale em qualquer zoom e qualquer altura. */
function musCaberLista(lista) {
  const topo = $('#mus').getBoundingClientRect().top;
  lista.style.maxHeight = Math.max(120, topo - 16) + 'px';
}

async function musBuscar(termo) {
  const lista = $('#musLista');
  lista.hidden = false;
  musCaberLista(lista);
  lista.innerHTML = '<div class="mus__aviso">procurando...</div>';

  if (!temApi() || !window.api.xyven || !window.api.xyven.buscarMusica) {
    lista.innerHTML = '<div class="mus__aviso">a busca não está disponível aqui.</div>';
    return;
  }
  const token = await tokenAtual();
  const r = await window.api.xyven.buscarMusica(token || '', termo);

  if (!r || !r.ok) {
    lista.innerHTML = '<div class="mus__aviso">' + esc((r && r.erro) || 'não consegui buscar.') + '</div>';
    return;
  }
  const faixas = r.dados.faixas || [];
  if (!faixas.length) {
    lista.innerHTML = '<div class="mus__aviso">nada encontrado.</div>';
    return;
  }
  musFila = faixas;
  musIndice = -1;
  musBotoes();
  lista.innerHTML = faixas.map((f, i) =>
    '<div class="mus__item" data-i="' + i + '">' +
    (f.capa ? '<img src="' + esc(f.capa) + '" alt="">' : '') +
    '<span>' + esc(f.titulo) + '</span></div>'
  ).join('');
}

/* ------------------------------------------------------------
   ligacoes
   ------------------------------------------------------------ */
$('#openMusic').addEventListener('click', () => {
  const cx = $('#mus');
  cx.hidden = !cx.hidden;
  if (!cx.hidden) $('#musBusca').focus();
});

/* Fechar so esconde: parar o player descartaria a fila e a posicao,
   e o ponto do cartao flutuante e a musica continuar. */
$('#musFechar').addEventListener('click', () => { $('#mus').hidden = true; });

$('#musBusca').addEventListener('keydown', (e) => {
  /* Esc fecha a lista; com a lista ja fechada, fecha o cartao. Duas
     coisas na mesma tecla porque e o reflexo de quem digitou e se
     arrependeu — e a lista tapa metade da tela. */
  if (e.key === 'Escape') {
    const lista = $('#musLista');
    if (!lista.hidden) { lista.hidden = true; return; }
    $('#mus').hidden = true;
    e.target.blur();
    return;
  }
  if (e.key !== 'Enter') return;
  const t = e.target.value.trim();
  if (t.length >= 2) musBuscar(t);
});

/* Clicar fora tambem fecha a lista: sem isto ela so sumia ao escolher
   uma faixa, e ficava tapando o launcher inteiro. */
document.addEventListener('pointerdown', (e) => {
  if ($('#musLista').hidden) return;
  if (e.target.closest('#musLista') || e.target.closest('#musBusca')) return;
  $('#musLista').hidden = true;
});

$('#musLista').addEventListener('click', (e) => {
  const it = e.target.closest('[data-i]'); if (!it) return;
  $('#musLista').hidden = true;
  musTocar(Number(it.dataset.i));
});

$('#musPlay').addEventListener('click', () => {
  if (!musFila.length) return;
  /* primeiro clique sem nada carregado: comeca pela primeira da lista */
  if (musIndice < 0) return musTocar(0);
  /* parado de vez: nao ha pra quem mandar 'tocar', o player nem existe */
  if (!musQuadro) return musTocar(musIndice);
  musMandar(musEstado === MUS_TOCANDO ? 'pausar' : 'tocar');
});

/* ------------------------------------------------------------
   Dado

   Lista fixa de termos em vez de sortear palavra: cada busca nova
   custa 100 dos 10.000 pontos diarios da API, entao um dado que
   inventasse termo torraria a cota do dia em algumas dezenas de
   cliques. Com esta lista, o segundo clique no mesmo termo ja vem do
   cache e nao custa nada.

   Os termos saem do que voce escuta. Trocar aqui muda o que o dado
   sorteia.
   ------------------------------------------------------------ */
const MUS_SEMENTES = [
  'indie rock', 'bedroom pop', 'jazz', 'lofi jazz', 'dream pop',
  'shoegaze', 'soul', 'bossa nova', 'city pop', 'slacker rock',
  'indie brasileiro', 'psychedelic rock', 'jazz fusion', 'surf rock',
  'mpb', 'post punk', 'neo soul', 'blues rock'
];

const sorteio = (n) => Math.floor(Math.random() * n);

/* Com 18 termos e sorteio puro, cair duas ou tres vezes no mesmo em
   poucos cliques e comum — e de fora parece que o dado esta quebrado.
   Guardar os ultimos e barra-los faz o rodizio parecer aleatorio, que
   e o que se espera de um dado aqui. */
const MUS_ULTIMOS = [];
const LEMBRAR = 6;

function sortearTermo() {
  const livres = MUS_SEMENTES.filter((t) => !MUS_ULTIMOS.includes(t));
  const lista = livres.length ? livres : MUS_SEMENTES;
  const t = lista[sorteio(lista.length)];
  MUS_ULTIMOS.push(t);
  if (MUS_ULTIMOS.length > LEMBRAR) MUS_ULTIMOS.shift();
  return t;
}

async function musSorte() {
  const dado = $('#musSorte');
  dado.disabled = true;
  $('#musNome').textContent = 'sorteando...';
  $('#musCanal').textContent = '';

  const termo = sortearTermo();

  if (!temApi() || !window.api.xyven || !window.api.xyven.buscarMusica) {
    $('#musNome').textContent = 'a busca não está disponível aqui.';
    dado.disabled = false;
    return;
  }
  const token = await tokenAtual();
  const r = await window.api.xyven.buscarMusica(token || '', termo);
  dado.disabled = false;

  if (!r || !r.ok) {
    $('#musNome').textContent = (r && r.erro) || 'não consegui sortear.';
    return;
  }
  const faixas = r.dados.faixas || [];
  if (!faixas.length) { $('#musNome').textContent = 'o dado caiu no vazio.'; return; }

  /* A fila vira o resultado inteiro: depois do sorteio o "proxima"
     continua andando pelo genero que saiu, em vez de morrer numa
     faixa so. */
  musFila = faixas;
  musBotoes();
  $('#musBusca').value = termo;
  musTocar(sorteio(faixas.length));
}

$('#musSorte').addEventListener('click', musSorte);

$('#musParar').addEventListener('click', musParar);

$('#musAnt').addEventListener('click', () => musTocar(musIndice - 1));
$('#musProx').addEventListener('click', () => musTocar(musIndice + 1));

/* ------------------------------------------------------------
   Qualidade conforme a janela

   Com o Minecraft na frente, o video continua sendo decodificado
   atras — e isso e quadro por segundo que sai do jogo. Sem foco cai
   pra 144p, que ninguem esta olhando mesmo; ao voltar sobe pros 240p
   do tamanho do quadro.

   O audio nao muda: a trilha e a mesma nas duas.
   ------------------------------------------------------------ */
window.addEventListener('blur', () => musMandar('qualidade', { valor: 'tiny' }));
window.addEventListener('focus', () => musMandar('qualidade', { valor: 'small' }));

/* ------------------------------------------------------------
   Arrastar

   Servia so pra clique: apertar e arrastar nao mexia nada, e no
   soltar a musica "teleportava". setPointerCapture e o que faz o
   ponteiro continuar sendo desta barra mesmo quando o dedo sai de
   cima dela — sem ele, arrastar pra fora larga o movimento no meio.
   ------------------------------------------------------------ */
function arrastavel(barra, aoMover, aoSoltar, emPe) {
  const fracao = (e) => {
    const r = barra.getBoundingClientRect();
    /* em pe conta de baixo pra cima: no eixo Y a tela cresce pra
       baixo, e volume que aumenta descendo nao existe em lugar nenhum */
    const f = emPe
      ? (r.bottom - e.clientY) / r.height
      : (e.clientX - r.left) / r.width;
    return Math.min(1, Math.max(0, f));
  };

  barra.addEventListener('pointerdown', (e) => {
    barra.setPointerCapture(e.pointerId);
    musArrastando = true;
    aoMover(fracao(e));
  });

  barra.addEventListener('pointermove', (e) => {
    if (!musArrastando) return;
    aoMover(fracao(e));
  });

  const soltar = (e) => {
    if (!musArrastando) return;
    musArrastando = false;
    aoSoltar(fracao(e));
  };
  barra.addEventListener('pointerup', soltar);
  barra.addEventListener('pointercancel', soltar);
}

/* Durante o arraste a barra e o relogio andam junto com o dedo, mas o
   seek so vai no soltar: um seekTo a cada pixel faria o player
   rebufferizar sem parar. */
arrastavel($('#musBarra'), (f) => {
  if (!musTotal) return;
  $('#musFill').style.width = (f * 100) + '%';
  $('#musAgora').textContent = musMin(f * musTotal);
}, (f) => {
  if (!musTotal) return;
  musMandar('pular', { segundos: f * musTotal });
});

/* ------------------------------------------------------------
   Volume

   Fica no localStorage porque abrir o launcher no volume cheio
   depois de ter deixado baixo e o tipo de coisa que assusta quem
   esta de fone.
   ------------------------------------------------------------ */
function musDesenharVolume() {
  const v = musMudo ? 0 : musVolume;
  $('#musVolFill').style.height = v + '%';
  $('#musSom').title = 'Volume ' + v + '%';
  $('#musSom').innerHTML = v === 0
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M17 9l4 6M21 9l-4 6"></path></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"></path></svg>';
}

function musAplicarVolume() {
  musMandar('volume', { valor: musMudo ? 0 : musVolume });
  musDesenharVolume();
  try { localStorage.setItem('xyven.volume', JSON.stringify({ v: musVolume, mudo: musMudo })); }
  catch (e) { /* sem storage */ }
}

arrastavel($('#musVolBarra'), (f) => {
  musVolume = Math.round(f * 100);
  musMudo = false;
  musAplicarVolume();
}, () => { /* ja aplicado a cada movimento: volume nao rebufferiza */ }, true);

/* O botao so ABRE a barra. Antes ele mutava no clique, e nao havia
   como chegar no volume sem antes zera-lo sem querer. */
$('#musSom').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#musVolPop').hidden = !$('#musVolPop').hidden;
});

/* clicar em qualquer outro lugar fecha */
document.addEventListener('pointerdown', (e) => {
  if ($('#musVolPop').hidden) return;
  if (e.target.closest('.mus__volcx')) return;
  $('#musVolPop').hidden = true;
});

try {
  const g = JSON.parse(localStorage.getItem('xyven.volume') || 'null');
  if (g && typeof g.v === 'number') { musVolume = g.v; musMudo = !!g.mudo; }
} catch (e) { /* json torto */ }
musDesenharVolume();

musBotoes();


/* ============================================================
   LOGS DAS SESSOES

   O jogo ja grava um arquivo por sessao em <perfil>/logs e o
   minecraft.ts guarda os 10 ultimos. Aqui e so folhear: setas pra
   andar entre eles, busca pra achar a linha, e copiar pra mandar
   pra alguem.

   O texto chega do main JA sem o accessToken. Nao ha censura nesta
   camada de proposito: censurar na tela deixaria o valor vivo dentro
   do processo da janela, e um print continuaria entregando ele.
   ============================================================ */
/* Teto do que vai pra tela de uma vez.

   O travamento nao era ler o arquivo — 50 KB o disco entrega na
   hora. Era montar 5000 <span> num innerHTML so: o layout do
   Chromium para tudo enquanto calcula, e a janela inteira engasga.

   As ULTIMAS linhas, e nao as primeiras: quando o jogo fecha
   sozinho, o motivo esta no fim. Quem precisa do comeco usa a busca,
   que roda no texto inteiro. */
const LG_TETO = 1200;

/* Quantas linhas por quadro no "mostrar tudo". O custo total e o
   mesmo; a diferenca e que ele fica repartido entre varios quadros
   em vez de travar a janela num so. */
const LG_LOTE = 600;

let lgTudo = false;        /* a pessoa pediu o log inteiro */
let lgDesenhando = null;   /* id do rAF em curso, pra poder cancelar */

let lgLista = [];
let lgOnde = 0;
let lgTexto = '';

const lgData = (ms) => new Date(ms).toLocaleString('pt-BR');

async function abrirLogs() {
  open($('#logsOverlay'));
  $('#lgBusca').value = '';
  $('#lgOut').textContent = 'carregando...';
  $('#lgAchou').textContent = '';

  if (!temApi() || !window.api.logs) {
    $('#lgOut').textContent = 'os logs só existem no app.';
    return;
  }
  const r = await window.api.logs.listar(state.dir);
  if (!r || !r.ok) { $('#lgOut').textContent = (r && r.erro) || 'não consegui listar.'; return; }

  lgLista = r.logs || [];
  lgOnde = 0;
  if (!lgLista.length) {
    $('#lgOut').textContent = 'nenhuma sessão registrada ainda — jogue uma vez.';
    $('#lgQuando').textContent = '—';
    $('#lgConta').textContent = '—';
    lgSetas();
    return;
  }
  await lgCarregar();
}

async function lgCarregar() {
  const reg = lgLista[lgOnde];
  if (!reg) return;
  $('#lgOut').textContent = 'carregando...';
  $('#lgQuando').textContent = lgData(reg.quando);
  $('#lgConta').textContent = (lgOnde + 1) + ' de ' + lgLista.length +
    ' · ' + Math.max(1, Math.round(reg.tamanho / 1024)) + ' KB';
  $('#lgLinhas').textContent = '';
  /* log novo, teto de novo: abrir uma sessao de 20 mil linhas inteira
     porque a anterior foi expandida seria a travada de volta */
  lgTudo = false;
  lgSetas();

  const r = await window.api.logs.ler(state.dir, reg.arquivo);
  if (!r || !r.ok) { $('#lgOut').textContent = (r && r.erro) || 'não consegui abrir.'; return; }
  lgTexto = r.texto || '';
  lgPintar();
}

function lgSetas() {
  /* a lista vem do mais novo pro mais antigo: "anterior" sobe na
     linha do tempo, "proxima" desce */
  $('#lgAnterior').disabled = lgOnde <= 0;
  $('#lgProxima').disabled = lgOnde >= lgLista.length - 1;
}

/* Filtra por linha e destaca o achado. Filtrar em vez de so rolar ate
   o primeiro: num log de 5000 linhas, ver as 12 que casam vale mais
   que pular de uma em uma. */
function lgPintar() {
  const termo = $('#lgBusca').value.trim().toLowerCase();
  const linhas = lgTexto.split(String.fromCharCode(10));
  const casaram = termo ? linhas.filter((l) => l.toLowerCase().includes(termo)) : linhas;

  $('#lgAchou').textContent = termo
    ? (casaram.length ? casaram.length + (casaram.length === 1 ? ' linha' : ' linhas') : 'nada')
    : '';

  const cortou = !lgTudo && casaram.length > LG_TETO;
  const vistas = cortou ? casaram.slice(-LG_TETO) : casaram;

  $('#lgLinhas').textContent = linhas.length + (linhas.length === 1 ? ' linha' : ' linhas') +
    (cortou ? ' · mostrando as últimas ' + LG_TETO : '');
  $('#lgTudo').hidden = !cortou;

  lgDesenhar(vistas);
}

function lgLinhaHtml(l) {
  let cls = 'lg__l';
  if (/\b(ERROR|SEVERE|Exception|Caused by|FATAL)\b/.test(l)) cls += ' lg__l--erro';
  else if (/\bWARN(ING)?\b/.test(l)) cls += ' lg__l--aviso';
  else if (l.startsWith('#') || l.startsWith('[xyven]')) cls += ' lg__l--nota';
  /* nada de pintar o achado: com o filtro ligado TODAS as linhas
     casam, e o amarelo cobriria justamente a cor do erro */
  return '<span class="' + cls + '">' + esc(l) + '</span>';
}

/* Desenha em lotes, um por quadro. Cancelando o anterior: digitar na
   busca dispara um desenho por tecla, e sem cancelar eles empilham e
   a tela fica pior do que estava. */
function lgDesenhar(linhas) {
  if (lgDesenhando) { cancelAnimationFrame(lgDesenhando); lgDesenhando = null; }
  const out = $('#lgOut');

  if (!linhas.length) {
    out.innerHTML = '<span class="lg__l lg__l--nota">nada encontrado.</span>';
    return;
  }

  out.innerHTML = '';
  let i = 0;
  const passo = () => {
    const ate = Math.min(i + LG_LOTE, linhas.length);
    let pedaco = '';
    for (; i < ate; i++) pedaco += lgLinhaHtml(linhas[i]);
    out.insertAdjacentHTML('beforeend', pedaco);
    if (i < linhas.length) lgDesenhando = requestAnimationFrame(passo);
    else lgDesenhando = null;
  };
  passo();
}

$('#panel-toggles').addEventListener('click', (e) => {
  if (e.target.closest('#btnLogs')) abrirLogs();
});

$('#lgTudo').addEventListener('click', () => {
  lgTudo = true;
  $('#lgTudo').hidden = true;
  lgPintar();
});

$('#lgAnterior').addEventListener('click', () => { if (lgOnde > 0) { lgOnde--; lgCarregar(); } });
$('#lgProxima').addEventListener('click', () => {
  if (lgOnde < lgLista.length - 1) { lgOnde++; lgCarregar(); }
});

$('#lgBusca').addEventListener('input', lgPintar);
$('#lgBusca').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  /* Esc limpa a busca; com ela ja vazia, fecha */
  if (e.target.value) { e.target.value = ''; lgPintar(); return; }
  $('#logsOverlay').hidden = true;
});

/* Copia o log INTEIRO, e nao o que o filtro mostra: quem copia esta
   mandando pra alguem diagnosticar, e o filtro dela nao e o mesmo que
   a outra pessoa vai querer. */
$('#lgCopiar').addEventListener('click', async () => {
  const ok = await copiar(lgTexto);
  $('#lgCopiar').textContent = ok ? 'COPIADO' : 'FALHOU';
  setTimeout(() => { $('#lgCopiar').textContent = 'COPIAR LOG'; }, 1400);
});

/* as setas do teclado tambem andam entre as sessoes */
document.addEventListener('keydown', (e) => {
  if ($('#logsOverlay').hidden) return;
  if (document.activeElement === $('#lgBusca')) return;
  if (e.key === 'ArrowLeft' && lgOnde > 0) { lgOnde--; lgCarregar(); }
  if (e.key === 'ArrowRight' && lgOnde < lgLista.length - 1) { lgOnde++; lgCarregar(); }
});
