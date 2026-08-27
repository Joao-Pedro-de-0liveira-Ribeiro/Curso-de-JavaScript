/* ============================================================================
 * Painel de Custos TI — Backend proxy seguro (Grupo 3RN)
 * ----------------------------------------------------------------------------
 * Por que existe: tokens da DigitalOcean, chaves da AWS e a key do DeepSeek
 * NUNCA podem ficar no frontend (qualquer visitante veria o código-fonte e
 * roubaria os segredos). Este servidor fica no backend, guarda os segredos
 * em variáveis de ambiente e expõe só endpoints de LEITURA que o dashboard
 * consome. É a "forma mais segura e adequada" pedida.
 *
 * Endpoints (todos GET, somente leitura):
 *   GET /api/health        -> status
 *   GET /api/usd-brl       -> { rate, updatedAt }               (câmbio, sem segredo)
 *   GET /api/digitalocean  -> { droplets, databases, reservedIps, updatedAt }
 *   GET /api/aws           -> { resources, total, updatedAt }   (Cost Explorer)
 *   GET /api/deepseek      -> { usd, note }                     (billing manual)
 *
 * Segredos lidos do ambiente (ver .env.example) — jamais commitados:
 *   DO_TOKEN                 Personal Access Token da DigitalOcean (escopo READ)
 *   AWS_ACCESS_KEY_ID        IAM com permissão só de ce:GetCostAndUsage
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION               ex.: us-east-1 (Cost Explorer é global)
 *   DEEPSEEK_USD_MANUAL      valor do mês informado à mão (a API não expõe billing)
 *   ALLOWED_ORIGIN           origem do dashboard p/ CORS (ex.: https://custos.3rn...)
 *   PORT                     porta HTTP (default 8787)
 *
 * Requisitos: Node 18+ (fetch nativo). AWS opcional via @aws-sdk/client-cost-explorer.
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

/* --------------------------- 1) USD / BRL -------------------------------- */
// Sem segredo: usa API pública de câmbio. É o único dado seguro p/ o browser
// buscar direto — mas expomos aqui também para ter uma fonte única.
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
      regiao: d.region?.slug,
      spec: d.size_slug,
      usd: d.size?.price_monthly ?? null, // preço mensal real do size
      ip: (d.networks?.v4?.find((n) => n.type === 'public') || {}).ip_address || '—',
    }));
    const databases = (dbs.databases || []).map((d) => ({
      nome: d.name, regiao: d.region, spec: `${d.engine} v${d.version} · ${d.size}`, usd: 0,
    }));
    const reservedIps = (ips.reserved_ips || []).map((i) => ({
      ip: i.ip, regiao: i.region?.slug, atribuido: !!i.droplet, // idle = sem droplet -> $4/mês
    }));
    return { droplets, databases, reservedIps, updatedAt: new Date().toISOString() };
  });
}

/* ----------------------------- 3) AWS ------------------------------------ */
// Usa Cost Explorer (custo por serviço no mês corrente). Requer IAM com
// permissão MÍNIMA: apenas "ce:GetCostAndUsage". Nada de admin.
async function getAws() {
  let CostExplorerClient, GetCostAndUsageCommand;
  try {
    ({ CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer'));
  } catch (_) {
    throw new Error('Instale @aws-sdk/client-cost-explorer (npm i) para habilitar AWS');
  }
  return cached('aws', 30 * 60 * 1000, async () => {
    const client = new CostExplorerClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);

    const query = (s, e) => client.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: s, End: e },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    }));

    const [cur, prev] = await Promise.all([query(start, end), query(prevStart, start)]);
    const toMap = (r) => Object.fromEntries(
      (r.ResultsByTime?.[0]?.Groups || []).map((g) => [g.Keys[0], +g.Metrics.UnblendedCost.Amount])
    );
    const curMap = toMap(cur), prevMap = toMap(prev);
    const resources = Object.keys(curMap).map((servico) => ({
      nome: servico, servico, atual: +curMap[servico].toFixed(2),
      anterior: +(prevMap[servico] || 0).toFixed(2), detalhe: '', projeto: '—',
    }));
    const total = resources.reduce((s, r) => s + r.atual, 0);
    return { resources, total: +total.toFixed(2), updatedAt: new Date().toISOString() };
  });
}

/* --------------------------- 4) DeepSeek --------------------------------- */
// A API do DeepSeek não expõe billing programático. Valor informado à mão
// via env DEEPSEEK_USD_MANUAL (ou 0). Documentado para não induzir a erro.
async function getDeepseek() {
  return {
    usd: +(process.env.DEEPSEEK_USD_MANUAL || 0),
    note: 'DeepSeek não expõe endpoint de billing — informe DEEPSEEK_USD_MANUAL ou digite no painel.',
  };
}

/* ------------------------------ router ----------------------------------- */
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    switch (pathname) {
      case '/api/health':       return send(res, 200, { ok: true, ts: Date.now() });
      case '/api/usd-brl':      return send(res, 200, await getUsdBrl());
      case '/api/digitalocean': return send(res, 200, await getDigitalOcean());
      case '/api/aws':          return send(res, 200, await getAws());
      case '/api/deepseek':     return send(res, 200, await getDeepseek());
      default:                  return send(res, 404, { error: 'not found' });
    }
  } catch (err) {
    // nunca vaza segredo — só a mensagem
    return send(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[custos-ti] backend seguro em http://localhost:${PORT}`);
  console.log(`[custos-ti] CORS liberado para: ${ALLOWED_ORIGIN}`);
});
