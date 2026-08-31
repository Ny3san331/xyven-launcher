# Backend do Xyven

Guarda cargos e capas num lugar só, pra que dar um item pra alguém valha no
launcher **daquela pessoa**, em qualquer PC — e não apenas na máquina de quem
digitou o comando.

Roda inteiro no Supabase: Postgres para os dados, Edge Functions para a
lógica. Sem servidor separado.

---

## Como a identidade funciona

Não existe cadastro nem senha. O launcher já tem um token de acesso da
Minecraft quando a pessoa entra com conta original:

```
launcher --- x-mc-token: <token> ---> Edge Function
                                            |
                    GET api.minecraftservices.com/minecraft/profile
                                            |
                                <-- { id: uuid, name: nick }
```

Mojang respondeu 200 → o token é legítimo e aquele UUID é a pessoa. Ninguém
consegue fingir ser outro, porque só a Mojang assina essa resposta.

O token **nunca** é gravado. Serve pra perguntar quem é, e é descartado.

Duas consequências que valem entender:

- **A chave `anon` do Supabase é pública.** Ela vai dentro do `.exe`, então
  qualquer um extrai. Por isso ela não escreve nada: o RLS bloqueia, e toda
  escrita acontece dentro de Edge Function com a `service_role`, que só
  existe no servidor.
- **Conta pirata fica de fora.** `_Xvu` é texto digitado, não tem UUID na
  Mojang. Se um item fosse guardado por nick, qualquer um que digitasse
  aquele nick receberia. O `/gift` recusa nick que não existe na Mojang, de
  propósito.

---

## Instalar

### 1. Criar o projeto

Em [supabase.com](https://supabase.com), novo projeto. Anote:

- **Project URL** — `https://xxxx.supabase.co`
- **anon key** — vai dentro do launcher
- **service_role key** — nunca sai do servidor, não põe no launcher

### 2. Aplicar o banco

Painel → **SQL Editor** → cole o conteúdo de [`schema.sql`](schema.sql) →
Run. Pode rodar de novo sem medo, é idempotente.

### 3. Publicar as funções

```bash
npx supabase login
```

```bash
npx supabase link --project-ref SEU_REF
```

O `SEU_REF` é o pedaço do meio da URL (`https://SEU_REF.supabase.co`).

```bash
npx supabase functions deploy --no-verify-jwt
```

**O `--no-verify-jwt` não é opcional.** Por padrão o Supabase tenta validar
um JWT dele no header `Authorization`; o nosso token é da Microsoft e os dois
brigariam. A autenticação real é a verificação na Mojang, feita dentro de
cada função.

### 4. Marcar o primeiro dev

Ovo e galinha: com o banco vazio não há dev, e sem dev ninguém promove
ninguém.

Abra o launcher uma vez com a sua conta original — isso faz o `/identificar`
criar a sua linha. Depois, no SQL Editor:

```sql
select uuid, nick, grupo from jogadores;
```

```sql
update jogadores set grupo = 'dev', cargos = array['dev']
where lower(nick) = 'ny3san';
```

Daí em diante dá pra promover pelo terminal do launcher.

---

## As rotas

Todas em `https://SEU_REF.supabase.co/functions/v1/<nome>`, método `POST`,
com o header `x-mc-token`.

| rota | quem pode | o que faz |
|---|---|---|
| `identificar` | qualquer conta original | diz quem é e o que tem |
| `gift` | só dev | dá um cargo ou capa |
| `tirar` | só dev | remove |
| `grupo` | só dev | promove a dev ou rebaixa |

### Exemplos

```bash
curl -X POST https://SEU_REF.supabase.co/functions/v1/identificar \
  -H "x-mc-token: $TOKEN"
```

```json
{ "uuid": "16c220c3...", "nick": "Ny3san", "grupo": "dev",
  "cargos": ["dev"], "capas": [] }
```

```bash
curl -X POST https://SEU_REF.supabase.co/functions/v1/gift \
  -H "x-mc-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"alvo":"Fulano","item":"pro"}'
```

```json
{ "ok": true, "nick": "Fulano", "item": "pro", "tipo": "cargo" }
```

Erros vêm como `{ "erro": "..." }` com o status certo:

| status | quando |
|---|---|
| 401 | sem token, ou token expirado |
| 403 | não é dev |
| 404 | o nick não existe na Mojang |
| 400 | item ou grupo inválido |
| 503 | a Mojang não respondeu |

O **503 importa**: significa "não consegui confirmar", não "você não tem
nada". O launcher deve seguir com o cache local nesse caso, senão uma
instabilidade da Microsoft apagaria os cargos de todo mundo na tela.

---

## Itens válidos

Ficam em [`supabase/functions/_shared/comum.ts`](supabase/functions/_shared/comum.ts)
e precisam bater com o launcher:

```ts
CARGOS = ['dev', 'fundador', 'pro', 'beta', 'campeao']
CAPAS  = ['caveira', 'moonlight', 'broken', 'enderman']
```

Qualquer coisa fora dessas listas é recusada. Sem essa validação, um erro de
digitação viraria um cargo fantasma que não aparece em lugar nenhum e
ninguém entende por quê.

---

## Coisas que ficaram de fora, de propósito

- **Banimento.** Adiado.
- **Rate limit de verdade.** Há um cache de 5 minutos por token, que corta a
  maioria das idas à Mojang. Ele vive na memória da instância e some quando
  ela recicla — serve pra aliviar, não pra conter abuso. Se virar problema,
  o caminho é uma tabela de contagem.
- **Sincronizar a lista de contas do launcher.** Hoje continua local.

## Um aviso sobre o plano grátis

Projeto sem uso por uma semana é pausado pelo Supabase. Com gente abrindo o
launcher isso não acontece — mas se um dia tudo parar de responder do nada,
é a primeira coisa a checar no painel.
