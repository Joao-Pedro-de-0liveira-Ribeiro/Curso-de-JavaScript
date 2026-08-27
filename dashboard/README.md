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

## 1. Ver o dashboard agora (modo snapshot)

Basta abrir `index.html` no navegador (duplo clique) — ou servir a pasta:

```bash
cd dashboard
python3 -m http.server 5500    # depois abra http://localhost:5500
```

Vem com o **snapshot real de 27/08/2026**: os custos da **AWS** são os valores verdadeiros do **Cost Explorer** (agosto $1.308,69 · julho $1.859,46, total por serviço), e a **cotação do dólar de 27/08/2026 = R$ 5,15** (consultada no dia). O custo por recurso dentro de cada serviço é um rateio (o Cost Explorer só expõe por serviço sem tags de alocação); o subtotal do serviço é exato. O botão **"ao vivo"** busca o câmbio atual em tempo real de uma API pública de câmbio (não precisa de segredo). As plataformas aparecem com o **logo real** (DigitalOcean, AWS, Claude, Figma, DeepSeek), não emojis.

### Como interagir (só clique)
- **6 KPIs** no topo: total consolidado, DO, AWS, **Claude Pro (em R$)**, DeepSeek e IPs ociosos.
- **Gráfico de rosca interativo**: passe o mouse numa fatia (mostra valor e % no centro) e **clique** para abrir a plataforma; a legenda também é clicável.
- **Filtro por datas** (sem atalhos): você escolhe **De** e **Até**; o painel gera os valores para o intervalo. No modo snapshot os custos de DO/AWS são **rateados proporcionalmente aos dias** (licenças ficam fixas); com backend, os valores são exatos do Cost Explorer.
- **AWS em 2 níveis**: primeiro os **serviços** (RDS, ECS, EC2…) com o que é cada um e o subtotal; **clique** num serviço para ver os recursos; clique num recurso para o **detalhe**.
- **DigitalOcean em 2 níveis**: categorias (Droplets, Managed Databases, Snapshots, IPs ociosos) → clique para ver os itens → clique no item para o **detalhe**.
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
- **DigitalOcean** é *run-rate* mensal atual (a API não expõe custo histórico por dia), então não muda com a data.

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
| `/api/digitalocean` | droplets, databases, IPs reservados (idle = sem droplet) |
| `/api/aws?start=&end=` | custo por serviço no intervalo × janela anterior (Cost Explorer) |
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
