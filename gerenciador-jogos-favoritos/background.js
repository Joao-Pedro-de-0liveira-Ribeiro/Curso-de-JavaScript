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
    resp = await fetch(url, {
      credentials: 'omit',
      headers: { 'Accept': 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' }
    });
  } catch (e) {
    return { ok: false, erro: 'rede', msg: 'Falha de rede ao consultar a Steam.' };
  }
  // 429 e 403 são, na prática, bloqueio temporário por excesso de consultas
  if (resp.status === 429 || resp.status === 403) {
    return {
      ok: false, erro: 'rate',
      msg: 'A Steam bloqueou temporariamente as consultas (' + resp.status + ') por excesso de acessos. ' +
        'Aguarde alguns minutos e tente de novo — as capas já aparecem sem depender disso.'
    };
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
  try {
    const r = await fetch(url, { credentials: 'omit', headers: { 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' } });
    if (!r.ok) return { ok: false, erro: 'http', status: r.status };
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
    let img = pick('og:image') || pick('twitter:image');
    if (!img) img = imagemEspecifica(html);   // itch / kickstarter / twitter
    return {
      ok: true,
      dados: {
        nome: decodeHtml(titulo),
        capa_url: decodeHtml(img),
        origem: G.detectarOrigem(url)
      }
    };
  } catch (e) {
    return { ok: false };
  }
}

// fallbacks por site quando não há og:image (estruturas fornecidas pelo usuário)
function imagemEspecifica(html) {
  const tentativas = [
    /<img[^>]+class="[^"]*\bscreenshot\b[^"]*"[^>]+src="([^"]+)"/i,      // itch.io
    /<img[^>]+class="[^"]*\bjs-feature-image\b[^"]*"[^>]+src="([^"]+)"/i, // kickstarter
    /<img[^>]+src="(https:\/\/pbs\.twimg\.com\/profile_banners\/[^"]+)"/i, // twitter/x banner
    /<img[^>]+src="(https:\/\/assets\.nintendo\.com\/image\/upload\/[^"]+)"/i, // nintendo
    /<img[^>]+src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/i  // google play ícone
  ];
  for (var i = 0; i < tentativas.length; i++) {
    var m = html.match(tentativas[i]);
    if (m) return m[1];
  }
  return '';
}

/* ---- Tags populares da página da Steam (para "Gráficos Pixelados" etc.) --
 * A API appdetails NÃO traz as tags populares; então lemos a página da loja.  */
async function buscarSteamTags(appid) {
  const cfg = await G.carregarConfig();
  const url = 'https://store.steampowered.com/app/' + appid + '/?l=' +
    encodeURIComponent(cfg.steamLang) + '&cc=' + encodeURIComponent(cfg.steamCc);
  let resp;
  try {
    resp = await fetch(url, { credentials: 'omit', headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  } catch (e) { return { ok: false, erro: 'rede' }; }
  if (resp.status === 403 || resp.status === 429) return { ok: false, erro: 'rate' };
  if (!resp.ok) return { ok: false, erro: 'http' };
  const html = await resp.text();
  const nomes = [];
  const visto = {};
  const add = function (nm) { const t = (nm || '').trim(); if (t && !visto[t]) { visto[t] = 1; nomes.push(t); } };
  // 1) pega TODOS os {"tagid":N,"name":"..."} da página (decodifica \uXXXX)
  let mm; const re = /"tagid":\s*\d+\s*,\s*"name":\s*"((?:[^"\\]|\\.)*)"/g;
  while ((mm = re.exec(html))) { try { add(JSON.parse('"' + mm[1] + '"')); } catch (e) { add(mm[1]); } }
  // 2) fallback: as tags visíveis <a class="app_tag">Nome</a>
  if (!nomes.length) {
    const re2 = /class="app_tag"[^>]*>\s*([^<]+?)\s*</g;
    while ((mm = re2.exec(html))) add(decodeHtml(mm[1]));
  }
  return { ok: true, tags: nomes.slice(0, 25) };
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

/* ---- HowLongToBeat (tempo para zerar) --------------------------------- *
 * Replica a técnica do howlongtobeatpy: pega a chave da API no bundle JS do
 * site e faz o POST de busca. Como o worker tem host_permissions <all_urls>,
 * consegue ler a resposta (cross-origin). Melhor esforço — se a HLTB mudar o
 * formato, cai para erro claro e o usuário usa o script Python.                */
let HLTB_CACHE = { endpoint: null, key: null, quando: 0 };

function extrairChaveHltb(js) {
  // padrão: fetch("/api/<endpoint>/".concat("A","B",...))  → key = A+B+...
  let m = js.match(/\/api\/([a-z]+)\/"\.concat\(((?:\s*"[^"]*"\s*,?)+)\)/i);
  if (m) {
    const partes = (m[2].match(/"([^"]*)"/g) || []).map(function (s) { return s.slice(1, -1); });
    return { endpoint: m[1], key: partes.join('') };
  }
  // padrão alternativo: "/api/<endpoint>/" seguido de uma constante string longa
  m = js.match(/\/api\/([a-z]+)\/"\s*\+\s*"([a-zA-Z0-9]{6,})"/);
  if (m) return { endpoint: m[1], key: m[2] };
  return null;
}

async function hltbChave() {
  if (HLTB_CACHE.key && (Date.now() - HLTB_CACHE.quando) < 3600000) return HLTB_CACHE;
  const home = await fetch('https://howlongtobeat.com/', {
    headers: { 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' }
  });
  const html = await home.text();
  const scripts = (html.match(/\/_next\/static\/chunks\/[^"']+\.js/g) || []);
  // prioriza o bundle _app (onde costuma estar a chave)
  scripts.sort(function (a, b) { return (b.indexOf('_app') >= 0 ? 1 : 0) - (a.indexOf('_app') >= 0 ? 1 : 0); });
  const vistos = {};
  for (var i = 0; i < scripts.length && i < 8; i++) {
    if (vistos[scripts[i]]) continue; vistos[scripts[i]] = 1;
    try {
      const js = await (await fetch('https://howlongtobeat.com' + scripts[i])).text();
      const c = extrairChaveHltb(js);
      if (c) { HLTB_CACHE = { endpoint: c.endpoint, key: c.key, quando: Date.now() }; return HLTB_CACHE; }
    } catch (e) { /* tenta o próximo */ }
  }
  return null;
}

async function buscarHLTB(nome) {
  nome = (nome || '').trim();
  if (!nome) return { ok: false, erro: 'vazio' };
  const chave = await hltbChave();
  if (!chave) return { ok: false, erro: 'chave', msg: 'Não consegui a chave da HowLongToBeat.' };
  const termos = nome.split(/\s+/).filter(Boolean);
  const payload = {
    searchType: 'games', searchTerms: termos, searchPage: 1, size: 20,
    searchOptions: {
      games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main',
        rangeTime: { min: null, max: null }, gameplay: { perspective: '', flow: '', genre: '' },
        rangeYear: { min: '', max: '' }, modifier: '' },
      users: { sortCategory: 'postcount' }, lists: { sortCategory: 'follows' },
      filter: '', sort: 0, randomizer: 0
    },
    useCache: true
  };
  const urls = [
    'https://howlongtobeat.com/api/' + chave.endpoint + '/' + chave.key,
    'https://howlongtobeat.com/api/' + chave.endpoint
  ];
  for (var i = 0; i < urls.length; i++) {
    try {
      const r = await fetch(urls[i], {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': '*/*', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) continue;
      const j = await r.json();
      const dados = j.data || (j.color ? j.data : null) || [];
      if (!dados.length) return { ok: true, horas: null, achou: false };
      // melhor casamento por nome
      const alvo = G.norm(nome);
      let melhor = dados[0];
      for (var k = 0; k < dados.length; k++) {
        if (G.norm(dados[k].game_name || '') === alvo) { melhor = dados[k]; break; }
      }
      const seg = melhor.comp_main || 0;               // SOMENTE Main Story
      const horas = seg > 0 ? Math.round((seg / 3600) * 100) / 100 : null;
      return { ok: true, horas: horas, achou: horas != null, nome: melhor.game_name || nome };
    } catch (e) { /* tenta a próxima URL */ }
  }
  return { ok: false, erro: 'busca', msg: 'HowLongToBeat não respondeu como esperado.' };
}

/* ---- Roteador de mensagens -------------------------------------------- */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    try {
      if (!msg || !msg.tipo) return sendResponse({ ok: false, msg: 'mensagem inválida' });
      if (msg.tipo === 'validar') return sendResponse(await validarUrl(msg.url));
      if (msg.tipo === 'steam') return sendResponse(await buscarSteam(msg.appid));
      if (msg.tipo === 'steamtags') return sendResponse(await buscarSteamTags(msg.appid));
      if (msg.tipo === 'youtube') return sendResponse(await buscarYouTube(msg.url));
      if (msg.tipo === 'og') return sendResponse(await buscarOG(msg.url));
      if (msg.tipo === 'hltb') return sendResponse(await buscarHLTB(msg.nome));
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
  // jogo NOVO → tags da Steam + tempo (HLTB), só desse jogo
  if (res.criado && res.jogo) {
    try {
      const lista = await G.carregarJogos();
      const g = lista.find(function (x) { return x.id === res.jogo.id; });
      if (g) {
        if (g.steam_appid) {
          const rt = await buscarSteamTags(g.steam_appid);
          if (rt && rt.ok && rt.tags) {
            const m = G.mapearTagsSteam(rt.tags);
            g.genero = G.uniao(g.genero, m.genero);
            g.estilo_visual = G.uniao(g.estilo_visual, m.estilo_visual);
            g.vibe = G.uniao(g.vibe, m.vibe);
            g.marcadores = G.uniao(g.marcadores, rt.tags);
            g.steam_tags_ok = true;
          }
        }
        if (g.tempo_para_zerar == null && g.nome) {
          const h = await buscarHLTB(g.nome);
          if (h && h.ok && h.horas != null) { g.tempo_para_zerar = h.horas; g.hltb_check = true; }
        }
        await G.salvarJogos(lista);
      }
    } catch (e) { /* ignora */ }
  }
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
