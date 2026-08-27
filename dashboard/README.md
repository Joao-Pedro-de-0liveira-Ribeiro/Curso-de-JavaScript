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

Vem com o **snapshot real de 27/08/2026** (os dados que você passou) e a **cotação do dólar de 27/08/2026 = R$ 5,15** (consultada no dia). O botão **"ao vivo"** busca o câmbio atual em tempo real de uma API pública de câmbio (não precisa de segredo). As plataformas aparecem com o **logo real** (DigitalOcean, AWS, Claude, Figma, DeepSeek), não emojis.

### Como interagir (só clique)
- **6 KPIs** no topo: total consolidado, DO, AWS, **Claude Pro (em R$)**, DeepSeek e IPs ociosos.
- **Gráfico de rosca interativo**: passe o mouse numa fatia (mostra valor e % no centro) e **clique** para abrir a plataforma; a legenda também é clicável.
- **Alertas automáticos**: NAT subiu, RDS dobrou, IPs ociosos, etc.
- **Filtro de Período**: Este mês · Mês passado · Últimos 7/30 dias · Personalizado (com datas). No modo tempo real, ele muda **como as APIs consultam os dados** (ver seção 2).
- **4 botões de plataforma** → clique para abrir o painel com **todos os recursos**.
- **Card de recurso AWS** → clique para abrir o **modal de detalhe** (atual × anterior, variação %, projeção 30 dias).
- Campos editáveis: **USD/BRL**, **usuários Claude Pro** (mostra o total em R$), **licenças Figma** e **gasto do DeepSeek**.
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

### Custo do DeepSeek — como preencher (a sua pergunta)
A API do DeepSeek **não tem endpoint de "custo por período"** — só o de **saldo** (`/user/balance`).
Então o painel usa duas fontes, ambas atendidas pelo backend:
1. **Saldo ao vivo** (o "Topped-up balance" da sua tela): se você preencher `DEEPSEEK_API_KEY`,
   o card do DeepSeek mostra o saldo restante em tempo real.
2. **Total cost do período** (o "$0,76" da sua tela): esse número **você lê no console**
   (platform.deepseek.com → Usage) e informa em `DEEPSEEK_USD_MANUAL` **ou** digita direto no painel.
   - *Quer 100% automático?* Instrumente suas aplicações para somar `usage.total_tokens` de cada
     resposta da API e multiplique pelo preço por milhão de tokens do DeepSeek — é a única forma
     de obter o custo sem depender do console. (Fica como evolução; o manual já resolve hoje.)

### Endpoints (todos GET, só leitura)
| Rota | Retorno |
|------|---------|
| `/api/health` | status |
| `/api/usd-brl` | `{ rate, updatedAt }` — câmbio |
| `/api/digitalocean` | droplets, databases, IPs reservados (idle = sem droplet) |
| `/api/aws?start=&end=` | custo por serviço no intervalo × janela anterior (Cost Explorer) |
| `/api/deepseek?start=&end=` | `{ balanceUsd, spentUsdManual, note }` |
| `/api/licencas` | Claude Pro / Figma (nº e valor unitário em BRL) |
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
