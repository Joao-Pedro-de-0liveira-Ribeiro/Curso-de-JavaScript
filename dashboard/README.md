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

Vem com o **snapshot real de 27/08/2026** (os dados que você passou) e a **cotação do dólar de 27/08/2026 = R$ 5,15** (consultada no dia). O botão **"🔄 Cotação ao vivo"** busca o câmbio atual em tempo real de uma API pública de câmbio (não precisa de segredo).

### Como interagir (só clique)
- **6 KPIs** no topo: total consolidado, DO, AWS, Licenças, DeepSeek e IPs ociosos.
- **Rosca + alertas automáticos**: distribuição do gasto e avisos (NAT subiu, RDS dobrou, IPs ociosos…).
- **4 botões de plataforma** → clique para abrir o painel com **todos os recursos** daquela plataforma.
- **Card de recurso AWS** → clique para abrir o **modal de detalhe** (agosto × julho, variação %, projeção 30 dias).
- Campos editáveis por clique: **USD/BRL**, **nº de usuários Claude Pro**, **nº de licenças Figma**, **período** e **gasto do DeepSeek**.
- Botão **🌗 Tema** (claro/escuro) e **Esc** para fechar qualquer painel.

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
   - **DeepSeek:** não há billing via API — informe o valor do mês em `DEEPSEEK_USD_MANUAL` (ou digite no painel).

2. **Configure o backend:**
   ```bash
   cd dashboard/server
   cp .env.example .env      # preencha DO_TOKEN, AWS_*, etc.
   npm install               # instala o SDK do Cost Explorer
   npm start                 # sobe em http://localhost:8787
   ```
   O `.env` real é ignorado pelo git (`.gitignore`) — os segredos não vão para o repositório.

3. **Aponte o dashboard para o backend:** no topo do `index.html`, em `CONFIG`:
   ```js
   const CONFIG = { apiBase: 'http://localhost:8787', /* ... */ };
   ```
   A partir daí o painel busca **DO, AWS e câmbio ao vivo** pelos endpoints do backend.

### Endpoints (todos GET, só leitura)
| Rota | Retorno |
|------|---------|
| `/api/health` | status |
| `/api/usd-brl` | `{ rate, updatedAt }` — câmbio |
| `/api/digitalocean` | droplets, databases, IPs reservados (idle = sem droplet) |
| `/api/aws` | custo por serviço no mês atual × anterior (Cost Explorer) |
| `/api/deepseek` | valor manual do mês |

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
