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
**notas**. Todos os campos são tags **abertas e extensíveis**.

### Filtros, ordenação e visões prontas
- Filtros combináveis (E lógico) por todos os campos acima.
- Ordenar por lançamento (contagem regressiva), tempo para zerar, prioridade, desconto, nome.
- **Visões de 1 clique**: ⚡ Zera rápido · ⏳ Vão lançar ainda · 🔥 Prioridade alta ·
  👀 Só assistir · 💜 Comprar e apoiar · 🔁 Rejogar · 🔎 A pesquisar.

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

A importação é **idempotente** (reimportar não duplica — casa por `appid`/URL) e
**não destrutiva** (não sobrescreve edições suas). Marque *"Validar links da Steam"* para
enriquecer nome/capa/preço automaticamente após importar.

---

## 💾 Backup

Botão **⇅ Backup** no gerenciador: exporta tudo para **JSON** (para levar de máquina) e
restaura (mesclando ou substituindo). Bom para não perder nada se reinstalar o navegador.

---

## ⚙ Configurações

- **Limite de "Zera rápido"** (padrão 6 h) — define o que entra no filtro ⚡.
- **Idioma/País da Steam** (preços em BRL por padrão).
- **Open Graph** — permissão opcional para pré-preencher nome/capa de itch, Nintendo,
  Kickstarter e sites de dev. Fica desligada até você autorizar.

---

## 🔒 Permissões e privacidade

| Permissão | Para quê |
|---|---|
| `storage` | Guardar seus jogos localmente. |
| `activeTab` + `scripting` | Ler a aba atual **só quando você clica** no ícone (achar o link da Steam num vídeo). |
| `contextMenus` | Menu de clique direito "Favoritar". |
| `store.steampowered.com` | Validar jogos na Steam. |
| `*.youtube.com` | Título/thumbnail do vídeo (oEmbed). |
| `<all_urls>` (opcional) | Só se você ligar o Open Graph nas configurações. |

Nada é enviado para servidores de terceiros além das APIs públicas da Steam e do YouTube.

---

## 🗂 Estrutura do código

| Arquivo | Responsabilidade |
|---|---|
| `manifest.json` | Declaração da extensão (MV3). |
| `shared.js` | Modelo de dados, enums, parsing de URL/appid, storage, derivações. |
| `background.js` | *Service worker*: valida Steam, YouTube oEmbed, Open Graph, menu de contexto. |
| `popup.html/js/css` | Captura rápida (fluxo YouTube → Steam → Favoritar). |
| `manager.html/js/css` | Painel completo: lista, filtros, ordenação, visões, edição, import, backup. |
| `importador.js` | Parser do `.html` de favoritos + mapeamento pasta→campo. |
| `icons/` | Ícones (16/32/48/128). |

Feito em **JavaScript puro** (sem build, sem dependências) — direto ao ponto e fácil de ler.
