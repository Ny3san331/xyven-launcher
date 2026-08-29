
/* ============================================================
   7.z MIGRAÇÃO owl.* -> xyven.* (marca antiga)
   Roda antes de qualquer leitura de storage. Só copia o que existe
   e ainda não foi migrado; depois apaga a chave velha.
   ============================================================ */
(function migrarChaves() {
  const CHAVES = ['theme', 'posts', 'editor', 'customTheme',
                  'profile', 'members', 'skins', 'cape', 'notifs'];
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
  accounts: [
    { name: 'Ny3san', type: 'microsoft · premium' },
    { name: 'XyvenDev', type: 'microsoft · premium' }
  ],
  toggles: {
    launcher: [
      { key: 'theme',     on: false, label: 'Modo escuro', desc: 'mesmo tema, com a luz apagada' },
      { key: 'close',     on: false, label: 'Fechar ao tocar', desc: 'o launcher sai de cena quando o jogo abre' },
      { key: 'logs',      on: false, label: 'Console aberto',  desc: 'deixa os logs rolando em outra janela' },
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
  java: 'Java 17',
  account: 'Ny3san',
  tab: 'jogo'
};

/* contas e conta ativa persistem: sem isso a conta pirata some ao fechar */
const saveAccounts = () => {
  try { localStorage.setItem('xyven.accounts', JSON.stringify({ lista: CONFIG.accounts, ativa: state.account })); }
  catch (e) { /* sem storage */ }
};
(function restoreAccounts() {
  try {
    const s = JSON.parse(localStorage.getItem('xyven.accounts') || 'null');
    if (!s || !Array.isArray(s.lista) || !s.lista.length) return;
    CONFIG.accounts.length = 0;
    s.lista.forEach(a => { if (a && a.name) CONFIG.accounts.push(a); });
    if (s.ativa && CONFIG.accounts.some(a => a.name === s.ativa)) state.account = s.ativa;
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
function renderStats() {
  $('#versionLabel').textContent = state.version;
  $('#statVersion').textContent = state.version;
  $('#statMem').textContent = state.mem + ' MB';
  $('#statJava').textContent = state.java;
  $('#chipName').textContent = state.account;
  setAvatar($('#chipInitial'), state.account);
  setAvatar($('#menuInitial'), state.account);
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
      <div class="news__img" style="${newsImages[i] ? `background-image:url('${newsImages[i]}');background-size:cover;background-position:center` : ''}">${newsImages[i] ? '' : 'IMAGEM'}</div>
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

function renderJava() {
  $('#javaList').innerHTML = CONFIG.javas.map(j => `
    <button class="java ${j.name === state.java ? 'is-active' : ''}" data-java="${j.name}">
      <span><span class="java__name">${j.name}</span><br><span class="java__path">${j.path}</span></span>
      <span class="tag" style="background:${j.name === state.java ? 'var(--teal)' : 'var(--sand)'}">${j.name === state.java ? 'EM USO' : j.tag}</span>
    </button>`).join('');
}

function renderToggles() {
  const list = state.tab === 'discord' ? CONFIG.toggles.discord : CONFIG.toggles.launcher;
  $('#panel-toggles').innerHTML = list.map(t => `
    <div class="switch">
      <span><span class="switch__label">${t.label}</span><br><span class="switch__desc">${t.desc}</span></span>
      <button class="knob ${t.on ? 'is-on' : ''}" data-toggle="${t.key}"><span></span></button>
    </div>`).join('');
}

function renderAccounts() {
  $('#accountList').innerHTML = CONFIG.accounts.map(a => `
    <button class="account ${a.name === state.account ? 'is-active' : ''}" data-account="${a.name}">
      <span class="avatar" style="width:38px;height:38px;font-size:17px;border-width:3px" data-skin="${a.name}">${a.name[0]}</span>
      <span style="flex:1"><span class="account__name">${a.name}</span><br><span class="account__type">${a.type}</span></span>
      <span style="font-size:9px;font-weight:700;letter-spacing:.12em">${a.name === state.account ? 'ATIVA' : ''}</span>
    </button>`).join('') + `
    <button class="account account--add" id="addAccount">+ ADICIONAR CONTA</button>`;
}

function renderMemory() {
  const { min, max } = CONFIG.memory;
  const pct = ((state.mem - min) / (max - min)) * 100 + '%';
  $('#memMb').textContent = state.mem + ' MB';
  $('#memGb').textContent = '≈ ' + (state.mem / 1024).toFixed(2) + ' GB';
  $('#faderFill').style.width = pct;
  $('#faderKnob').style.left = pct;
  $('#memMin').textContent = min + ' MB';
  $('#memMax').textContent = max + ' MB';
  renderStats();
}

/* ============================================================
   10. INTERAÇÕES
   ============================================================ */
const open  = (el) => { el.hidden = false; };
const close = (el) => { el.hidden = true; };

/* menu de conta */
const chip = document.getElementById('accountChip');
const accMenu = document.getElementById('accountMenu');
chip.addEventListener('click', (e) => { e.stopPropagation(); accMenu.hidden = !accMenu.hidden; });
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
  if (b.dataset.nav === 'dev') { openDev(); return; }
  $$('.rail__btn').forEach(x => x.classList.remove('is-active'));
  b.classList.add('is-active');
  showScreen(b.dataset.nav);
});

/* troca a tela mostrada em <main>. telas ainda sem conteúdo caem no início. */
function showScreen(name) {
  const known = ['home', 'news', 'profile'];
  const target = known.includes(name) ? name : 'home';
  $('#screen-home').hidden = target !== 'home';
  $('#screen-news').hidden = target !== 'news';
  $('#screen-profile').hidden = target !== 'profile';
  if (target === 'news') { renderFilters(); renderFeed(); }
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
$$('[data-open="profile"]').forEach(b => b.onclick = () => { close($('#accountMenu')); goToScreen('profile'); });

/* ---- remover a conta ativa ---- */
$('#removerConta').onclick = async () => {
  const alvo = state.account;
  close($('#accountMenu'));

  if (CONFIG.accounts.length <= 1) {
    alert('essa é a única conta do launcher. adicione outra antes de remover.');
    return;
  }
  if (jogoAberto || jogoAbrindo) {
    alert('feche o Minecraft antes de remover a conta.');
    return;
  }
  if (!confirm('remover "' + alvo + '" do launcher?\n\no tempo de jogo dessa conta é mantido, e você pode entrar de novo depois.')) return;

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

/* ---- login Microsoft: device code ----
   o usuario aprova no navegador dele; o launcher nunca ve a senha. */
let msVerificacao = 'https://microsoft.com/link';

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
    alert('o login da Microsoft só funciona no app.');
    return;
  }
  open($('#msOverlay'));
  msMostra('pedindo o código à Microsoft...');

  const p = await window.api.auth.pedirCodigo();
  if (!p.ok) { msMostra('não deu pra começar o login.', { erro: p.erro }); return; }

  msVerificacao = p.codigo.verification_uri;
  msMostra('abra o site da Microsoft e digite este código:', {
    codigo: p.codigo.user_code, abrir: true, espera: true
  });

  /* espera a aprovação; o main faz o polling */
  const res = await window.api.auth.aguardar();
  if (!res.ok) { msMostra('o login não foi concluído.', { erro: res.erro }); return; }

  const c = res.conta;
  const jaTem = CONFIG.accounts.find((a) => a.name.toLowerCase() === c.nick.toLowerCase());
  if (jaTem) { jaTem.name = c.nick; jaTem.type = 'microsoft · premium'; }
  else CONFIG.accounts.push({ name: c.nick, type: 'microsoft · premium' });

  contaMS = c;
  state.account = c.nick;
  profile.nick = c.nick; profile.skin = c.nick;
  saveAccounts();
  applyGroup(); renderStats(); renderProfile(); renderAccounts();
  close($('#msOverlay'));
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

/* clicar no codigo copia: e chato digitar 8 caracteres no navegador */
$('#msCodigo').onclick = async () => {
  const codigo = $('#msCodigo').textContent.trim();
  if (!codigo || codigo.startsWith('---')) return;
  const antes = $('#msPasso').textContent;
  const ok = await copiar(codigo);
  $('#msPasso').textContent = ok ? 'código copiado. cole no site da Microsoft.'
                                 : 'não consegui copiar. digite o código à mão.';
  setTimeout(() => { if (!$('#msOverlay').hidden) $('#msPasso').textContent = antes; }, 2200);
};

$('#msCodigo').title = 'clique para copiar';

$('#msAbrir').onclick = () => window.api.abrirLink(msVerificacao);
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
});
$('#javaList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-java]'); if (!b) return;
  state.java = b.dataset.java; renderJava(); renderStats();
});
$('#dirInput').addEventListener('change', (e) => { state.dir = e.target.value; });
$('#browseBtn').onclick = () => { /* AQUI: abrir o seletor de pasta do Electron/Tauri */ };
$('#accountList').addEventListener('click', (e) => {
  /* criado por renderAccounts a cada desenho, entao nao da pra ligar direto */
  if (e.target.closest('#addAccount')) { close($('#switchOverlay')); open($('#addOverlay')); return; }
  const b = e.target.closest('[data-account]'); if (!b) return;
  state.account = b.dataset.account;
  profile.nick = state.account; profile.skin = state.account;
  saveAccounts();
  applyGroup(); renderStats(); renderProfile(); close($('#switchOverlay'));
});

/* fader de memória (arrastar) */
(function fader() {
  const el = $('#fader'), { min, max, step } = CONFIG.memory;
  const setFrom = (x) => {
    const r = el.firstElementChild.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (x - r.left) / r.width));
    state.mem = Math.round((min + p * (max - min)) / step) * step;
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

$('#playBtn').onclick = async () => {
  if (jogoAbrindo) return;
  if (jogoAberto) {                     /* segundo clique: encerra o jogo */
    if (temApi()) window.api.mc.matar();
    return;
  }
  if (!temApi()) { alert('a inicialização só funciona no app; no navegador não há acesso ao disco.'); return; }

  const java = CONFIG.javas.find((j) => j.name === state.java);
  if (!java || !java.path || java.path.startsWith('...')) {
    alert('escolha um Java em Ajustes › Jogo antes de tocar.');
    return;
  }
  const exigido = await window.api.java.exigido(state.version);
  if (java.maior && java.maior < exigido) {
    if (!confirm('a fita ' + state.version + ' pede Java ' + exigido + ' e o escolhido é o ' + java.maior +
                 '.\no jogo provavelmente não abre. tocar mesmo assim?')) return;
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

  const r = await window.api.mc.lancar({
    versao: state.version,
    memoriaMb: state.mem,
    javaPath: java.path,
    gameDir: state.dir || $('#dirInput').value,
    nick: sessao ? sessao.nick : state.account,
    uuid: sessao ? sessao.uuid : undefined,
    accessToken: sessao ? sessao.accessToken : undefined,
    userType: sessao ? 'msa' : undefined
  });

  if (!r || !r.ok) { falhaAoTocar((r && r.erro) || 'erro desconhecido'); return; }

  /* deu certo: some com a barra, marca o estado e respeita o "Fechar ao tocar" */
  jogoAbrindo = false;
  comecarSessao();
  marcarTocando(true);
  mostrarProgresso(false);
  const fechar = CONFIG.toggles.launcher.find((t) => t.key === 'close');
  if (fechar && fechar.on) window.api.window.minimize();
};

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
      const rodando = await window.api.mc.rodando();
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
    state.java = bom.name;
    renderJava(); renderStats();
  } catch (e) { console.warn('não consegui detectar o Java', e); }
}

/* pasta do .minecraft */
$('#browseBtn').onclick = async () => {
  if (!temApi()) return;
  const r = await window.api.dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (r && !r.canceled && r.filePaths && r.filePaths[0]) {
    state.dir = r.filePaths[0];
    $('#dirInput').value = state.dir;
  }
};

/* boot (renderNews fica no boot do fórum — depende dos posts) */
state.dir = $('#dirInput').value;
renderStats(); renderVersions(); renderJava(); renderToggles(); renderAccounts(); renderMemory();
carregarJava();

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

const SEED_POSTS = [
  { id: 1, tag: 'ATUALIZAÇÃO', pinned: true, featured: true, author: 'XyvenDev', date: '27/08/2026',
    title: 'Motor de FPS novo já está no ar',
    body: 'o renderer foi reescrito do zero. em 1.8.9 a média subiu 22% nas máquinas que testamos, sem mexer em nenhuma configuração.\n\nse você usava mod de otimização, pode tirar. o ganho já vem de casa.' },
  { id: 2, tag: 'EVENTO', pinned: false, featured: true, author: 'Ny3san', date: '25/08/2026',
    title: 'Xyven Cup de agosto — inscrições abertas',
    body: 'torneio 3v3 de bedwars, chaves definidas no domingo à noite. premiação em cosméticos e um mês de PRO pra equipe vencedora.' },
  { id: 3, tag: 'CORREÇÃO', pinned: false, featured: true, author: 'XyvenDev', date: '21/08/2026',
    title: 'Crash ao trocar de fita durante o download',
    body: 'corrigido. quem trocava de versão com o download em andamento fechava o launcher sem aviso.' }
];

let posts = [];
try { posts = JSON.parse(localStorage.getItem('xyven.posts') || 'null') || SEED_POSTS.slice(); }
catch (e) { posts = SEED_POSTS.slice(); }
let postFilter = 'TODAS';
let editingId = null;

const savePosts = () => { try { localStorage.setItem('xyven.posts', JSON.stringify(posts)); } catch (e) { /* sem storage */ } };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
        <p class="post__body post__body--clamp selectable">${esc(p.body).replace(/\n/g, '<br>')}</p>
        <div class="post__actions">
          <button class="link-btn" data-open-post="${p.id}">ler tudo</button>
          <button class="link-btn" data-edit="${p.id}">editar</button>
          <button class="link-btn" data-pin="${p.id}">${p.pinned ? 'desafixar' : 'fixar'}</button>
          <button class="link-btn" data-home="${p.id}">${p.featured ? 'tirar do início' : 'mostrar no início'}</button>
          <button class="link-btn link-btn--danger" data-del="${p.id}">apagar</button>
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
    p.pinned = !p.pinned; savePosts(); renderFeed(); renderNews();
  }
  if (home) {
    const p = posts.find(x => x.id === Number(home.dataset.home));
    p.featured = !p.featured; savePosts(); renderFeed(); renderNews();
  }
  if (del) {
    posts = posts.filter(x => x.id !== Number(del.dataset.del));
    savePosts(); renderFeed(); renderNews();
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
  $('#readTitle').textContent = p.title;
  $('#readBody').textContent = p.body;
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
  open($('#postOverlay'));
  setTimeout(() => $('#postTitle').focus(), 30);
}

$('#newPostBtn').onclick = () => openPostEditor(null);

$('#postSave').onclick = () => {
  const title = $('#postTitle').value.trim();
  const body = $('#postBody').value.trim();
  if (!title) { $('#postTitle').focus(); return; }
  if (editingId) {
    const p = posts.find(x => x.id === editingId);
    Object.assign(p, { title, body, tag: $('#postTag').value, pinned: $('#postPin').checked });
  } else {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    posts.unshift({
      id: Date.now(), tag: $('#postTag').value, pinned: $('#postPin').checked, featured: false,
      author: state.account, date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
      title, body
    });
  }
  savePosts(); renderFeed(); renderNews(); close($('#postOverlay'));
};

/* boot do fórum */
paintSkins();
renderFilters(); renderFeed(); renderNews();

/* ============================================================
   10.c TELA DE PERFIL — skin 3D, horas e servidores
   ============================================================ */
const ALL_BADGES = [
  { id: 'dev',      label: 'DEV',        bg: 'var(--teal)',      fg: '#f4e7ca' },
  { id: 'fundador', label: 'FUNDADOR',   bg: 'var(--salmon)',    fg: 'var(--on-accent,#33261c)' },
  { id: 'pro',      label: 'PRO',        bg: 'var(--mustard)',   fg: 'var(--on-accent,#33261c)' },
  { id: 'beta',     label: 'BETA',       bg: 'var(--sand-dark)', fg: 'var(--ink)' },
  { id: 'campeao',  label: 'CAMPEÃO',    bg: 'var(--ink)',       fg: 'var(--paper)' }
];

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
const MEMBERS_DEFAULT = [
  { nick: 'Ny3san', group: 'dev',    badges: ['dev', 'pro'] },
  { nick: 'XyvenDev', group: 'dev',    badges: ['dev', 'fundador'] },
  { nick: 'Kauan',  group: 'player', badges: ['beta'] },
  { nick: 'Tuti',   group: 'player', badges: [] }
];

const freshMembers = () => MEMBERS_DEFAULT.map(m => Object.assign({}, m, { badges: m.badges.slice() }));
let members;
try { members = JSON.parse(localStorage.getItem('xyven.members') || 'null') || freshMembers(); }
catch (e) { members = freshMembers(); }
const saveMembers = () => { try { localStorage.setItem('xyven.members', JSON.stringify(members)); } catch (e) { /* sem storage */ } };

const memberOf = (nick) => members.find(m => m.nick.toLowerCase() === String(nick).toLowerCase());
const badgesOf = (nick) => (memberOf(nick) || { badges: [] }).badges;
const groupOf = (nick) => (memberOf(nick) || { group: 'player' }).group;

/* o grupo da conta ativa controla o que aparece: body[data-group="dev"] libera .dev-only */
function applyGroup() { document.body.dataset.group = groupOf(state.account); }

function renderProfile() {
  $('#profName').textContent = profile.nick;
  $('#profSince').textContent = 'na fita desde ' + profile.since;
  const av = $('#profAvatar');
  if (av.dataset.skin !== profile.skin) { av.textContent = profile.nick[0]; av.dataset.skin = profile.skin; delete av.dataset.painted; }

  $('#profBadges').innerHTML = badgesOf(profile.nick).map(id => {
    const b = ALL_BADGES.find(x => x.id === id); if (!b) return '';
    return `<span class="badge" style="background:${b.bg};color:${b.fg}">${b.label}</span>`;
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

/* [largura, altura, profundidade] em px de textura, e o topo-esquerda de cada face */
/* x/y em pixels de textura, medidos a partir do centro do corpo.
   O 0.02 separa faces que ficariam no mesmo plano (braço/torso, perna/perna):
   sem essa folga o 3D do navegador pisca listras, principalmente nas costas. */
function skinParts(slim) {
  const aw = slim ? 3 : 4;
  const base = [
    { name: 'head', w: 8,  h: 8,  d: 8, u: 0,  v: 0,  x: -4,               y: 0,  o: { u: 32, v: 0 } },
    { name: 'body', w: 8,  h: 12, d: 4, u: 16, v: 16, x: -4,               y: 8,  o: { u: 16, v: 32 } },
    { name: 'armR', w: aw, h: 12, d: 4, u: 40, v: 16, x: -(4 + aw) - 0.02, y: slim ? 8.5 : 8, o: { u: 40, v: 32 } },
    { name: 'armL', w: aw, h: 12, d: 4, u: 32, v: 48, x: 4 + 0.02,         y: slim ? 8.5 : 8, o: { u: 48, v: 48 } },
    { name: 'legR', w: 4,  h: 12, d: 4, u: 0,  v: 16, x: -4 - 0.02,        y: 20, o: { u: 0,  v: 32 } },
    { name: 'legL', w: 4,  h: 12, d: 4, u: 16, v: 48, x: 0.02,             y: 20, o: { u: 0,  v: 48 } }
  ];
  /* segunda camada (cabelo, jaqueta, manga, calça): mesma caixa 6% maior */
  const over = base.map(p => Object.assign({}, p, { u: p.o.u, v: p.o.v, over: true }));
  return base.concat(over);
}

function faceStyle(tex, sc, p, face) {
  /* recorte de cada face na folha de skin: [dx, dy, largura, altura] */
  const map = {
    front: [p.d,           p.d,  p.w, p.h],
    back:  [p.d * 2 + p.w, p.d,  p.w, p.h],
    right: [0,             p.d,  p.d, p.h],
    left:  [p.d + p.w,     p.d,  p.d, p.h],
    top:   [p.d,           0,    p.w, p.d],
    bottom:[p.d + p.w,     0,    p.w, p.d]
  }[face];
  const [ox, oy, fw, fh] = map;
  /* cada face é centrada na caixa; o transform 3D leva ela pro lugar */
  return 'position:absolute;left:50%;top:50%;' +
    'width:' + (fw * sc) + 'px;height:' + (fh * sc) + 'px;' +
    'margin-left:' + (-fw * sc / 2) + 'px;margin-top:' + (-fh * sc / 2) + 'px;' +
    'background-image:url(' + tex + ');' +
    'background-size:' + (64 * sc) + 'px ' + (64 * sc) + 'px;' +
    'background-position:' + (-(p.u + ox) * sc) + 'px ' + (-(p.v + oy) * sc) + 'px;';
}

/* a capa escolhida no editor só vale depois do USAR ESTA SKIN */
let capeApplied;
try { capeApplied = localStorage.getItem('xyven.cape') || 'none'; } catch (e) { capeApplied = 'none'; }

function buildSkin() { buildSkinInto('#skinBody', profile.skin, 9, capeApplied, profile.slim); }

function buildSkinInto(sel, nick, sc, capeId, slim) {
  const stage = $(sel); if (!stage) return;
  const tex = SKIN_TEX(nick);
  const capeDef = capasDaConta.find(c => c.id === capeId);
  const capeTex = (capeDef && capeDef.url) ? String(capeDef.url).replace(/^http:/, 'https:') : '';

  const partesHtml = skinParts(slim).map(p => {
    const W = p.w * sc, H = p.h * sc, D = p.d * sc;
    const faces = [
      ['front',  'translateZ(' + (D / 2) + 'px)'],
      ['back',   'rotateY(180deg) translateZ(' + (D / 2) + 'px)'],
      ['right',  'rotateY(-90deg) translateZ(' + (W / 2) + 'px)'],
      ['left',   'rotateY(90deg) translateZ(' + (W / 2) + 'px)'],
      ['top',    'rotateX(90deg) translateZ(' + (H / 2) + 'px)'],
      ['bottom', 'rotateX(-90deg) translateZ(' + (H / 2) + 'px)']
    ].map(([f, t]) =>
      '<div class="skin__part" style="' + faceStyle(tex, sc, p, f) + 'transform:' + t + '"></div>'
    ).join('');
    /* centro da caixa: x + metade da largura, y + metade da altura */
    const cx = (p.x + p.w / 2) * sc, cy = (p.y + p.h / 2) * sc;
    const grow = p.over ? ' scale3d(1.06,1.04,1.06)' : '';
    return '<div style="position:absolute;left:50%;top:0;width:0;height:0;transform-style:preserve-3d;' +
      'transform:translate3d(' + cx + 'px,' + cy + 'px,0)' + grow + '">' + faces + '</div>';
  }).join('');

  /* capa: painel 10×16 nas costas do torso, levemente inclinado.
     vai ANTES das partes no DOM: entre irmaos preserve-3d o Chromium
     respeita a ordem de pintura, e no fim ela cobria o peito. */
  let capaHtml = '';
  if (capeTex) {
    const cw = 10 * sc, ch = 16 * sc;
    capaHtml = '<div style="position:absolute;left:50%;top:0;width:0;height:0;transform-style:preserve-3d;' +
      'transform:translate3d(0,' + (16 * sc) + 'px,' + (-2.6 * sc) + 'px) rotateX(-9deg)">' +
      '<div class="skin__part" style="position:absolute;left:50%;top:50%;width:' + cw + 'px;height:' + ch + 'px;' +
      'margin-left:' + (-cw / 2) + 'px;margin-top:' + (-ch / 2) + 'px;' +
      'background-image:url(' + capeTex + ');background-size:' + (64 * sc) + 'px ' + (32 * sc) + 'px;' +
      'background-position:' + (-1 * sc) + 'px ' + (-1 * sc) + 'px;transform:rotateY(180deg)"></div></div>';
  }
  stage.innerHTML = capaHtml + partesHtml;

  stage.style.position = 'relative';
  stage.style.height = (32 * sc) + 'px';
  if (sel === '#skinBody') applySkinRotation();
  else if (!stage.style.transform) stage.style.transform = 'perspective(900px) rotateX(-8deg) rotateY(-22deg)';
}

/* arraste — uma só implementação, atualizada em rAF pra não engasgar */
function makeSkinDrag(stageSel, bodySel, onChange) {
  const stage = $(stageSel); if (!stage) return null;
  const st = { yaw: -22, pitch: -8 };
  let drag = null, frame = 0;
  const paint = () => {
    frame = 0;
    const b = $(bodySel); if (!b) return;
    b.style.transform = 'perspective(900px) rotateX(' + st.pitch + 'deg) rotateY(' + st.yaw + 'deg)';
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(paint); };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch };
    e.preventDefault();
    /* ouvintes na janela: o palco é reconstruído a cada render e a
       captura de ponteiro se perde junto com o elemento antigo */
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });
  function move(e) {
    if (!drag) return;
    st.yaw = drag.yaw + (e.clientX - drag.x) * 0.5;
    st.pitch = Math.max(-32, Math.min(32, drag.pitch - (e.clientY - drag.y) * 0.35));
    queue();
  }
  function stop() {
    drag = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  }
  stage.addEventListener('dblclick', () => { st.yaw = -22; st.pitch = -8; queue(); });
  if (onChange) onChange(st, queue);
  return { st, paint: queue };
}

let skinView = null;
function applySkinRotation() { if (skinView) skinView.paint(); }

skinView = makeSkinDrag('#skinStage', '#skinBody');

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
let capasDaConta = [];        /* [{ id, name, url }] */
let contaMS = null;           /* conta Microsoft logada nesta sessao */
let contaEhPremium = false;

const ehPirata = (nick) => {
  const c = CONFIG.accounts.find((a) => a.name === nick);
  return !c || /pirata|offline/i.test(c.type || '');
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
    if (info && info.modelo) aplicarModelo(info.modelo === 'slim');
  } catch (e) { /* offline: segue sem capa */ }
}

const SKINS_DEFAULT = ['Ny3san', 'XyvenDev', 'Kauan'];
let savedSkins, skinDraft, capeDraft, slimDraft;
try { savedSkins = JSON.parse(localStorage.getItem('xyven.skins') || 'null') || SKINS_DEFAULT.slice(); }
catch (e) { savedSkins = SKINS_DEFAULT.slice(); }
try { capeDraft = localStorage.getItem('xyven.cape') || 'none'; } catch (e) { capeDraft = 'none'; }
const saveSkins = () => { try { localStorage.setItem('xyven.skins', JSON.stringify(savedSkins)); localStorage.setItem('xyven.cape', capeApplied); } catch (e) { /* sem storage */ } };

function renderSkinEditor() {
  $('#skinEdName').textContent = skinDraft;
  const escolhida = [{ id: 'none', name: 'sem capa' }].concat(capasDaConta).find(c => c.id === capeDraft);
  $('#skinEdMeta').textContent = 'capa: ' + ((escolhida && escolhida.name) || 'sem capa').toLowerCase() + ' · arraste pra girar';
  $('#capeCount').textContent = capasDaConta.length
    ? capasDaConta.length + (capasDaConta.length === 1 ? ' capa' : ' capas')
    : (contaEhPremium ? 'nenhuma capa nesta conta' : 'conta pirata · sem capa');
  $('#skinCount').textContent = savedSkins.length + ' salvas';

  /* lista = SEM CAPA + o que a conta realmente tem */
  const lista = [{ id: 'none', name: 'SEM CAPA', url: '' }].concat(capasDaConta);
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
    </button>`).join('');

  buildSkinInto('#skinEdBody', skinDraft, 5, capeDraft, slimDraft);
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
    if (!capasDaConta.some((c) => c.id === capeDraft)) capeDraft = 'none';
    renderSkinEditor();
  });
};

$('#capeList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cape]'); if (!b || b.disabled) return;
  capeDraft = b.dataset.cape; renderSkinEditor();
});

$('#skinList').addEventListener('click', (e) => {
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

$('#skinApply').onclick = () => {
  profile.skin = skinDraft;
  profile.slim = slimDraft;
  capeApplied = capeDraft;
  saveProfile(); saveSkins(); renderProfile();
  close($('#skinOverlay'));
};

/* gira a prévia do editor de forma independente da tela de perfil */
const skinEdView = makeSkinDrag('#skinEdStage', '#skinEdBody');

/* ---- painéis dev… ---- */
let devQuery = '';

function renderMembers() {
  const q = devQuery.trim().toLowerCase();
  const list = members.filter(m => !q || m.nick.toLowerCase().includes(q));

  if (!list.length) {
    $('#devMembers').innerHTML = '<div class="empty">nenhuma conta com esse nick.</div>';
    return;
  }

  $('#devMembers').innerHTML = list.map(m => `
    <div class="member" data-nick="${esc(m.nick)}">
      <span class="avatar" style="width:44px;height:44px;font-size:19px;border-width:3px" data-skin="${esc(m.nick)}">${esc(m.nick[0])}</span>
      <div style="min-width:0">
        <div class="member__nick">${esc(m.nick)}</div>
        <div class="dev__badges" style="margin-top:7px">
          ${ALL_BADGES.map(b => {
            const on = m.badges.includes(b.id);
            return `<button class="dev__chip ${on ? 'is-on' : ''}" data-badge="${b.id}" style="${on ? 'background:' + b.bg + ';color:' + b.fg : ''}">${b.label}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="member__side">
        <select data-group>
          <option value="player" ${m.group === 'player' ? 'selected' : ''}>jogador</option>
          <option value="dev" ${m.group === 'dev' ? 'selected' : ''}>dev</option>
        </select>
        <button class="link-btn link-btn--danger" data-remove>remover</button>
      </div>
    </div>`).join('');
  paintSkins($('#devMembers'));
}

function openDev() { renderMembers(); open($('#devOverlay')); }

/* toda alteração de cargo/grupo passa por aqui — salva e repinta */
function devApply(fn) {
  fn();
  saveMembers(); applyGroup(); renderMembers(); renderProfile();
}

$('#devMembers').addEventListener('click', (e) => {
  const row = e.target.closest('[data-nick]'); if (!row) return;
  const m = memberOf(row.dataset.nick); if (!m) return;

  const chip = e.target.closest('[data-badge]');
  if (chip) return devApply(() => {
    const id = chip.dataset.badge;
    const had = m.badges.includes(id);
    m.badges = had ? m.badges.filter(x => x !== id) : m.badges.concat([id]);
    /* só apita se o cargo mexido for da conta que está usando o launcher */
    if (m.nick.toLowerCase() === String(state.account).toLowerCase()) notifyBadge(id, !had);
  });

  if (e.target.closest('[data-remove]')) return devApply(() => {
    members = members.filter(x => x !== m);
  });
});

$('#devMembers').addEventListener('change', (e) => {
  const row = e.target.closest('[data-nick]');
  if (!row || !e.target.matches('[data-group]')) return;
  const m = memberOf(row.dataset.nick); if (!m) return;
  devApply(() => { m.group = e.target.value; });
});

$('#devSearch').addEventListener('input', (e) => { devQuery = e.target.value; renderMembers(); });

$('#devAdd').onclick = () => {
  const nick = $('#devNewNick').value.trim();
  if (!nick || memberOf(nick)) { $('#devNewNick').focus(); return; }
  members.push({ nick, group: 'player', badges: [] });
  $('#devNewNick').value = '';
  devApply(() => {});
};

$('#devReset').onclick = () => {
  members = freshMembers();
  try { localStorage.removeItem('xyven.members'); } catch (e) { /* sem storage */ }
  devApply(() => {});
};

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
        return `<div class="notif__item ${n.read ? '' : 'is-new'}">
          <span class="notif__mark" style="background:${b ? b.bg : 'var(--sand)'};color:${b ? b.fg : 'var(--ink)'}">${b ? b.label.slice(0, 4) : '—'}</span>
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

document.addEventListener('click', (e) => {
  const p = $('#notifPanel');
  if (!p.hidden && !p.contains(e.target) && !$('#bellBtn').contains(e.target)) p.hidden = true;
});

/* boot das telas novas — depois dos blocos, senao pega TDZ */
renderNotifs();
if (profile.nick !== state.account) { profile.nick = state.account; profile.skin = state.account; }
applyGroup(); renderProfile();
