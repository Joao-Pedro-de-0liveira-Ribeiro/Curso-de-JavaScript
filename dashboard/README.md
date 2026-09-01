# Painel de Custos TI — Grupo 3RN

Dashboard consolidado de custos de infraestrutura: **DigitalOcean + AWS + Licenças (Claude Pro / Figma) + DeepSeek**, com valores em USD e BRL. Todo o painel é **navegável por clique** e cabe em uma tela (sem rolagem longa): os detalhes abrem em painéis e modais sobrepostos.

```
dashboard/
├── index.html          ← o dashboard (arquivo único, sem build, abre no navegador)
├── README.md           ← este guia
└── server/             ← backend seguro para DADOS EM TEMPO REAL
    ├── server.js
    ├── package.json
    ├── .env.example
    └── .gitignore
```

---

## 0. Rodar TUDO ao vivo (recomendado) — o backend serve o painel

Um comando só: o backend serve o `index.html` e o painel **se conecta sozinho**
(sem configurar nada, sem key no front). Tudo é consultado ao vivo pelas APIs
usando o `.env`, e **atualiza conforme as datas** que você escolher:

```bash
cd dashboard/server
cp .env.example .env      # preencha DO_TOKEN, AWS_*, DEEPSEEK_API_KEY, DEEPSEEK_TOTAL_TOPPED_UP=2.00
npm install               # instala tudo, inclusive o dotenv (que lê o .env)
npm start                 # abra http://localhost:8787 no navegador
```

O `server.js` carrega o `.env` automaticamente (`require('dotenv').config()` na
primeira linha) — sem isso, as variáveis ficam `undefined` e nada é lido.

Aí: AWS vem do Cost Explorer **pelo período escolhido** (Julho mostra Julho,
Agosto mostra Agosto), DigitalOcean pelas **faturas mensais reais**, DeepSeek
pela API, câmbio ao vivo. Os **alertas automáticos** mostram: o que
**aumentou/diminuiu** por serviço no período, **serviços novos ou que cresceram
gerando custo** (ex.: backups, um banco maior — comparando com o mês anterior da
fatura), e **recursos ociosos com o custo REAL** (IPs cobrados como *Unused* na
fatura, volumes soltos, ECS parado). Nada fica “mockado” no front — se a API da
DO falhar, o card mostra o erro em vez de um número falso.

> **Porta 8787 ocupada** (`EADDRINUSE`)? Um `npm start` anterior ficou vivo.
> Mate antes: `kill $(lsof -t -i:8787)` (ou mude `PORT` no `.env`).

## 1. Só ver o layout (snapshot offline)

Sem backend, abra `index.html` direto (duplo clique). Ele usa o último snapshot
real (AWS por mês: Jul $1.859 / Ago $1.309) só para você ver o desenho — o rodapé
avisa “snapshot offline”. Para dados ao vivo, use o passo 0.

Vem com o **snapshot real de 27/08/2026**: os custos da **AWS** são os valores verdadeiros do **Cost Explorer** (agosto $1.308,69 · julho $1.859,46, total por serviço), e a **cotação do dólar de 27/08/2026 = R$ 5,15** (consultada no dia). O custo por recurso dentro de cada serviço é um rateio (o Cost Explorer só expõe por serviço sem tags de alocação); o subtotal do serviço é exato. O botão **"ao vivo"** busca o câmbio atual em tempo real de uma API pública de câmbio (não precisa de segredo). As plataformas aparecem com o **logo real** (DigitalOcean, AWS, Claude, Figma, DeepSeek), não emojis.

### Como interagir (só clique)
- **6 KPIs** no topo: total consolidado, DO, AWS, **Claude Pro (em R$)**, DeepSeek e IPs ociosos.
- **Gráfico de rosca interativo**: passe o mouse numa fatia (mostra valor e % no centro) e **clique** para abrir a plataforma; a legenda também é clicável.
- **Filtro por datas** (sem atalhos): você escolhe **De** e **Até**; o painel gera os valores para o intervalo. No modo snapshot os custos de DO/AWS são **rateados proporcionalmente aos dias** (licenças ficam fixas); com backend, os valores são exatos do Cost Explorer.
- **Exportar relatório** (no topo, ao lado das datas): **PDF** (abre o relatório com o mesmo design do painel e manda imprimir → *Salvar como PDF*) e **Excel** (`.xlsx` com abas Resumo / DigitalOcean / AWS / Licenças / Ociosos; se estiver sem internet, cai num CSV que o Excel abre). O relatório usa **o período selecionado** e os valores atuais.
- **AWS em 2 níveis**: primeiro os **serviços** (RDS, ECS, EC2…); **clique** num serviço para ver os **recursos nomeados** (ex.: *Instância db.m6g.xl*, *Fargate vCPU*, *NAT Gateway*, *Storage GP3*), vindos do Cost Explorer por `USAGE_TYPE` — dinâmico (recurso novo aparece sozinho). Clique num recurso para o **detalhe**.
- **DigitalOcean em 2 níveis**: categorias (Droplets, Managed Databases, Backups, Snapshots, IPs ociosos) vindas da **fatura real** → clique para ver os itens → clique no item para o **detalhe**. O subtotal de cada categoria e o total **batem com a fatura da DO**.
- **Licenças por pessoa**: no card **Licenças** você cadastra cada pessoa em Claude Pro, Claude Max e Figma (nome → chip; × remove). O custo é `nº de pessoas × valor unitário`; **zero pessoas = R$0**. As pessoas ficam salvas no navegador (`localStorage`); o **valor unitário é buscado dos preços oficiais** (Claude Pro US$20, Claude Max US$100/5x, Figma ~US$16) convertidos pelo **dólar ao vivo** — então acompanham o câmbio.
- **Datas**: o seletor **De/Até** usa um calendário próprio no tema do site (sem o calendário branco do navegador).
- **IPs ociosos**: clique no card **IPs Ociosos DO** para ver o detalhe e **quanto dá para economizar** (por IP, por mês e por ano).
- **DeepSeek automático**: o gasto é calculado por `total depositado − saldo`. Duas formas: (a) **backend** com `DEEPSEEK_API_KEY` + `DEEPSEEK_TOTAL_TOPPED_UP=2.00` no `.env` — o painel puxa pronto; (b) **sem backend**, preencha a key no painel (ou em `CONFIG.deepseekKey`) — o cálculo roda no navegador (o DeepSeek libera CORS) e a key fica só no dispositivo.
- **USD/BRL** fica no topo, com cotação ao vivo. Os números **animam** ao atualizar, e o painel se auto-atualiza a cada 5 min.
- Botão **Tema** (claro/escuro) e **Esc** para fechar qualquer painel.

> Valores fixos usados: **Claude Pro = R$ 110,00/usuário/mês** e **Figma = R$ 120,00/licença/mês**.

---

## 2. Ligar os DADOS EM TEMPO REAL — a forma segura

> **Regra de ouro:** token da DigitalOcean, chave da AWS e key do DeepSeek **NUNCA** entram no HTML/JS do frontend. Qualquer pessoa que abrir a página veria o código-fonte e roubaria os segredos. Por isso os segredos ficam num **backend** e o dashboard só conversa com esse backend.

```
  Navegador (index.html)  ──HTTPS──►  Backend proxy (server/)  ──►  DigitalOcean API
   sem nenhum segredo                 guarda os segredos             AWS Cost Explorer
                                      em variáveis de ambiente       API de câmbio
```

### Passo a passo

1. **Crie credenciais de LEITURA (menor privilégio possível):**
   - **DigitalOcean:** API → Tokens → *Generate New Token* marcando **apenas "Read"**.
   - **AWS:** um usuário IAM cuja política contenha somente `ce:GetCostAndUsage` (Cost Explorer). Nada de admin.
   - **DeepSeek:** veja a seção **"Custo do DeepSeek"** abaixo — a API só expõe saldo, o custo é informado à mão.

2. **Configure o backend (é aqui que você coloca as credenciais):**
   ```bash
   cd dashboard/server
   cp .env.example .env      # preencha DO_TOKEN, AWS_*, DEEPSEEK_*, licenças…
   npm install               # instala o SDK do Cost Explorer
   npm start                 # sobe em http://localhost:8787
   ```
   O `.env` real é ignorado pelo git (`.gitignore`) — os segredos não vão para o repositório.
   Todas as variáveis estão comentadas no **`.env.example`**.

3. **Aponte o dashboard para o backend:** no topo do `index.html`, em `CONFIG`:
   ```js
   const CONFIG = { apiBase: 'http://localhost:8787', /* ... */ };
   ```
   A partir daí o painel busca **DO, AWS, DeepSeek, licenças e câmbio ao vivo** pelo backend,
   e o **filtro de data** do topo é enviado às APIs (ver abaixo).

### Filtro de data → reflete em como as APIs consultam
O seletor **Período** (Este mês · Mês passado · Últimos 7/30 dias · Personalizado) monta
`?start=YYYY-MM-DD&end=YYYY-MM-DD` e envia ao backend:
- **AWS Cost Explorer** consulta exatamente esse intervalo e calcula a **janela anterior de mesmo tamanho** para o comparativo (▲/▼).
- **DeepSeek** usa o intervalo só como rótulo (a API não dá custo por data).
- **DigitalOcean** usa as **faturas mensais reais** (`/v2/customers/my/invoices` + o detalhe paginado de cada fatura): o total do período é a soma de cada fatura mensal ponderada pelos dias cobertos pelo intervalo (o mês corrente é o acumulado *month-to-date*). Assim **Julho mostra a fatura de Julho, Agosto a de Agosto** — bate com a conta da DO. O detalhamento traz **cada recurso individual** (cada droplet, cada banco, cada backup/snapshot, cada IP) com **nome, projeto e valor reais** da fatura, e **soma exatamente o total**.

### Custo do DeepSeek — CALCULADO pela API
A API do DeepSeek expõe só o **saldo** (`/user/balance`), não o custo por período.
Então o gasto é **calculado**, sem digitar nada:

```
gasto = DEEPSEEK_TOTAL_TOPPED_UP  −  saldo topped-up atual (da API)
```

- `DEEPSEEK_API_KEY` → o painel mostra o **saldo ao vivo** e calcula o gasto.
- `DEEPSEEK_TOTAL_TOPPED_UP` → o total já depositado na conta (ex.: `2.00`).
- O backend faz `total − saldo` e devolve `spentUsd`; o painel converte para BRL.
- Observação: como é baseado no saldo, o valor é **acumulado desde o depósito** (não por data).

### Endpoints (todos GET, só leitura)
| Rota | Retorno |
|------|---------|
| `/api/health` | status |
| `/api/usd-brl` | `{ rate, updatedAt }` — câmbio |
| `/api/digitalocean?start=&end=` | total da(s) **fatura(s) mensal(is)** no período + itens reais por categoria (droplets, databases, backups, snapshots, IPs) + `byMonth` |
| `/api/aws?start=&end=` | custo por **serviço + recurso** (`USAGE_TYPE`) no intervalo × janela anterior (Cost Explorer) |
| `/api/deepseek` | `{ balanceUsd, spentUsd, totalToppedUp }` (gasto calculado) |
| `/api/licencas` | `{ fx, pro, max, figma }` — preço oficial (USD) × dólar, em BRL |
| `/api/all?start=&end=` | tudo junto (o painel usa este quando `apiBase` está setado) |

> **Integração validada**: com o `.env` preenchido, o `/api/all` devolve AWS real
> do Cost Explorer, câmbio ao vivo e preços de licença; DO e DeepSeek entram
> assim que `DO_TOKEN` e `DEEPSEEK_API_KEY` estiverem no `.env`. Sem `apiBase`,
> o painel usa o último snapshot real (não é mock inventado).
| `/api/all?start=&end=` | tudo de uma vez (o painel usa este) |

### Boas práticas de segurança aplicadas
- Segredos só em **variáveis de ambiente** (em produção, use o *Secrets Manager* da AWS / *env* da plataforma). Nunca no código, nunca no git.
- Backend expõe **somente leitura** e **somente o necessário** (nenhuma ação de escrita/gestão).
- **CORS travado** para a origem do dashboard (`ALLOWED_ORIGIN`).
- Credenciais com **menor privilégio** (DO só *Read*; AWS só `ce:GetCostAndUsage`).
- Cache curto em memória p/ não estourar rate limit das APIs.
- Mensagens de erro **não vazam** os segredos.

---

## 3. Integração no boilerplate Vue (opcional)

Este dashboard reproduz, em HTML puro, o mesmo desenho do módulo `custos-ti` (Vue + Tailwind) descrito em `COMO_INTEGRAR.md`. Para usá-lo dentro do frontend Vue, mantenha os componentes do módulo e troque o `composables/useCustosData.ts` por chamadas ao backend acima (via `AxiosHttpClient`, seguindo o padrão `HttpExampleRepository.ts`), apontando para os mesmos endpoints `/api/...`.
