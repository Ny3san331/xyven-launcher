# Xyven Launcher

Launcher de **Minecraft: Java Edition** para Windows, feito em Electron.

Baixa os arquivos oficiais direto da Mojang, confere a integridade de cada um por SHA-1 e abre o jogo localmente. Tema "fita cassete": papel amarelado, contorno grosso, sombra dura, canto reto.

---

## Estado atual

| | |
|---|---|
| Baixar e abrir o jogo | funciona (testado na 1.8.9) |
| Verificação por SHA-1 e cache | funciona — a segunda execução abre em segundos |
| Detecção de Java instalado | funciona |
| Conta offline (só o nick) | funciona |
| Console com log ao vivo | funciona |
| Tempo de jogo e servidores | funciona |
| Login Microsoft | **implementado, aguardando liberação da API** (veja abaixo) |
| Discord Rich Presence | não implementado |
| Abrir junto com o Windows | não implementado |

---

## Como rodar

Precisa de **Node.js 20+** e de um **JDK** instalado (Java 8 para 1.8–1.16, Java 17 para 1.18+, Java 21 para 1.20.5+).

```bash
npm install
npm run build     # compila renderer, main e preload
npm start         # abre o app
```

Durante o desenvolvimento da interface:

```bash
npm run dev       # servidor do Vite em localhost:5173
```

> A interface abre no navegador pelo `npm run dev`, mas **iniciar o jogo só funciona no app**: o renderer não tem acesso a disco nem a rede por decisão de arquitetura.

Gerar o instalador (NSIS, Windows):

```bash
npm run make      # sai em dist/
```

---

## Como está organizado

```
electron/
  main.ts        processo principal, janela e IPC
  preload.ts     ponte contextBridge (única via entre renderer e sistema)
  minecraft.ts   manifesto, download, SHA-1, natives, classpath, spawn da JVM
  auth.ts        login Microsoft (device code) e cofre do refresh token
src/
  index.html     estrutura
  styles.css     tema
  renderer.js    JS puro, sem framework
```

**Regras de arquitetura**, mantidas em todo o projeto:

- `contextIsolation: true`, `sandbox: true`, sem `nodeIntegration`
- Nenhuma chamada de rede ou de disco no renderer — tudo por IPC nomeado
- Nenhuma dependência de runtime: o motor usa só módulos nativos do Node
  (inclusive um leitor de ZIP próprio para extrair as *natives* do LWJGL)

---

## Login Microsoft

O login usa o **fluxo device code** do OAuth 2.0:

1. O launcher pede um código à Microsoft
2. Mostra o código e abre o navegador do usuário
3. O usuário entra na conta dele, no navegador dele
4. O launcher detecta a aprovação e segue: Xbox Live → XSTS → Minecraft → perfil

**O launcher nunca vê a senha.** O *refresh token* é guardado cifrado pelo sistema operacional
(`safeStorage` do Electron), nunca em texto puro e nunca no `localStorage`.

### Situação da API

O `client_id` do app está em `electron/auth.ts`. Ele **não é segredo** — todo launcher carrega o
seu dentro do binário, e por isso o app é registrado como cliente público, sem client secret.

Hoje o `api.minecraftservices.com` responde **403 `Invalid app registration`** para este app.
Desde a mudança de política da Microsoft, novos registros precisam solicitar acesso à API do
Minecraft pelo formulário em <https://aka.ms/mce-reviewappid>. As etapas anteriores da cadeia
(Microsoft, Xbox Live e XSTS) já passam normalmente.

Enquanto isso, funciona tudo que não depende de sessão online: singleplayer, LAN e servidores
com `online-mode=false`.

---

## Onde ficam os arquivos

O launcher usa a mesma estrutura do launcher oficial, então dá para aproveitar o que já estiver
baixado, e mods e saves continuam funcionando:

```
%APPDATA%\.minecraft\
  versions/<v>/<v>.jar + <v>.json
  libraries/...
  assets/indexes + assets/objects
  natives/<v>/
  logs/xyven-<data>_<hora>.log     ← log de cada sessão (guarda os 10 mais recentes)
```

Preferências ficam em `localStorage` sob o prefixo `xyven.`. O refresh token fica em
`%APPDATA%\xyven-launcher\contas\refresh.json`, cifrado.

---

## Sobre o design

Telas, cores, tipografia e espaçamento vêm de uma referência mantida fora deste repositório;
o código aqui não inventa estilo. Fontes **Alfa Slab One** e **Space Mono**, servidas localmente
em `.woff2` para o app funcionar offline.

Duas telas são provisórias e serão trocadas quando o design chegar: o **console** e o
**login Microsoft**. Ambas reaproveitam componentes existentes em vez de criar linguagem visual nova.

---

## Licença

Ainda não definida.

*Não afiliado à Mojang ou à Microsoft. Minecraft é marca registrada da Mojang Studios.*
