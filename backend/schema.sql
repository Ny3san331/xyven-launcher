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
