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
 *   GET /api/digitalocean?start=&end=       -> total da(s) fatura(s) do período + itens reais por categoria + byMonth
 *   GET /api/aws?start=&end=                -> { resources[], total, periodo }
 *   GET /api/deepseek?start=&end=           -> { balanceUsd, spentUsdManual, note }
 *   GET /api/licencas                       -> { claudeUsers, claudeUnitBrl, figmaLicencas, figmaUnitBrl }
 *   GET /api/all?start=&end=                -> tudo de uma vez
 *
 * Segredos/config lidos do ambiente (ver .env.example) — jamais commitados.
 * Requisitos: Node 18+ (fetch nativo). AWS via @aws-sdk/client-cost-explorer.
 * ==========================================================================*/
'use strict';

// Carrega o .env ANTES de qualquer process.env (sem isto, as variáveis ficam
// undefined e nada do .env é lido). Silencioso se o pacote não existir.
try { require('dotenv').config(); } catch (_) { console.warn('[custos-ti] dotenv não instalado — rode "npm install"'); }

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const CE_REGION = 'us-east-1';                                   // Cost Explorer só existe em us-east-1
const DESCRIBE_REGION = process.env.AWS_REGION || 'sa-east-1';   // recursos ficam em sa-east-1

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
// Fração da fatura do mês "ym" (YYYY-MM) coberta pelo intervalo [start,end).
// Meses passados: rateia pelos dias do mês. Mês CORRENTE: a fatura já é
// "month-to-date" (acumulado até hoje), então o denominador é o que já correu.
function monthCoverage(start, end, ym) {
  const [y, m] = ym.split('-').map(Number);
  const mStart = Date.UTC(y, m - 1, 1);
  const mEndFull = Date.UTC(y, m, 1); // exclusivo
  const now = new Date();
  const isCurrent = (y === now.getUTCFullYear() && m === now.getUTCMonth() + 1);
  const billedEnd = isCurrent ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) : mEndFull;
  const s = Date.parse(start + 'T00:00:00Z'), e = Date.parse(end + 'T00:00:00Z');
  const lo = Math.max(mStart, s), hi = Math.min(billedEnd, e);
  if (hi <= lo) return 0;
  const denom = billedEnd - mStart;
  return denom > 0 ? (hi - lo) / denom : 0;
}

/* --------------------------- 1) USD / BRL -------------------------------- */
// Fonte primária INTRADIÁRIA (AwesomeAPI, comercial BR); fallback diário (open.er-api).
async function getUsdBrl() {
  return cached('fx', 5 * 60 * 1000, async () => {
    try {
      const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
      if (r.ok) {
        const j = await r.json();
        const b = j.USDBRL;
        if (b && b.bid) return { rate: +(+b.bid).toFixed(4), fonte: 'awesomeapi', updatedAt: b.create_date || new Date().toISOString() };
      }
    } catch (_) { /* cai no fallback */ }
    const r2 = await fetch('https://open.er-api.com/v6/latest/USD');
    const j2 = await r2.json();
    return { rate: j2.rates.BRL, fonte: 'open.er-api', updatedAt: j2.time_last_update_utc || new Date().toISOString() };
  });
}

/* ------------------------- 2) DigitalOcean ------------------------------- */
// Doc: https://docs.digitalocean.com/reference/api/  (Bearer token READ)
// preços mensais (USD) das Managed Databases por size — página de pricing DO
const DB_PRICES = {
  'db-s-1vcpu-1gb': 15.15, 'db-s-1vcpu-2gb': 30.45, 'db-s-2vcpu-4gb': 60.90,
  'db-s-4vcpu-8gb': 122.10, 'db-s-6vcpu-16gb': 244.35, 'db-s-1vcpu-2gb-intel': 30.45,
  'gd-2vcpu-8gb': 122.10, 'gd-4vcpu-16gb': 244.35, 'gd-4vcpu-16gb-intel': 244.35,
  'gd-8vcpu-32gb': 488.70, 'gd-8vcpu-32gb-intel': 488.70,
  'so1_5-2vcpu-16gb-intel': 244.35, 'so1_5-4vcpu-32gb-intel': 488.70, 'so1_5-8vcpu-64gb-intel': 977.40,
};
// chamada REST genérica na DigitalOcean (Bearer token READ + billing)
async function doApi(path) {
  const token = process.env.DO_TOKEN;
  if (!token) throw new Error('DO_TOKEN ausente no ambiente');
  const DO_BASE = process.env.DO_BASE || 'https://api.digitalocean.com/v2/'; // override p/ testes
  const r = await fetch(`${DO_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`DO ${path} -> HTTP ${r.status}`);
  return r.json();
}
// faturas mensais (imutáveis p/ meses fechados; o mês corrente é o acumulado)
const getDoInvoiceList = () => cached('do-invlist', 30 * 60 * 1000, () => doApi('customers/my/invoices?per_page=200'));
// itens da fatura são PAGINADOS — junta TODAS as páginas p/ o total bater com a conta
const getDoInvoiceDetail = (uuid) => cached('do-inv:' + uuid, 30 * 60 * 1000, async () => {
  const items = [];
  let path = `customers/my/invoices/${uuid}?per_page=200`, guard = 0;
  while (path && guard++ < 40) {
    const d = await doApi(path);
    for (const it of (d.invoice_items || [])) items.push(it);
    const next = d && d.links && d.links.pages && d.links.pages.next;
    const m = next && String(next).match(/\/v2\/(.+)$/);
    path = m ? m[1] : null;
  }
  return { invoice_items: items };
});

// quebra os itens de uma fatura nas categorias do painel (valores REAIS da conta)
function categorizeInvoice(detail) {
  const parseAmt = (s) => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const catOf = (p) => { p = String(p || '');
    if (/Backup/i.test(p)) return 'backups';
    if (/Snapshot/i.test(p)) return 'snapshots';
    if (/Database/i.test(p)) return 'databases';
    if (/Floating IP|Reserved IP/i.test(p)) return 'ips';
    if (/Droplet/i.test(p)) return 'droplets';
    return 'outros';
  };
  const cats = { droplets: [], databases: [], backups: [], snapshots: [], ips: [], outros: [] };
  for (const it of (detail.invoice_items || [])) {
    const usd = +parseAmt(it.amount).toFixed(2);
    if (!usd) continue;
    cats[catOf(it.product)].push({
      nome: (it.description || it.product || '').trim(), tipo: it.product || '',
      projeto: it.project_name || '', regiao: '', spec: '', usd,
    });
  }
  for (const k in cats) cats[k].sort((a, b) => b.usd - a.usd);
  return cats;
}

// DO baseada nas FATURAS mensais reais + sincronizada com a data (igual à AWS)
async function getDoFromInvoices(range) {
  const key = `do-inv-range:${range.start}:${range.end}`;
  return cached(key, 15 * 60 * 1000, async () => {
    const list = await getDoInvoiceList();
    const invs = (list.invoices || []).filter((i) => /^\d{4}-\d{2}/.test(i.invoice_period || ''));
    if (!invs.length) throw new Error('nenhuma fatura DO disponível');
    const byMonth = {}, uuidByMonth = {}, statusByMonth = {};
    for (const i of invs) {
      const ym = i.invoice_period.slice(0, 7);
      byMonth[ym] = +i.amount || 0;
      uuidByMonth[ym] = i.invoice_uuid;
      statusByMonth[ym] = i.status;
    }
    // total sincronizado com a data: soma cada fatura × cobertura do intervalo
    let totalUsd = 0, primary = null, primaryContrib = -1;
    for (const ym of Object.keys(byMonth)) {
      const w = monthCoverage(range.start, range.end, ym);
      if (w <= 0) continue;
      const contrib = byMonth[ym] * w;
      totalUsd += contrib;
      if (contrib > primaryContrib) { primaryContrib = contrib; primary = ym; }
    }
    // intervalo fora de qualquer fatura (ex.: futuro) -> usa a mais recente
    if (primary == null) { primary = Object.keys(byMonth).sort().slice(-1)[0]; totalUsd = byMonth[primary]; }
    totalUsd = +totalUsd.toFixed(2);
    // detalhe do mês dominante -> itens reais por categoria (drawer bate com a fatura)
    const cats = categorizeInvoice(await getDoInvoiceDetail(uuidByMonth[primary]));
    // ---- por PRODUTO no mês (valores CHEIOS, p/ os alertas de custo) ----
    const productTotals = (co) => { const p = {}; for (const kk in co) for (const it of co[kk]) { const nm = it.tipo || kk; p[nm] = +(((p[nm] || 0) + it.usd)).toFixed(2); } return p; };
    const prodFull = productTotals(cats);
    // ---- comparação com o mês ANTERIOR -> serviços NOVOS / que aumentaram ----
    let novos = [];
    const ms = Object.keys(byMonth).sort();
    const prevYm = ms.indexOf(primary) > 0 ? ms[ms.indexOf(primary) - 1] : null;
    if (prevYm && uuidByMonth[prevYm]) {
      try {
        const prevProd = productTotals(categorizeInvoice(await getDoInvoiceDetail(uuidByMonth[prevYm])));
        for (const [prod, usd] of Object.entries(prodFull)) {
          const prev = prevProd[prod] || 0;
          if (prev === 0 && usd >= 1) novos.push({ produto: prod, usd: +usd.toFixed(2), prevUsd: 0, delta: +usd.toFixed(2), tipo: 'novo' });
          else if (usd - prev >= Math.max(5, prev * 0.25)) novos.push({ produto: prod, usd: +usd.toFixed(2), prevUsd: +prev.toFixed(2), delta: +(usd - prev).toFixed(2), tipo: 'aumento' });
        }
        novos.sort((a, b) => b.delta - a.delta);
      } catch (_) { /* sem mês anterior detalhável */ }
    }
    const produtos = Object.entries(prodFull).map(([produto, usd]) => ({ produto, usd })).sort((a, b) => b.usd - a.usd);
    // período parcial: escala os itens do DRAWER p/ somarem o total do período (mês cheio -> fator 1)
    const primaryTotal = byMonth[primary] || totalUsd;
    const k = primaryTotal > 0 ? totalUsd / primaryTotal : 1;
    if (Math.abs(k - 1) > 1e-6) for (const key in cats) cats[key].forEach((x) => { x.usd = +(x.usd * k).toFixed(2); });
    const reservedIps = cats.ips.map((it) => ({
      ip: ((it.nome.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1]) || it.nome, atribuido: false, usd: it.usd, regiao: '',
    }));
    const byMonthOut = {};
    Object.keys(byMonth).sort().slice(-8).forEach((ym) => { byMonthOut[ym] = +byMonth[ym].toFixed(2); });
    return {
      droplets: cats.droplets, databases: cats.databases, backups: cats.backups,
      snapshots: cats.snapshots, outros: cats.outros, reservedIps,
      totalUsd, byMonth: byMonthOut, produtos, novos, primaryMonth: primary, prevMonth: prevYm, primaryStatus: statusByMonth[primary],
      billingFonte: `faturas DO (${primary})`, updatedAt: new Date().toISOString(),
    };
  });
}

// ponto de entrada: tenta faturas reais; se o token não tiver billing, estima
async function getDigitalOcean(range) {
  range = range || resolveRange(new URLSearchParams());
  try {
    return await getDoFromInvoices(range);
  } catch (e) {
    const est = await getDoEstimate();
    est.billingFonte = 'estimativa (faturas indisponíveis: ' + String(e.message) + ')';
    return est;
  }
}

// FALLBACK: estimativa por recursos vivos + balance (usado se não houver faturas)
async function getDoEstimate() {
  const token = process.env.DO_TOKEN;
  if (!token) throw new Error('DO_TOKEN ausente no ambiente');
  const headers = { Authorization: `Bearer ${token}` };
  const DO_BASE = process.env.DO_BASE || 'https://api.digitalocean.com/v2/'; // override p/ testes
  const api = async (path) => {
    const r = await fetch(`${DO_BASE}${path}`, { headers });
    if (!r.ok) throw new Error(`DO ${path} -> HTTP ${r.status}`);
    return r.json();
  };
  return cached('do', 5 * 60 * 1000, async () => {
    const [drop, dbs, ips, snaps] = await Promise.all([
      api('droplets?per_page=200'),
      api('databases'),
      api('reserved_ips?per_page=200'),
      api('snapshots?per_page=200&resource_type=droplet'),
    ]);
    const droplets = (drop.droplets || []).map((d) => ({
      nome: d.name, tipo: 'Droplet',
      regiao: d.region && d.region.slug,
      spec: d.size_slug,
      usd: (d.size && d.size.price_monthly) || 0, // preço mensal real do size
      ip: ((d.networks && d.networks.v4 && d.networks.v4.find((n) => n.type === 'public')) || {}).ip_address || '—',
    }));
    const databases = (dbs.databases || []).map((d) => ({
      nome: d.name, tipo: 'DB', regiao: d.region,
      spec: `${d.engine} v${d.version} · ${d.size}`,
      usd: +(((DB_PRICES[d.size] || 0) * (d.num_nodes || 1)).toFixed(2)),
    }));
    const snapshots = (snaps.snapshots || []).map((s) => ({
      nome: s.name, tipo: 'Snapshot', regiao: (s.regions || [])[0] || '',
      spec: `${(s.size_gigabytes || 0).toFixed(1)} GB`,
      usd: +(((s.size_gigabytes || 0) * 0.06).toFixed(2)),
    }));
    const reservedIps = (ips.reserved_ips || []).map((i) => ({
      ip: i.ip, regiao: i.region && i.region.slug, atribuido: !!i.droplet, // idle = sem droplet -> $4/mês
    }));

    // ---- Valor REAL de billing da DO (para os totais baterem com a conta) ----
    // /v2/customers/my/balance -> month_to_date_usage (gasto real do mês até agora).
    let totalUsdMonth = null, mtdUsage = null, billingFonte = 'estimativa';
    try {
      const bal = await api('customers/my/balance');
      mtdUsage = +bal.month_to_date_usage;
      if (!isNaN(mtdUsage) && mtdUsage > 0) {
        const now = new Date();
        const dia = now.getUTCDate();
        const diasNoMes = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
        totalUsdMonth = +(mtdUsage / dia * diasNoMes).toFixed(2); // projeta o mês -> run-rate real
        billingFonte = 'billing DO (month_to_date_usage)';
      }
    } catch (_) { /* token sem escopo de billing -> mantém estimativa */ }

    // Reconcilia os custos por item para SOMAREM o total real (mantém IPs em $4).
    const sum = (a) => a.reduce((s, x) => s + (+x.usd || 0), 0);
    const idleCost = reservedIps.filter((i) => !i.atribuido).length * 4;
    const estSum = sum(droplets) + sum(databases) + sum(snapshots);
    if (totalUsdMonth != null && estSum > 0) {
      const k = Math.max(0, totalUsdMonth - idleCost) / estSum;
      [droplets, databases, snapshots].forEach((arr) => arr.forEach((x) => { x.usd = +(x.usd * k).toFixed(2); }));
    }
    const totalUsd = (totalUsdMonth != null) ? totalUsdMonth : (estSum + idleCost);
    return { droplets, databases, snapshots, reservedIps, totalUsd, mtdUsage, billingFonte, updatedAt: new Date().toISOString() };
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
    const client = new CostExplorerClient({ region: CE_REGION });
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
// período. Então o GASTO é CALCULADO pela API:
//   gasto = total depositado (DEEPSEEK_TOTAL_TOPPED_UP) − saldo topped-up atual
// Devolvemos:
//   balanceUsd -> saldo total ao vivo   |  spentUsd -> gasto calculado
async function getDeepseek(range) {
  // limpa aspas/espaços que às vezes vão parar no .env
  const key = (process.env.DEEPSEEK_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  const rawTot = (process.env.DEEPSEEK_TOTAL_TOPPED_UP || '').trim().replace(/^["']|["']$/g, '');
  const totalToppedUp = rawTot !== '' && !isNaN(+rawTot) ? +rawTot : null;
  const DS_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/user/balance';
  let balanceUsd = null, spentUsd = null, currency = null, error = null, status = null;
  if (!key) {
    error = 'DEEPSEEK_API_KEY não definida no .env';
  } else {
    try {
      const r = await fetch(DS_URL, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      status = r.status;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        error = (j.error && j.error.message) || `HTTP ${r.status}`;
      } else {
        const info = (j.balance_infos || [])[0];             // igual ao seu script: balance_infos[0]
        if (!info) {
          error = 'resposta sem balance_infos (verifique a conta DeepSeek)';
        } else {
          currency = info.currency;                          // normalmente CNY ou USD
          balanceUsd = +info.total_balance;
          const toppedUpRestante = +info.topped_up_balance;
          if (totalToppedUp != null) spentUsd = +(totalToppedUp - toppedUpRestante).toFixed(2);
        }
      }
    } catch (e) {
      error = 'falha de rede ao chamar o DeepSeek: ' + String(e.message || e);
    }
  }
  console.log(`[deepseek] status=${status} balance=${balanceUsd} spent=${spentUsd} currency=${currency}${error ? ' erro=' + error : ''}`);
  return {
    balanceUsd, spentUsd, totalToppedUp, currency, status, error, periodo: range,
    note: 'gasto = DEEPSEEK_TOTAL_TOPPED_UP − topped_up_balance, via /user/balance.',
  };
}

/* --------------------------- 5) Licenças --------------------------------- */
// Valores FIXOS mensais em BRL (o que a empresa paga hoje): Claude Pro R$110,
// Claude Max R$550, Figma R$120. Sobrescreva via env se mudar.
function getLicencas() {
  const brl = (env, def) => +(process.env[env] || def);
  return {
    pro:   { brl: brl('CLAUDE_PRO_BRL', 110) },
    max:   { brl: brl('CLAUDE_MAX_BRL', 550) },
    figma: { brl: brl('FIGMA_BRL',      120) },
  };
}

/* --------------------- 6) Desperdício (recursos ociosos) ------------------ */
// Valida por MÉTRICAS se cada recurso está sendo usado, o último dia de uso e,
// se estiver >7 dias sem uso, alerta. AWS via CloudWatch; DO via monitoring.
const WASTE_WINDOW_DAYS = 8;      // janela de análise
const WASTE_IDLE_DAYS = 7;        // alerta se ocioso há >= 7 dias
async function getWaste() {
  return cached('waste', 15 * 60 * 1000, async () => {
    const items = [];
    const now = Date.now(), DAY = 86400000;
    const start = new Date(now - WASTE_WINDOW_DAYS * DAY), end = new Date(now);
    const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

    /* ================= DigitalOcean ================= */
    const token = process.env.DO_TOKEN;
    if (token) {
      const H = { Authorization: `Bearer ${token}` };
      const doGet = async (p) => (await fetch(`https://api.digitalocean.com/v2/${p}`, { headers: H })).json();
      // FONTE DA VERDADE: a própria fatura marca itens "Unused" (a DO cobra por ocioso).
      // Pega TODO item cuja descrição diz "Unused/Idle" -> ocioso com CUSTO REAL da conta.
      try {
        const list = await getDoInvoiceList();
        const recent = (list.invoices || []).filter((i) => /^\d{4}-\d{2}/.test(i.invoice_period || '')).sort((a, b) => b.invoice_period.localeCompare(a.invoice_period))[0];
        if (recent) {
          const det = await getDoInvoiceDetail(recent.invoice_uuid);
          for (const it of (det.invoice_items || [])) {
            const usd = +(parseFloat(String(it.amount).replace(/[^0-9.\-]/g, '')) || 0).toFixed(2);
            if (usd <= 0) continue;
            const desc = String(it.description || '');
            if (/unused|idle|não usad|nao usad/i.test(desc)) {
              const isIp = /Floating IP|Reserved IP/i.test(it.product || '') || /reserved ip/i.test(desc);
              items.push({ plataforma: 'DigitalOcean', tipo: isIp ? 'Reserved IP ocioso' : `${it.product || 'Recurso'} ocioso`,
                nome: desc.replace(/^Unused\s+(Reserved IP\s*-\s*)?/i, '').trim() || desc, motivo: `cobrado como "Unused" na fatura de ${recent.invoice_period}`, usdMes: usd });
            }
          }
        }
      } catch (_) {}
      // supl.: IP reservado que a API ao vivo mostra sem droplet (se a fatura não pegou)
      try {
        const ips = await doGet('reserved_ips?per_page=200');
        const jaTem = new Set(items.filter((x) => x.tipo === 'Reserved IP ocioso').map((x) => x.nome));
        (ips.reserved_ips || []).filter((i) => !i.droplet && !jaTem.has(i.ip)).forEach((i) =>
          items.push({ plataforma: 'DigitalOcean', tipo: 'Reserved IP ocioso', nome: i.ip, motivo: 'IP reservado sem droplet', usdMes: 5 }));
      } catch (_) {}
      try {
        const vol = await doGet('volumes?per_page=200');
        (vol.volumes || []).filter((v) => !(v.droplet_ids || []).length).forEach((v) =>
          items.push({ plataforma: 'DigitalOcean', tipo: 'Volume solto', nome: v.name, motivo: 'block storage sem droplet', usdMes: +((v.size_gigabytes || 0) * 0.10).toFixed(2) }));
      } catch (_) {}
      // droplets: desligados + SEM TRÁFEGO (uso) há dias, via monitoring/bandwidth
      let droplets = [];
      try { droplets = (await doGet('droplets?per_page=200')).droplets || []; } catch (_) {}
      droplets.filter((d) => d.status && d.status !== 'active').forEach((d) =>
        items.push({ plataforma: 'DigitalOcean', tipo: `Droplet ${d.status}`, nome: d.name, motivo: `droplet ${d.status} ainda gera custo`, usdMes: (d.size && d.size.price_monthly) || 0 }));
      for (const d of droplets.filter((x) => x.status === 'active')) {
        try {
          const s = Math.floor(start / 1000), e = Math.floor(now / 1000);
          const url = `https://api.digitalocean.com/v2/monitoring/metrics/droplet/bandwidth?host_id=${d.id}&interface=public&direction=inbound&start=${s}&end=${e}`;
          const m = await (await fetch(url, { headers: H })).json();
          const values = (((m.data || {}).result || [])[0] || {}).values;
          if (!values || !values.length) continue;                 // sem agente de monitoring -> pula
          let lastTs = 0, maxv = 0;
          values.forEach(([ts, v]) => { const val = +v; if (val > maxv) maxv = val; if (val > 500) lastTs = Math.max(lastTs, ts); }); // >500 B/s = uso real
          if (maxv < 500) {
            const dias = lastTs ? Math.round((now / 1000 - lastTs) / 86400) : WASTE_WINDOW_DAYS;
            if (dias >= WASTE_IDLE_DAYS) items.push({ plataforma: 'DigitalOcean', tipo: 'Droplet ocioso', nome: d.name,
              motivo: `sem tráfego de rede há ${dias}+ dias`, usdMes: (d.size && d.size.price_monthly) || 0,
              diasOcioso: dias, ultimoUso: lastTs ? isoDate(lastTs * 1000) : null });
          }
        } catch (_) {}
      }
      // databases: a API da DO não expõe métricas de uso -> sinaliza p/ revisão manual
      try {
        const db = await doGet('databases');
        (db.databases || []).forEach((d) => items.push({ plataforma: 'DigitalOcean', tipo: 'Managed DB', nome: d.name,
          motivo: 'DO não expõe uso por API — confirme se este banco está em uso', usdMes: null, revisar: true }));
      } catch (_) {}
    }

    /* ================= AWS (CloudWatch = uso real) ================= */
    let cw = null, GetMetric = null;
    try {
      const cwm = require('@aws-sdk/client-cloudwatch');
      cw = new cwm.CloudWatchClient({ region: DESCRIBE_REGION });
      GetMetric = cwm.GetMetricStatisticsCommand;
    } catch (_) {}
    // devolve {lastUsed, diasOcioso, ocioso} para uma métrica diária
    const metricIdle = async (Namespace, MetricName, Dimensions, Stat) => {
      if (!cw) return null;
      const r = await cw.send(new GetMetric({ Namespace, MetricName, Dimensions, StartTime: start, EndTime: end, Period: 86400, Statistics: [Stat] }));
      const pts = (r.Datapoints || []).map((p) => ({ t: +new Date(p.Timestamp), v: p[Stat] || 0 })).sort((a, b) => a.t - b.t);
      const used = pts.filter((p) => p.v > 0);
      const lastUsed = used.length ? used[used.length - 1].t : null;
      const dias = lastUsed ? Math.round((now - lastUsed) / DAY) : WASTE_WINDOW_DAYS;
      return { lastUsed, diasOcioso: dias, ocioso: !used.length || dias >= WASTE_IDLE_DAYS };
    };
    // RDS: bancos sem conexões
    try {
      const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
      const rds = new RDSClient({ region: DESCRIBE_REGION });
      const dd = await rds.send(new DescribeDBInstancesCommand({}));
      for (const db of (dd.DBInstances || [])) {
        const m = await metricIdle('AWS/RDS', 'DatabaseConnections', [{ Name: 'DBInstanceIdentifier', Value: db.DBInstanceIdentifier }], 'Maximum');
        if (m && m.ocioso) items.push({ plataforma: 'AWS', tipo: 'RDS sem conexões', nome: db.DBInstanceIdentifier,
          motivo: `0 conexões há ${m.diasOcioso}+ dias (${db.DBInstanceClass})`, usdMes: null,
          diasOcioso: m.diasOcioso, ultimoUso: m.lastUsed ? isoDate(m.lastUsed) : null });
      }
    } catch (_) {}
    // ELB (ALB): balanceadores sem requisições
    try {
      const { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } = require('@aws-sdk/client-elastic-load-balancing-v2');
      const elb = new ElasticLoadBalancingV2Client({ region: DESCRIBE_REGION });
      const lbs = await elb.send(new DescribeLoadBalancersCommand({}));
      for (const lb of (lbs.LoadBalancers || [])) {
        if (lb.Type !== 'application') continue;
        const dim = (lb.LoadBalancerArn.split(':loadbalancer/')[1]) || '';    // app/nome/id
        const m = await metricIdle('AWS/ApplicationELB', 'RequestCount', [{ Name: 'LoadBalancer', Value: dim }], 'Sum');
        if (m && m.ocioso) items.push({ plataforma: 'AWS', tipo: 'Load Balancer sem tráfego', nome: lb.LoadBalancerName,
          motivo: `0 requisições há ${m.diasOcioso}+ dias`, usdMes: null,
          diasOcioso: m.diasOcioso, ultimoUso: m.lastUsed ? isoDate(m.lastUsed) : null });
      }
    } catch (_) {}
    // ECS: serviço com 0 tarefas rodando
    try {
      const { ECSClient, ListClustersCommand, ListServicesCommand, DescribeServicesCommand } = require('@aws-sdk/client-ecs');
      const ecs = new ECSClient({ region: DESCRIBE_REGION });
      const cl = await ecs.send(new ListClustersCommand({}));
      for (const arn of (cl.clusterArns || [])) {
        const sv = await ecs.send(new ListServicesCommand({ cluster: arn, maxResults: 100 }));
        const arns = sv.serviceArns || [];
        for (let i = 0; i < arns.length; i += 10) {
          const dd = await ecs.send(new DescribeServicesCommand({ cluster: arn, services: arns.slice(i, i + 10) }));
          (dd.services || []).forEach((s) => {
            if ((s.desiredCount || 0) > 0 && (s.runningCount || 0) === 0)
              items.push({ plataforma: 'AWS', tipo: 'ECS parado', nome: s.serviceName, motivo: 'serviço com 0 tarefas rodando (paga mesmo parado)', usdMes: null });
          });
        }
      }
    } catch (_) {}
    // EC2: EBS solto + Elastic IP não associado
    try {
      const { EC2Client, DescribeVolumesCommand, DescribeAddressesCommand } = require('@aws-sdk/client-ec2');
      const ec2 = new EC2Client({ region: DESCRIBE_REGION });
      const vol = await ec2.send(new DescribeVolumesCommand({ Filters: [{ Name: 'status', Values: ['available'] }] }));
      (vol.Volumes || []).forEach((v) =>
        items.push({ plataforma: 'AWS', tipo: 'EBS solto', nome: v.VolumeId, motivo: 'volume EBS não anexado', usdMes: +((v.Size || 0) * 0.10).toFixed(2) }));
      const ips = await ec2.send(new DescribeAddressesCommand({}));
      (ips.Addresses || []).filter((a) => !a.AssociationId).forEach((a) =>
        items.push({ plataforma: 'AWS', tipo: 'Elastic IP ocioso', nome: a.PublicIp, motivo: 'IP elástico não associado', usdMes: 3.6 }));
    } catch (_) {}
    console.log(`[waste] ${items.length} recurso(s) ocioso(s) detectado(s)`);
    return items;
  });
}

/* --------------------- 7) Pessoas das licenças (persistidas) -------------- */
// Salva num arquivo no servidor para ficar sempre configurado (compartilhado).
const PEOPLE_FILE = path.join(__dirname, 'data', 'pessoas.json');
function readPeople() {
  try { return JSON.parse(fs.readFileSync(PEOPLE_FILE, 'utf8')); }
  catch (_) { return { pro: [], max: [], figma: [] }; }
}
function writePeople(obj) {
  const clean = {
    pro:   Array.isArray(obj.pro)   ? obj.pro.map(String).slice(0, 500)   : [],
    max:   Array.isArray(obj.max)   ? obj.max.map(String).slice(0, 500)   : [],
    figma: Array.isArray(obj.figma) ? obj.figma.map(String).slice(0, 500) : [],
  };
  fs.mkdirSync(path.dirname(PEOPLE_FILE), { recursive: true });
  fs.writeFileSync(PEOPLE_FILE, JSON.stringify(clean, null, 2));
  return clean;
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

/* ------------------------------ static ----------------------------------- */
function serveIndex(res) {
  try {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('index.html não encontrado');
  }
}

/* ------------------------------ router ----------------------------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const range = resolveRange(u.searchParams);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  // serve o painel (para o front auto-conectar ao mesmo host)
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) return serveIndex(res);
  try {
    switch (u.pathname) {
      case '/api/health':       return send(res, 200, { ok: true, ts: Date.now() });
      case '/api/usd-brl':      return send(res, 200, await getUsdBrl());
      case '/api/digitalocean': return send(res, 200, await getDigitalOcean(range));
      case '/api/aws':          return send(res, 200, await getAws(range));
      case '/api/deepseek':     return send(res, 200, await getDeepseek(range));
      case '/api/licencas':     return send(res, 200, getLicencas());
      case '/api/waste':        return send(res, 200, await getWaste());
      case '/api/pessoas':
        if (req.method === 'POST') return send(res, 200, { ok: true, pessoas: writePeople(await readBody(req)) });
        return send(res, 200, { pessoas: readPeople() });
      case '/api/all': {
        const [fx, dobj, aws, ds, waste] = await Promise.all([
          getUsdBrl().catch((e) => ({ error: String(e.message) })),
          getDigitalOcean(range).catch((e) => ({ error: String(e.message) })),
          getAws(range).catch((e) => ({ error: String(e.message) })),
          getDeepseek(range).catch((e) => ({ error: String(e.message) })),
          getWaste().catch(() => []),
        ]);
        return send(res, 200, { fx, digitalocean: dobj, aws, deepseek: ds, licencas: getLicencas(), waste, pessoas: readPeople(), periodo: range });
      }
      default: return send(res, 404, { error: 'not found' });
    }
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) }); // nunca vaza segredo
  }
});

server.listen(PORT, () => {
  console.log(`[custos-ti] Painel + API em  http://localhost:${PORT}`);
  console.log(`[custos-ti] Abra esse endereço no navegador — o painel se conecta sozinho e puxa tudo ao vivo.`);
});
