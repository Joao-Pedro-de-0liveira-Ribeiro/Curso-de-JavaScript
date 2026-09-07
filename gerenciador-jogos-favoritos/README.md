# 🎮 Gerenciador de Jogos Favoritos

Extensão de navegador (Manifest V3) para **descobrir, salvar, classificar e priorizar
jogos** com o mínimo de fricção — tão rápido quanto os favoritos do navegador, mas com
metadados ricos, filtros e ordenação. Feita para **Vivaldi** e qualquer navegador baseado
em **Chromium** (Chrome, Edge, Brave, Opera…).

Substitui o antigo sistema de "pastas de favoritos nomeadas pela data de lançamento" por
uma **lista filtrável e ordenável**, exatamente como descrito na especificação
`PROMPT_Gerenciador_de_Jogos_Favoritos.md`.

---

## ✨ O que ela faz

### Fluxo principal (YouTube → Steam → Validar → Favoritar)
1. Você está vendo um vídeo no YouTube sobre um jogo.
2. Clica no ícone da extensão. Ela procura o **link da Steam na descrição do vídeo**.
3. **Valida o jogo na Steam Store API** (`appdetails`) e mostra **nome, capa, data e preço**.
4. Um clique em **Favoritar** → entra direto na lista. Sem pasta, sem renomear nada.

> A extensão resolve um problema que um site comum **não** consegue: a API da Steam não
> envia cabeçalhos CORS, então uma página web normal não pode consultá-la. O *service
> worker* da extensão pode (graças a `host_permissions`).

### Todas as formas de adicionar
- **Na página da Steam** → o popup já valida e mostra os dados.
- **Colando qualquer URL** (Steam, YouTube, itch.io, Nintendo, Google Play, Kickstarter,
  Twitter, site de dev) no popup ou no gerenciador.
- **Clique direito** em um link ou na página → *"Favoritar este jogo"* (menu de contexto).
- **Lead "a pesquisar"** → só o nome de um jogo que você ouviu falar (substitui as buscas
  do Google que hoje viram favoritos soltos).
- **Importando seu arquivo `.html`** de favoritos do navegador (migração — veja abaixo).

### Classificação (o coração da ferramenta)
Cada jogo guarda: **gênero**, **estilo visual** (inclui *Pixel Primitivo*), **vibe/humor**
(nostalgia, contemplação, kawaii, surpresa…), **intenção** (jogar / só assistir "Detonado"
/ rejogar / comprar e apoiar / treinar), **prioridade** (alta/média/baixa), **status de
lançamento** com **contagem regressiva**, **tempo para zerar**, **preço/desconto** e
**notas**. Todos os campos são tags **abertas e extensíveis**: se você digitar uma categoria
nova no editor (ex.: um gênero próprio), ela é salva **e** vira um filtro clicável na barra
lateral automaticamente.

**Capas automáticas:** Steam e YouTube ganham capa na hora pelo `appid`/id do vídeo; as
**outras fontes** (itch, Nintendo, Google Play, Kickstarter, sites de dev, YouTube playlist)
têm a capa lida da própria página (`og:image`/estrutura do site) **automaticamente ao importar**.
No editor de cada jogo ainda há **🖼️ Buscar capa** e **🔎 Google Imagens** (para leads do Google).

**Estilo/tags da Steam (automático ao importar):** a extensão lê a página da loja e traz as tags
populares que a API não expõe — *Gráficos Pixelados* vira estilo *Pixel Art*, *Retrô* vira vibe
*Nostalgia*, etc.

**Lançamento validado pela Steam:** a validação marca corretamente **se já lançou**, o **ano** e
a **data** — e há um filtro **Ano de lançamento** na barra lateral.

### ⏱ Tempo para zerar (Main Story) — lista embutida + HowLongToBeat
O tempo real (só **Main Story**) vem, na maioria das vezes, de uma **lista de 242 jogos
já embutida no próprio projeto** (`tempos_dados.js`, gerada de `ferramentas/tempos.txt`).
Como ela é carregada sempre, a extensão preenche o tempo **na hora**, sem depender do
HowLongToBeat ao vivo (que costuma bloquear consultas feitas pelo navegador).

A extensão **não** consulta o tempo de todos os jogos pela internet na página principal.
O tempo é preenchido assim:

- **Ao importar (`.html`/`.json`)**: todo jogo cujo nome esteja na lista embutida já
  recebe o tempo automaticamente — e ao abrir o gerenciador ele também backfilla os que faltam.
- **Ao favoritar/adicionar um jogo novo** (popup, clique-direito ou editor): a extensão
  procura o tempo **1º na lista embutida (+ a sua importada), 2º no HowLongToBeat ao vivo**, e salva.
- **No card (editor)**: botão **⏱ HowLongToBeat** preenche o campo pela lista; se o jogo não
  estiver nela, tenta o HLTB ao vivo; se nada achar, avisa para você preencher à mão
  (não abre mais o site).
- **Adicionar mais tempos**: na aba **⬇ Importar**, cole/importe uma lista `Nome - 8.93h`
  (uma por linha) e clique em **Aplicar tempos** — casa por nome e preenche de uma vez.
  Com o campo **vazio**, o botão **Aplicar** reaplica a lista embutida aos jogos existentes.
- **JSON de tempos (por nome)**: na aba **⬇ Importar**, selecione um `.json` de tempos. Ele
  **casa por nome** (não precisa de AppID/URL) e preenche os jogos existentes — e fica salvo
  para os próximos imports. Formatos aceitos:

  ```jsonc
  // (a) array de objetos
  [ { "nome": "Dead Cells", "tempo_para_zerar": 14.06 },
    { "nome": "Celeste",    "tempo_para_zerar": 8 } ]

  // (b) formato simples "nome": horas
  { "Dead Cells": 14.06, "Celeste": 8, "#BLUD": "8.93h" }
  ```

  > Um **backup completo** (`.json` com `jogos`/`id`/`url_origem`) continua sendo restaurado
  > normalmente — a extensão detecta se o JSON é backup ou lista de tempos.

> **Editar a lista embutida:** altere `ferramentas/tempos.txt` e rode
> `python3 ferramentas/gerar_tempos.py` para regenerar `tempos_dados.js`.

- **Em massa, para jogos fora da lista** (se o HLTB bloquear o navegador): use o script Python em `ferramentas/`:

  ```bash
  pip install howlongtobeatpy --break-system-packages
  # 1) na extensão: ⇅ Backup → Exportar tudo (JSON)
  python3 ferramentas/preencher_hltb.py jogos-favoritos-AAAA-MM-DD.json
  # 2) na extensão: ⇅ Backup → Restaurar de um JSON (com "Mesclar"), escolha o *-hltb.json
  ```

  Ele preenche o **tempo para zerar** (Main Story) de cada jogo. Depois, o badge **⏱ Xh** e o
  filtro **⚡ Zera rápido** passam a usar o valor real por jogo (o antigo “5h fixo” foi removido).

### Filtros, ordenação e visões prontas
- Filtros combináveis (E lógico) por todos os campos acima, incluindo **ano de lançamento**,
  **🏷️ em promoção** e **progresso** (✔ já zerei / 🎯 falta zerar).
- Ordenar por lançamento (contagem regressiva), tempo para zerar, prioridade, desconto, nome.
- **Visões de 1 clique**: ⚡ Zera rápido · ⏳ Vão lançar ainda · 🔥 Prioridade alta ·
  👀 Só assistir · 💜 Comprar e apoiar · 🔁 Rejogar · 🏷️ Em promoção · ✔ Zerados · 🔎 A pesquisar.

### Uma aba de importação para tudo
A aba **⬇ Importar** aceita **três tipos** de arquivo (detecta sozinha):
`.html` (favoritos do navegador), `.json` (backup desta extensão) e `.txt` (lista de tempos).
Também dá para **restaurar JSON** pela aba **⇅ Backup**. O import é rápido (mescla em lote) e
**não duplica**.

### Tudo automático (sem botões)
- **Ao importar**, a extensão valida tudo sozinha: capa, nome limpo, preço, gênero,
  **estilo/tags** (pixel, retrô, anime…) e **se já lançou** — os que derem erro aparecem numa lista.
- **Preço e desconto** dos jogos da Steam são consultados **só quando você clica** no botão
  **💲 Atualizar preços** na barra de topo — a extensão **não** bate na Steam sozinha ao abrir a
  página, justamente para **não gerar bloqueio por excesso de acesso (rate limit)**. Depois de
  atualizar, o filtro *🏷️ Em promoção* fica em dia. (Clique de novo enquanto roda para **parar**.)
- **Lançamento é validado pela data**: um jogo marcado como “não lançado” cuja data de
  lançamento (da Steam) já passou vira “lançado” automaticamente.
- No editor, cada categoria (gênero, estilo, vibe) mostra **opções prontas clicáveis**, e o
  **⏱ tempo para zerar** aparece como tag em **todos** os jogos.

---

## 🚀 Instalação (Vivaldi / Chromium)

A extensão roda **sem loja**, carregada localmente ("unpacked"):

1. Baixe/clone esta pasta `gerenciador-jogos-favoritos/`.
2. No navegador, abra a página de extensões:
   - **Vivaldi / Chrome / Brave / Opera:** `chrome://extensions`
   - **Edge:** `edge://extensions`
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** (*Load unpacked*) e selecione a pasta
   `gerenciador-jogos-favoritos/`.
5. Fixe o ícone ⭐ na barra de ferramentas. Pronto.

> Nenhum servidor é necessário. **Todos os dados ficam só no seu navegador**
> (`chrome.storage.local`), privados e disponíveis offline.

---

## 📥 Migração dos favoritos antigos (arquivo `.html`)

1. Exporte seus favoritos como arquivo **`.html`** (Netscape Bookmarks):
   `chrome://bookmarks` → menu ⋮ → *Exportar favoritos*.
2. Abra o gerenciador (ícone da extensão → *"Abrir gerenciador"*, ou clique com o botão
   direito no ícone → *Opções*).
3. Botão **⬇ Importar** → selecione o `.html`.

As pastas viram tags automaticamente:

| Pasta no arquivo | Vira |
|---|---|
| **Detonado** | intenção *só assistir* + link do vídeo |
| **Zera Rapido** (e subpastas) | tempo estimado (entra no filtro ⚡) + gênero/estilo/vibe das subpastas |
| **Vão Lança Ainda** → *2022–2025* | status *não lançado* + **ano alvo** |
| *Extremamente Indefinitivos* | status *indefinido* |
| **Prioridade Alta/Média/Baixa** | prioridade |
| **ReZerar / COMPRRA E ZERA DNV** | intenção *rejogar* |
| **Compre e Admire / Implora Pirataria** | intenção *comprar e apoiar* |
| *Tiro / Luta / RPG / História / Exploração* | gênero |
| *PIXEL PRIMITIVO* | estilo visual |
| *Ambientação e Nostalgia / Contemplação / Kawaii / Surpresa* | vibe |
| Buscas do Google / links sem loja | status *a pesquisar* |
| Anotações entre parênteses no título | movidas para **notas** (título fica limpo) |

**Nenhum link se perde:** além de seguir as pastas, o importador varre *todos* os `<a>` do
arquivo — jogos, buscas do Google (viram leads "a pesquisar") e vídeos do YouTube (guardam
a `url_video`) entram, mesmo em arquivos bagunçados ou links soltos. Ao final ele mostra um
resumo por origem (ex.: `271 Steam · 26 Busca Google · 24 YouTube · …`).

A importação é **idempotente** (reimportar não duplica — casa por `appid`/URL) e
**não destrutiva** (não sobrescreve edições suas). Marque *"Validar links da Steam"* para
enriquecer nome/capa/preço automaticamente após importar (ou use o botão *"Só validar…"*
depois, quantas vezes precisar).

---

## 💾 Backup

Botão **⇅ Backup** no gerenciador: exporta tudo para **JSON** (para levar de máquina) e
restaura (mesclando ou substituindo). Bom para não perder nada se reinstalar o navegador.

---

## ⚙ Configurações

- **Limite de "Zera rápido"** (padrão 6 h) — define o que entra no filtro ⚡.
- **Idioma/País da Steam** (preços em BRL por padrão).
- **Revalidar preços** a cada X horas (padrão 6 h) — janela do botão **💲 Atualizar preços**:
  ao clicar, ele checa todos os jogos da Steam; sem clicar, a extensão nunca consulta preços
  sozinha (evita o rate limit).

---

## 🔒 Permissões e privacidade

| Permissão | Para quê |
|---|---|
| `storage` | Guardar seus jogos localmente. |
| `activeTab` + `scripting` | Ler a aba atual **só quando você clica** no ícone (achar o link da Steam num vídeo). |
| `contextMenus` | Menu de clique direito "Favoritar". |
| `<all_urls>` | Ler as páginas (Steam, YouTube, itch, Nintendo, Play, Kickstarter, dev) para validar dados, tags e capas automaticamente. |

Nada é enviado para servidores de terceiros além das APIs/páginas públicas dos próprios sites.
Todos os dados ficam no seu navegador.

---

## 🗂 Estrutura do código

| Arquivo | Responsabilidade |
|---|---|
| `manifest.json` | Declaração da extensão (MV3). |
| `tempos_dados.js` | Lista de tempos para zerar **embutida** (242 jogos), carregada sempre. Gerada de `ferramentas/tempos.txt` por `ferramentas/gerar_tempos.py`. |
| `shared.js` | Modelo de dados, enums, parsing de URL/appid, storage, derivações, casamento de tempos. |
| `background.js` | *Service worker*: valida Steam, YouTube oEmbed, Open Graph, menu de contexto. |
| `popup.html/js/css` | Captura rápida (fluxo YouTube → Steam → Favoritar). |
| `manager.html/js/css` | Painel completo: lista, filtros, ordenação, visões, edição, import, backup. |
| `importador.js` | Parser do `.html` de favoritos + mapeamento pasta→campo. |
| `icons/` | Ícones (16/32/48/128). |

Feito em **JavaScript puro** (sem build, sem dependências) — direto ao ponto e fácil de ler.
