/* =============================================================================
 * background.js — service worker (MV3)
 *
 * Responsável por tudo que precisa de rede cross-origin (a página do popup
 * não consegue por causa de CORS — a Steam Store API não manda cabeçalho
 * CORS, mas o worker da extensão pode buscar graças a `host_permissions`).
 *
 * Mensagens aceitas (chrome.runtime.sendMessage):
 *   { tipo: 'validar', url }         -> resolve origem + valida Steam/YouTube
 *   { tipo: 'steam', appid }         -> appdetails cru
 *   { tipo: 'youtube', url }         -> oEmbed (título/thumb)
 *   { tipo: 'og', url }              -> Open Graph (precisa permissão opcional)
 * ============================================================================= */
importScripts('shared.js');

const G = self.GJF;

/* ---- Steam ------------------------------------------------------------- */
async function buscarSteam(appid) {
  const cfg = await G.carregarConfig();
  const url = 'https://store.steampowered.com/api/appdetails?appids=' + appid +
    '&l=' + encodeURIComponent(cfg.steamLang) + '&cc=' + encodeURIComponent(cfg.steamCc);
  let resp;
  try {
    resp = await fetch(url, { credentials: 'omit' });
  } catch (e) {
    return { ok: false, erro: 'rede', msg: 'Falha de rede ao consultar a Steam.' };
  }
  if (resp.status === 429) {
    return { ok: false, erro: 'rate', msg: 'A Steam limitou as consultas (rate limit). Tente de novo em instantes.' };
  }
  if (!resp.ok) {
    return { ok: false, erro: 'http', msg: 'Steam respondeu ' + resp.status + '.' };
  }
  let json;
  try { json = await resp.json(); } catch (e) {
    return { ok: false, erro: 'json', msg: 'Resposta inesperada da Steam.' };
  }
  const bloco = json && json[appid];
  if (!bloco || !bloco.success || !bloco.data) {
    return { ok: false, erro: 'inexistente', msg: 'AppID ' + appid + ' não existe ou foi removido da Steam.' };
  }
  const d = bloco.data;
  const rd = d.release_date || {};
  const preco = d.price_overview || null;
  const dados = {
    nome: d.name || '',
    capa_url: d.header_image || '',
    steam_appid: appid,
    origem: 'steam',
    genero: (d.genres || []).map(function (x) { return x.description; }),
    release_str: rd.date || '',
    coming_soon: !!rd.coming_soon,
    is_free: !!d.is_free,
    preco_atual: preco ? preco.final_formatted : (d.is_free ? 'Grátis' : null),
    desconto_pct: preco && preco.discount_percent ? preco.discount_percent : null,
    short_description: d.short_description || ''
  };
  return { ok: true, dados: dados };
}

/* ---- YouTube (oEmbed público, sem chave) ------------------------------- */
async function buscarYouTube(url) {
  const o = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url);
  try {
    const r = await fetch(o, { credentials: 'omit' });
    if (!r.ok) return { ok: false };
    const j = await r.json();
    return {
      ok: true,
      dados: {
        nome: j.title || '',
        capa_url: j.thumbnail_url || '',
        origem: 'youtube',
        autor: j.author_name || ''
      }
    };
  } catch (e) {
    return { ok: false };
  }
}

/* ---- Open Graph genérico (itch/nintendo/kickstarter/dev) --------------- *
 * Precisa de permissão opcional <all_urls>. Se não tiver, retorna sem nada.  */
async function buscarOG(url) {
  const temPerm = await new Promise(function (res) {
    chrome.permissions.contains({ origins: ['<all_urls>'] }, function (has) { res(!!has); });
  });
  if (!temPerm) return { ok: false, semPermissao: true };
  try {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) return { ok: false };
    const html = await r.text();
    const pick = function (prop) {
      const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop +
        '["\'][^>]+content=["\']([^"\']+)["\']', 'i');
      const m = html.match(re);
      return m ? m[1] : '';
    };
    let titulo = pick('og:title') || pick('twitter:title');
    if (!titulo) {
      const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      titulo = t ? t[1].trim() : '';
    }
    const img = pick('og:image') || pick('twitter:image');
    return {
      ok: true,
      dados: {
        nome: decodeHtml(titulo),
        capa_url: img,
        origem: G.detectarOrigem(url)
      }
    };
  } catch (e) {
    return { ok: false };
  }
}

function decodeHtml(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'");
}

/* ---- Orquestrador principal: dada uma URL, resolve o melhor que der ---- */
async function validarUrl(url) {
  url = (url || '').trim();
  if (!url) return { ok: false, msg: 'URL vazia.' };
  const appid = G.extrairAppId(url);
  if (appid) {
    const r = await buscarSteam(appid);
    if (r.ok) { r.dados.url_origem = url; return r; }
    // Steam falhou mas ainda é um link Steam válido → esqueleto manual
    return {
      ok: false, parcial: true, msg: r.msg,
      dados: { origem: 'steam', url_origem: url, steam_appid: appid }
    };
  }
  if (G.ehYouTube(url)) {
    const r = await buscarYouTube(url);
    const dados = (r.ok && r.dados) ? r.dados : { origem: 'youtube' };
    dados.url_origem = url;
    dados.url_video = url;
    return { ok: r.ok, parcial: !r.ok, dados: dados };
  }
  // demais fontes: tenta OG (se permitido), senão esqueleto manual
  const og = await buscarOG(url);
  if (og.ok) { og.dados.url_origem = url; return og; }
  return {
    ok: false, parcial: true, semPermissaoOG: !!og.semPermissao,
    dados: { origem: G.detectarOrigem(url), url_origem: url }
  };
}

/* ---- Roteador de mensagens -------------------------------------------- */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    try {
      if (!msg || !msg.tipo) return sendResponse({ ok: false, msg: 'mensagem inválida' });
      if (msg.tipo === 'validar') return sendResponse(await validarUrl(msg.url));
      if (msg.tipo === 'steam') return sendResponse(await buscarSteam(msg.appid));
      if (msg.tipo === 'youtube') return sendResponse(await buscarYouTube(msg.url));
      if (msg.tipo === 'og') return sendResponse(await buscarOG(msg.url));
      return sendResponse({ ok: false, msg: 'tipo desconhecido' });
    } catch (e) {
      return sendResponse({ ok: false, msg: String(e && e.message || e) });
    }
  })();
  return true; // resposta assíncrona
});

/* ---- Menu de contexto: clique direito em link/página → salvar ---------- */
chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'gjf-salvar-link',
    title: 'Favoritar este jogo (link)',
    contexts: ['link']
  });
  chrome.contextMenus.create({
    id: 'gjf-salvar-pagina',
    title: 'Favoritar este jogo (página atual)',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener(async function (info, tab) {
  const url = info.menuItemId === 'gjf-salvar-link' ? info.linkUrl : (info.pageUrl || (tab && tab.url));
  if (!url) return;
  const r = await validarUrl(url);
  const patch = G.dadosParaPatch(r.dados || { url_origem: url, origem: G.detectarOrigem(url) });
  const res = await G.upsertJogo(patch);
  notificar(res.criado ? 'Favoritado: ' + (patch.nome || url) : 'Já estava na lista: ' + (patch.nome || url));
});

function notificar(texto) {
  // badge rápido (sem permissão de notifications, mantém leve)
  try {
    chrome.action.setBadgeText({ text: 'OK' });
    chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
    setTimeout(function () { chrome.action.setBadgeText({ text: '' }); }, 2500);
  } catch (e) { /* ignore */ }
  console.log('[GJF]', texto);
}
