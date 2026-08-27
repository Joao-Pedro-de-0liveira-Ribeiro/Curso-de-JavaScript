/* ============================================================================
 * Painel de Custos TI — Backend proxy seguro (Grupo 3RN)
 * ----------------------------------------------------------------------------
 * Por que existe: tokens da DigitalOcean, chaves da AWS e a key do DeepSeek
 * NUNCA podem ficar no frontend (qualquer visitante veria o código-fonte e
 * roubaria os segredos). Este servidor fica no backend, guarda os segredos
 * em variáveis de ambiente e expõe só endpoints de LEITURA que o dashboard
 * consome. É a "forma mais segura e adequada" de ligar os dados em tempo real.
 *
 * ---- FILTRO DE DATA ----
 * Os endpoints de custo aceitam ?start=YYYY-MM-DD&end=YYYY-MM-DD. O intervalo
 * escolhido no frontend é repassado para a consulta:
 *   - AWS Cost Explorer usa exatamente esse período (e calcula a janela
 *     ANTERIOR de mesmo tamanho para comparar).
 *   - DeepSeek usa o período só como rótulo (a API não expõe custo por data).
 *   - DigitalOcean é run-rate mensal atual (a API não dá custo histórico por
 *     dia); o período não altera os valores da DO.
 *
 * Endpoints (todos GET, somente leitura):
 *   GET /api/health                         -> status
 *   GET /api/usd-brl                        -> { rate, updatedAt }
 *   GET /api/digitalocean                   -> { droplets, databases, reservedIps }
 *   GET /api/aws?start=&end=                -> { resources[], total, periodo }
 *   GET /api/deepseek?start=&end=           -> { balanceUsd, spentUsdManual, note }
 *   GET /api/licencas                       -> { claudeUsers, claudeUnitBrl, figmaLicencas, figmaUnitBrl }
 *   GET /api/all?start=&end=                -> tudo de uma vez
 *
 * Segredos/config lidos do ambiente (ver .env.example) — jamais commitados.
 * Requisitos: Node 18+ (fetch nativo). AWS via @aws-sdk/client-cost-explorer.
 * ==========================================================================*/
'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

/* ------------------------------- utils ---------------------------------- */
function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

// cache simples em memória (evita estourar rate limit das APIs)
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

const isoDay = (d) => d.toISOString().slice(0, 10);
// normaliza start/end recebidos; default = mês corrente
function resolveRange(params) {
  const now = new Date();
  const defStart = isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const defEnd = isoDay(now);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(params.get('start') || '') ? params.get('start') : defStart;
  let end = /^\d{4}-\d{2}-\d{2}$/.test(params.get('end') || '') ? params.get('end') : defEnd;
  if (end <= start) end = isoDay(new Date(new Date(start).getTime() + 86400000)); // >= 1 dia
  return { start, end };
}
// janela anterior de mesmo tamanho, imediatamente antes de "start"
function previousRange(start, end) {
  const s = new Date(start), e = new Date(end);
  const len = e - s;
  const prevEnd = s;
  const prevStart = new Date(s.getTime() - len);
  return { start: isoDay(prevStart), end: isoDay(prevEnd) };
}

/* --------------------------- 1) USD / BRL -------------------------------- */
async function getUsdBrl() {
  return cached('fx', 10 * 60 * 1000, async () => {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    return { rate: j.rates.BRL, updatedAt: j.time_last_update_utc || new Date().toISOString() };
  });
}

/* ------------------------- 2) DigitalOcean ------------------------------- */
// Doc: https://docs.digitalocean.com/reference/api/  (Bearer token READ)
async function getDigitalOcean() {
  const token = process.env.DO_TOKEN;
  if (!token) throw new Error('DO_TOKEN ausente no ambiente');
  const headers = { Authorization: `Bearer ${token}` };
  const api = async (path) => {
    const r = await fetch(`https://api.digitalocean.com/v2/${path}`, { headers });
    if (!r.ok) throw new Error(`DO ${path} -> HTTP ${r.status}`);
    return r.json();
  };
  return cached('do', 5 * 60 * 1000, async () => {
    const [drop, dbs, ips] = await Promise.all([
      api('droplets?per_page=200'),
      api('databases'),
      api('reserved_ips?per_page=200'),
    ]);
    const droplets = (drop.droplets || []).map((d) => ({
      nome: d.name,
      tipo: 'Droplet',
      regiao: d.region && d.region.slug,
      spec: d.size_slug,
      usd: (d.size && d.size.price_monthly) || 0, // preço mensal real do size
      ip: ((d.networks && d.networks.v4 && d.networks.v4.find((n) => n.type === 'public')) || {}).ip_address || '—',
    }));
    const databases = (dbs.databases || []).map((d) => ({
      nome: d.name, tipo: 'DB', regiao: d.region, spec: `${d.engine} v${d.version} · ${d.size}`, usd: 0,
    }));
    const reservedIps = (ips.reserved_ips || []).map((i) => ({
      ip: i.ip, regiao: i.region && i.region.slug, atribuido: !!i.droplet, // idle = sem droplet -> $4/mês
    }));
    return { droplets, databases, reservedIps, updatedAt: new Date().toISOString() };
  });
}

/* ----------------------------- 3) AWS ------------------------------------ */
// Cost Explorer: custo por serviço no período pedido. IAM MÍNIMO: ce:GetCostAndUsage.
async function getAws(range) {
  let CostExplorerClient, GetCostAndUsageCommand;
  try {
    ({ CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer'));
  } catch (_) {
    throw new Error('Instale @aws-sdk/client-cost-explorer (npm i) para habilitar AWS');
  }
  const prev = previousRange(range.start, range.end);
  const key = `aws:${range.start}:${range.end}`;
  return cached(key, 30 * 60 * 1000, async () => {
    const client = new CostExplorerClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const query = (s, e) => client.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: s, End: e },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    }));
    const [cur, pr] = await Promise.all([query(range.start, range.end), query(prev.start, prev.end)]);
    const toMap = (r) => {
      const m = {};
      (r.ResultsByTime || []).forEach((t) =>
        (t.Groups || []).forEach((g) => {
          m[g.Keys[0]] = (m[g.Keys[0]] || 0) + (+g.Metrics.UnblendedCost.Amount);
        }));
      return m;
    };
    const curMap = toMap(cur), prevMap = toMap(pr);
    const resources = Object.keys(curMap).map((servico) => ({
      nome: servico, servico: shortService(servico),
      atual: +curMap[servico].toFixed(2),
      anterior: +(prevMap[servico] || 0).toFixed(2),
      detalhe: '', projeto: '—',
    })).sort((a, b) => b.atual - a.atual);
    const total = resources.reduce((s, r) => s + r.atual, 0);
    return { resources, total: +total.toFixed(2), periodo: range, periodoAnterior: prev, updatedAt: new Date().toISOString() };
  });
}
// abrevia "Amazon Elastic Compute Cloud - Compute" -> "EC2" p/ o chip do card
function shortService(name) {
  const map = {
    'Amazon Relational Database Service': 'RDS',
    'Amazon Elastic Container Service': 'ECS',
    'Amazon Elastic Compute Cloud - Compute': 'EC2',
    'EC2 - Other': 'EC2',
    'Amazon Virtual Private Cloud': 'VPC',
    'Amazon Elastic Load Balancing': 'ELB',
    'AmazonCloudWatch': 'CW',
    'AWS Secrets Manager': 'SM',
    'Amazon Simple Storage Service': 'S3',
    'AWS WAF': 'WAF',
    'Amazon EC2 Container Registry (ECR)': 'ECR',
    'Tax': 'Tax',
  };
  return map[name] || (name.length > 10 ? name.slice(0, 10) : name);
}

/* --------------------------- 4) DeepSeek --------------------------------- */
// A API do DeepSeek expõe SALDO (endpoint /user/balance) — não o custo por
// período. O "Total cost" que aparece no console é digitado à mão (env), ou
// calculado a partir dos tokens (ver README). Aqui devolvemos:
//   balanceUsd     -> saldo restante ao vivo (se DEEPSEEK_API_KEY setada)
//   spentUsdManual -> gasto do período informado à mão (env DEEPSEEK_USD_MANUAL)
async function getDeepseek(range) {
  const key = process.env.DEEPSEEK_API_KEY;
  let balanceUsd = null;
  if (key) {
    try {
      const r = await fetch('https://api.deepseek.com/user/balance', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      if (r.ok) {
        const j = await r.json();
        const info = (j.balance_infos || []).find((b) => b.currency === 'USD') || (j.balance_infos || [])[0];
        if (info) balanceUsd = +info.total_balance;
      }
    } catch (_) { /* mantém null; não vaza erro */ }
  }
  return {
    balanceUsd,
    spentUsdManual: +(process.env.DEEPSEEK_USD_MANUAL || 0),
    periodo: range,
    note: 'DeepSeek expõe apenas saldo; informe o "Total cost" do console em DEEPSEEK_USD_MANUAL ou digite no painel.',
  };
}

/* --------------------------- 5) Licenças --------------------------------- */
function getLicencas() {
  return {
    claudeUsers: +(process.env.CLAUDE_PRO_USERS || 19),
    claudeUnitBrl: +(process.env.CLAUDE_PRO_UNIT_BRL || 110),
    figmaLicencas: +(process.env.FIGMA_LICENSES || 1),
    figmaUnitBrl: +(process.env.FIGMA_UNIT_BRL || 120),
  };
}

/* ------------------------------ router ----------------------------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const range = resolveRange(u.searchParams);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    switch (u.pathname) {
      case '/api/health':       return send(res, 200, { ok: true, ts: Date.now() });
      case '/api/usd-brl':      return send(res, 200, await getUsdBrl());
      case '/api/digitalocean': return send(res, 200, await getDigitalOcean());
      case '/api/aws':          return send(res, 200, await getAws(range));
      case '/api/deepseek':     return send(res, 200, await getDeepseek(range));
      case '/api/licencas':     return send(res, 200, getLicencas());
      case '/api/all': {
        const [fx, dobj, aws, ds] = await Promise.all([
          getUsdBrl().catch((e) => ({ error: String(e.message) })),
          getDigitalOcean().catch((e) => ({ error: String(e.message) })),
          getAws(range).catch((e) => ({ error: String(e.message) })),
          getDeepseek(range).catch((e) => ({ error: String(e.message) })),
        ]);
        return send(res, 200, { fx, digitalocean: dobj, aws, deepseek: ds, licencas: getLicencas(), periodo: range });
      }
      default: return send(res, 404, { error: 'not found' });
    }
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) }); // nunca vaza segredo
  }
});

server.listen(PORT, () => {
  console.log(`[custos-ti] backend seguro em http://localhost:${PORT}`);
  console.log(`[custos-ti] CORS liberado para: ${ALLOWED_ORIGIN}`);
});
