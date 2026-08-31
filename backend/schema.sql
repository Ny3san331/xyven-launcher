-- ============================================================
-- Xyven — esquema do banco
--
-- Aplique isto uma vez, no SQL Editor do painel do Supabase.
-- É idempotente: rodar duas vezes não quebra nada.
-- ============================================================

-- ------------------------------------------------------------
-- jogadores
--
-- A chave é o UUID da Mojang, NUNCA o nick. Nick muda de dono:
-- se os cargos estivessem amarrados ao nome, quem trocasse de
-- nick perderia tudo, e quem pegasse o nome antigo herdaria.
-- ------------------------------------------------------------
create table if not exists jogadores (
  uuid       text primary key,                 -- sem hífens, como a Mojang devolve
  nick       text not null,                    -- último nick visto, só pra exibir
  grupo      text not null default 'player',   -- 'player' | 'dev'
  cargos     text[] not null default '{}',     -- dev, fundador, pro, beta, campeao
  capas      text[] not null default '{}',     -- ids de capa liberados
  visto_em   timestamptz not null default now(),
  criado_em  timestamptz not null default now(),
  constraint grupo_valido check (grupo in ('player', 'dev'))
);

-- buscar por nick acontece no /gift, quando o alvo ainda não existe
create index if not exists jogadores_nick_idx on jogadores (lower(nick));

-- ------------------------------------------------------------
-- concessoes
--
-- Quem deu o quê pra quem. Não é enfeite: no dia que aparecer um
-- FUNDADOR numa conta que não devia, é a única forma de saber de
-- onde veio.
-- ------------------------------------------------------------
create table if not exists concessoes (
  id         bigserial primary key,
  alvo_uuid  text not null references jogadores(uuid) on delete cascade,
  item       text not null,                    -- id do cargo ou da capa
  tipo       text not null,                    -- 'cargo' | 'capa'
  acao       text not null,                    -- 'dar' | 'tirar'
  por_uuid   text not null,                    -- quem fez
  criado_em  timestamptz not null default now(),
  constraint tipo_valido check (tipo in ('cargo', 'capa')),
  constraint acao_valida check (acao in ('dar', 'tirar'))
);

create index if not exists concessoes_alvo_idx on concessoes (alvo_uuid, criado_em desc);

-- ============================================================
-- Row Level Security
--
-- A chave `anon` vai dentro do .exe do launcher — ou seja, é
-- pública, qualquer um extrai. Então ela não pode escrever nada.
-- Toda escrita passa por Edge Function, que usa a service_role e
-- só existe no servidor.
-- ============================================================
alter table jogadores  enable row level security;
alter table concessoes enable row level security;

-- leitura de jogadores liberada: o launcher precisa saber quem tem o quê.
-- não há nada sensível aqui — nick, cargos e capas são coisas públicas.
drop policy if exists jogadores_leitura on jogadores;
create policy jogadores_leitura on jogadores
  for select using (true);

-- nenhuma política de insert/update/delete: com RLS ligado e sem
-- política, a chave anon simplesmente não escreve. A service_role
-- ignora RLS por natureza, então as Edge Functions seguem podendo.

-- concessoes é histórico interno: nem leitura pra anon.
-- (RLS ligado, zero políticas = ninguém que não seja service_role acessa)

-- ============================================================
-- Primeiro dev
--
-- Ovo e galinha: com o banco vazio não existe dev, e sem dev
-- ninguém promove ninguém. Abra o launcher uma vez com a sua conta
-- original pra que o /identificar crie a sua linha, e então rode:
--
--   update jogadores set grupo = 'dev', cargos = array['dev']
--   where lower(nick) = 'ny3san';
--
-- Confira antes de rodar:
--   select uuid, nick, grupo from jogadores;
-- ============================================================

-- ============================================================
-- pendentes  (adicionado depois; rode este bloco no SQL Editor)
--
-- Item dado a um nick que ainda nao existe na tabela. Fica aqui
-- ate alguem entrar no launcher com aquele nick.
--
-- Por que nao resolver o nick pela Mojang na hora do /gift: nick
-- de conta pirata costuma existir na Mojang como conta de OUTRA
-- pessoa. Resolver ali mandava o item, calado, pro estranho.
-- Guardando por nick e entregando na entrada, quem recebe e quem
-- de fato usa aquele nome no client.
-- ============================================================
create table if not exists pendentes (
  nick       text primary key,                 -- sempre minusculo
  cargos     text[] not null default '{}',
  capas      text[] not null default '{}',
  por_uuid   text not null,
  criado_em  timestamptz not null default now()
);

alter table pendentes enable row level security;
-- sem politicas: so a service_role (Edge Functions) enxerga

-- ============================================================
-- avisos  (adicionado depois; rode este bloco no SQL Editor)
--
-- Recado que aparece pra todo mundo ao abrir o launcher. Guarda
-- historico em vez de sobrescrever: da pra saber o que foi dito
-- e quando, e o launcher usa o id pra saber se ja mostrou.
-- ============================================================
create table if not exists avisos (
  id         bigserial primary key,
  titulo     text not null,
  texto      text not null default '',
  por_uuid   text not null,
  criado_em  timestamptz not null default now()
);

alter table avisos enable row level security;
-- sem politicas: so a service_role (Edge Functions) enxerga

-- ------------------------------------------------------------
-- avisos.alvo  (adicionado depois; rode este bloco tambem)
--
-- O aviso passou a ser endereçado: vai pro nick que o dev escolheu,
-- nao pra todo mundo. Guardado em minusculo, igual `pendentes`.
-- ------------------------------------------------------------
alter table avisos add column if not exists alvo text;
create index if not exists avisos_alvo_idx on avisos (alvo, id desc);

-- ------------------------------------------------------------
-- Aviso em tempo real  (rode este bloco tambem)
--
-- `mudou_em` e uma campainha: /gift e /title carimbam a hora aqui,
-- o launcher da pessoa escuta a linha DELA pelo Realtime e refaz a
-- consulta normal. O evento nao carrega conteudo nenhum.
--
-- Por que assim e nao escutando `avisos` direto: o Realtime respeita
-- RLS, entao escutar `avisos` exigiria deixar a tabela publica — e
-- qualquer um com a chave anon leria todo recado privado ja enviado.
-- `jogadores` ja e publica de proposito (nick, cargos, capas).
-- ------------------------------------------------------------
alter table jogadores add column if not exists mudou_em timestamptz not null default now();

-- Envolvido em DO porque `add table` nao aceita IF NOT EXISTS: rodar
-- duas vezes dava erro 42710, e como o SQL Editor roda tudo numa
-- transacao so, o erro desfazia os comandos de cima junto.
do $$
begin
  alter publication supabase_realtime add table jogadores;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- postagens  (rode este bloco no SQL Editor)
--
-- O "Lado B". So dev escreve; todo mundo le. Diferente de `avisos`,
-- aqui a leitura publica e o ponto: e conteudo feito pra ser visto,
-- e e o que permite escutar a tabela pelo Realtime sem expor nada.
--
-- `id` e bigserial, nao Date.now() do cliente: dois devs postando no
-- mesmo milissegundo em maquinas diferentes colidiriam.
-- ============================================================
create table if not exists postagens (
  id          bigserial primary key,
  titulo      text not null,
  corpo       text not null default '',
  tag         text not null default 'ATUALIZAÇÃO',
  fixado      boolean not null default false,
  destaque    boolean not null default false,   -- "mostrar no inicio"
  autor_uuid  text not null,
  autor_nick  text not null,                    -- congelado: quem trocar de nick
                                                -- nao reescreve a autoria do passado
  criado_em   timestamptz not null default now(),
  editado_em  timestamptz,
  constraint tag_valida check (tag in ('ATUALIZAÇÃO', 'COMUNIDADE', 'EVENTO', 'CORREÇÃO'))
);

create index if not exists postagens_ordem_idx on postagens (fixado desc, id desc);

alter table postagens enable row level security;

-- leitura liberada: e mural publico
drop policy if exists postagens_leitura on postagens;
create policy postagens_leitura on postagens
  for select using (true);

-- sem politica de escrita: a chave anon nao escreve. Toda escrita
-- passa pela Edge Function `posts`, que exige grupo dev.

-- Realtime: qualquer INSERT/UPDATE/DELETE chega em quem esta com o
-- launcher aberto, sem precisar fechar e abrir.
do $$
begin
  alter publication supabase_realtime add table postagens;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- postagens.imagem  (rode este bloco tambem)
--
-- URL da imagem que aparece no card da home e dentro da postagem.
-- Guardamos a URL, nao os bytes: o arquivo vive no Storage, e uma
-- linha de banco com megabyte dentro deixa toda leitura do mural
-- lenta pra mostrar algo que a tela nem sempre usa.
-- ------------------------------------------------------------
alter table postagens add column if not exists imagem text;

-- ============================================================
-- cargos  (rode este bloco no SQL Editor)
--
-- Cargo passou a ser a UNICA coisa que existe: ele e a etiqueta que
-- aparece no perfil E o pacote de permissoes. Antes eram dois
-- conceitos separados — `grupo` (player/dev) mandava no que a pessoa
-- podia fazer, e `cargos` era so enfeite. Ninguem entendia por que
-- ter a tag DEV nao dava acesso a nada.
--
-- `jogadores.cargos` continua sendo a lista de ids que a pessoa tem.
-- `jogadores.grupo` fica so como ponte pra nao trancar ninguem de
-- fora enquanto os cargos nao estao montados (ver exigirPerm).
-- ============================================================
create table if not exists cargos (
  id          text primary key,               -- slug minusculo, sem espaco
  nome        text not null,                  -- como aparece na etiqueta
  cor         text not null default 'sand',   -- token do tema, nunca hex
  permissoes  text[] not null default '{}',
  por_uuid    text,
  criado_em   timestamptz not null default now(),
  -- so cores que existem no tema: hex solto aqui vazaria pro CSS e
  -- quebraria o modo escuro, que troca os tokens
  constraint cor_valida check (cor in ('teal', 'salmon', 'mustard', 'sand', 'ink'))
);

alter table cargos enable row level security;

-- leitura publica: o launcher precisa saber o nome e a cor de cada
-- cargo pra desenhar a etiqueta de qualquer jogador
drop policy if exists cargos_leitura on cargos;
create policy cargos_leitura on cargos
  for select using (true);

-- sem politica de escrita: passa pela Edge Function `cargo`

-- os cinco que ja existiam no launcher, com as mesmas cores de sempre
insert into cargos (id, nome, cor, permissoes) values
  ('dev',      'DEV',      'teal',    '{*}'),
  ('fundador', 'FUNDADOR', 'salmon',  '{}'),
  ('pro',      'PRO',      'mustard', '{}'),
  ('beta',     'BETA',     'sand',    '{}'),
  ('campeao',  'CAMPEÃO',  'ink',     '{}')
on conflict (id) do nothing;

do $$
begin
  alter publication supabase_realtime add table cargos;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- cargos.cor: mais tres  (rode este bloco tambem)
--
-- `red`, `muted` e `paper` ja existiam no tema e nenhum cargo usava.
-- Continua sem hex de proposito: o modo escuro troca os tokens, e cor
-- fixa aqui ficaria ilegivel quando o tema virasse.
-- ------------------------------------------------------------
alter table cargos drop constraint if exists cor_valida;
alter table cargos add constraint cor_valida
  check (cor in ('teal', 'salmon', 'mustard', 'sand', 'ink', 'red', 'muted', 'paper'));
