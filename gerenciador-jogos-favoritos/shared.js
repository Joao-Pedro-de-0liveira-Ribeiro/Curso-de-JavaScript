/* =============================================================================
 * shared.js — núcleo compartilhado (popup, manager e service worker)
 *
 * Carregado de duas formas:
 *   - páginas (popup/manager): <script src="shared.js"></script>
 *   - service worker (background.js): importScripts('shared.js')
 * Em ambos os casos `self` existe, então exportamos em `self.GJF`.
 *
 * NÃO usa `document` nem DOM — pode rodar no worker.
 * ============================================================================= */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'gjf_jogos';
  const SETTINGS_KEY = 'gjf_config';

  /* ----------------------------------------------------------------------- *
   * ENUMS — todos extraídos das pastas reais do usuário (spec seção 6).
   * São ABERTOS: o usuário pode digitar novos valores; estes são só as
   * sementes com rótulo bonito para a UI.
   * ----------------------------------------------------------------------- */
  const GENEROS = {
    acao: 'Ação', tiro: 'Tiro', luta: 'Luta', rpg: 'RPG', historia: 'História',
    exploracao: 'Exploração', plataforma: 'Plataforma', puzzle: 'Puzzle',
    aventura: 'Aventura', estrategia: 'Estratégia', corrida: 'Corrida',
    terror: 'Terror', simulacao: 'Simulação', roguelike: 'Roguelike',
    metroidvania: 'Metroidvania', souls: 'Souls-like', ritmo: 'Ritmo'
  };

  const ESTILOS = {
    pixel_art: 'Pixel Art', pixel_primitivo: 'Pixel Primitivo (retrô extremo)',
    '2d': '2D', '3d': '3D', arte_desenhada: 'Arte Desenhada',
    voxel: 'Voxel', low_poly: 'Low Poly', anime: 'Anime', realista: 'Realista'
  };

  const VIBES = {
    nostalgia: 'Nostalgia', ambientacao_bela: 'Ambientação Bela',
    contemplacao_calmaria: 'Contemplação / Calmaria', kawaii: 'Kawaii',
    sombrio: 'Sombrio', surpresa: 'Tem Surpresa', competitivo: 'Competitivo',
    relaxante: 'Relaxante', emocionante: 'Emocionante'
  };

  const INTENCOES = {
    jogar: 'Jogar',
    assistir_walkthrough: 'Só assistir (Detonado)',
    rejogar: 'Rejogar',
    comprar_apoiar: 'Comprar e apoiar',
    treinar_dominar: 'Treinar para dominar'
  };

  const PRIORIDADES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

  const STATUS_LANCAMENTO = {
    lancado: 'Lançado',
    nao_lancado: 'Ainda não lançado',
    indefinido: 'Indefinido (sem data)'
  };

  const STATUS_CURADORIA = {
    a_pesquisar: 'A pesquisar (lead)',
    validado: 'Validado',
    arquivado: 'Arquivado'
  };

  const ORIGENS = {
    steam: 'Steam', youtube: 'YouTube', google_play: 'Google Play',
    nintendo: 'Nintendo', itch: 'itch.io', kickstarter: 'Kickstarter',
    twitter: 'Twitter/X', dev_site: 'Site do dev', google: 'Busca Google',
    outro: 'Outro'
  };

  const DEFAULT_SETTINGS = {
    zeraRapidoLimite: 6,      // horas — limite para "Zera rápido"
    steamLang: 'portuguese',
    steamCc: 'br'
  };

  /* ----------------------------------------------------------------------- *
   * Utilidades
   * ----------------------------------------------------------------------- */
  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // remove acentos e baixa a caixa — usado para casar nomes de pastas/termos
  function norm(s) {
    return (s || '').toString().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function toArray(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (v == null || v === '') return [];
    return [v];
  }

  /* ----------------------------------------------------------------------- *
   * Parsing de URL / origem
   * ----------------------------------------------------------------------- */
  // aceita todas as variações do arquivo: query string, ?l=portuguese,
  // curator_clanid, fragmentos #..., /app/NNN/Slug/, agecheck, etc.
  function extrairAppId(url) {
    if (!url) return null;
    const m = String(url).match(/store\.steampowered\.com\/(?:app|agecheck\/app)\/(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function ehYouTube(url) {
    return /(?:youtube\.com|youtu\.be)\//i.test(url || '');
  }

  function detectarOrigem(url) {
    const u = norm(url);
    if (!u) return 'outro';
    if (u.includes('store.steampowered.com') || u.includes('steamcommunity.com')) return 'steam';
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('play.google.com')) return 'google_play';
    if (u.includes('nintendo.com')) return 'nintendo';
    if (u.includes('itch.io')) return 'itch';
    if (u.includes('kickstarter.com')) return 'kickstarter';
    if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
    if (u.includes('google.') && u.includes('/search')) return 'google';
    // domínios de "sites de dev" conhecidos do arquivo + heurística
    return 'dev_site';
  }

  function hostDe(url) {
    try { return new URL(url).host.replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  /* ----------------------------------------------------------------------- *
   * Capas determinísticas (SEM API) — funcionam mesmo se a Steam bloquear.
   *  - Steam: imagem de header no CDN público, previsível pelo appid.
   *  - YouTube: thumbnail previsível pelo id do vídeo.
   * ----------------------------------------------------------------------- */
  function capaSteam(appid) {
    return appid ? 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + appid + '/header.jpg' : '';
  }

  function youtubeId(url) {
    if (!url) return '';
    let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
    return m ? m[1] : '';
  }

  function capaYoutube(url) {
    const id = youtubeId(url);
    return id ? 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg' : '';
  }

  // devolve uma capa determinística para o jogo, quando possível
  function capaDeterministica(j) {
    if (j.steam_appid) return capaSteam(j.steam_appid);
    const app = extrairAppId(j.url_origem);
    if (app) return capaSteam(app);
    const yt = capaYoutube(j.url_video || j.url_origem);
    if (yt) return yt;
    return '';
  }

  /* ----------------------------------------------------------------------- *
   * Fábrica / normalização de um jogo
   * ----------------------------------------------------------------------- */
  function novoJogo(patch) {
    const base = {
      id: uuid(),
      nome: '',
      capa_url: '',
      origem: 'outro',
      url_origem: '',
      url_video: '',
      steam_appid: null,
      data_adicao: new Date().toISOString(),
      genero: [],
      estilo_visual: [],
      vibe: [],
      intencao: 'jogar',
      prioridade: 'media',
      status_lancamento: 'lancado',
      data_prevista: '',      // ISO date (YYYY-MM-DD) ou ''
      ano_alvo: null,
      tempo_para_zerar: null, // horas
      preco_atual: null,      // string formatada, ex "R$ 39,99"
      desconto_pct: null,
      notas: '',
      status_curadoria: 'validado',
      edited_manually: false
    };
    return normalizarJogo(Object.assign(base, patch || {}));
  }

  // garante tipos consistentes + campos derivados (ano_alvo, capa)
  function normalizarJogo(j) {
    j.genero = toArray(j.genero);
    j.estilo_visual = toArray(j.estilo_visual);
    j.vibe = toArray(j.vibe);
    if (j.tempo_para_zerar === '' || j.tempo_para_zerar == null) j.tempo_para_zerar = null;
    else j.tempo_para_zerar = Number(j.tempo_para_zerar);
    // ano_alvo derivado da data prevista, se houver e não foi setado à mão
    if (j.data_prevista && !j.ano_alvo) {
      const y = parseInt(String(j.data_prevista).slice(0, 4), 10);
      if (y > 1990 && y < 2100) j.ano_alvo = y;
    }
    // capa determinística (Steam/YouTube) quando estiver faltando — retroativo:
    // jogos já salvos sem capa ganham imagem ao recarregar, sem precisar de API
    if (!j.capa_url) { const c = capaDeterministica(j); if (c) j.capa_url = c; }
    return j;
  }

  // "Zera rápido" é DERIVADO (spec 6.3 / 11.6): não é pasta, é filtro.
  function ehZeraRapido(j, settings) {
    const lim = (settings && settings.zeraRapidoLimite) || DEFAULT_SETTINGS.zeraRapidoLimite;
    return j.tempo_para_zerar != null && j.tempo_para_zerar > 0 && j.tempo_para_zerar <= lim;
  }

  // dias restantes até data_prevista (negativo = já passou); null se sem data
  function diasRestantes(j) {
    if (!j.data_prevista) return null;
    const alvo = new Date(j.data_prevista + 'T00:00:00');
    if (isNaN(alvo)) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((alvo - hoje) / 86400000);
  }

  function formatarContagem(j) {
    const d = diasRestantes(j);
    if (d == null) {
      if (j.status_lancamento === 'indefinido') return 'sem data';
      if (j.ano_alvo) return 'em ' + j.ano_alvo;
      return '';
    }
    if (d < 0) return 'lançou há ' + Math.abs(d) + 'd';
    if (d === 0) return 'lança HOJE';
    if (d === 1) return 'falta 1 dia';
    if (d < 45) return 'faltam ' + d + ' dias';
    const meses = Math.round(d / 30);
    return 'faltam ~' + meses + (meses === 1 ? ' mês' : ' meses');
  }

  /* ----------------------------------------------------------------------- *
   * Storage (chrome.storage.local) — Promises
   * ----------------------------------------------------------------------- */
  function carregarJogos() {
    return new Promise(function (res) {
      chrome.storage.local.get(STORAGE_KEY, function (o) {
        const arr = (o && o[STORAGE_KEY]) || [];
        res(arr.map(normalizarJogo));
      });
    });
  }

  function salvarJogos(lista) {
    return new Promise(function (res) {
      const obj = {};
      obj[STORAGE_KEY] = lista;
      chrome.storage.local.set(obj, function () { res(lista); });
    });
  }

  function carregarConfig() {
    return new Promise(function (res) {
      chrome.storage.local.get(SETTINGS_KEY, function (o) {
        res(Object.assign({}, DEFAULT_SETTINGS, (o && o[SETTINGS_KEY]) || {}));
      });
    });
  }

  function salvarConfig(cfg) {
    return new Promise(function (res) {
      const obj = {};
      obj[SETTINGS_KEY] = Object.assign({}, DEFAULT_SETTINGS, cfg);
      chrome.storage.local.set(obj, function () { res(obj[SETTINGS_KEY]); });
    });
  }

  // adiciona um jogo evitando duplicata (casa por appid ou url_origem).
  // retorna { jogo, criado:boolean }
  async function upsertJogo(patch) {
    const lista = await carregarJogos();
    const alvoApp = patch.steam_appid || extrairAppId(patch.url_origem);
    const alvoUrl = normalizarUrlChave(patch.url_origem);
    let idx = -1;
    if (alvoApp) idx = lista.findIndex(function (g) { return g.steam_appid === alvoApp; });
    if (idx < 0 && alvoUrl) {
      idx = lista.findIndex(function (g) { return normalizarUrlChave(g.url_origem) === alvoUrl; });
    }
    if (idx >= 0) {
      // não-destrutivo: só une tags, mantém escalares existentes
      const g = lista[idx];
      g.genero = uniao(g.genero, toArray(patch.genero));
      g.estilo_visual = uniao(g.estilo_visual, toArray(patch.estilo_visual));
      g.vibe = uniao(g.vibe, toArray(patch.vibe));
      if (!g.url_video && patch.url_video) g.url_video = patch.url_video;
      if (!g.notas && patch.notas) g.notas = patch.notas;
      lista[idx] = normalizarJogo(g);
      await salvarJogos(lista);
      return { jogo: lista[idx], criado: false };
    }
    const novo = novoJogo(patch);
    lista.push(novo);
    await salvarJogos(lista);
    return { jogo: novo, criado: true };
  }

  function uniao(a, b) {
    const out = toArray(a).slice();
    toArray(b).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /* ----------------------------------------------------------------------- *
   * Conversão dos dados de validação (Steam/YouTube/OG) para um "patch"
   * pronto de gravar. Centraliza o mapeamento coming_soon → status,
   * ano de lançamento → ano_alvo e gêneros da Steam → tags conhecidas.
   * Usado pelo popup, pelo menu de contexto e pelo importador.
   * ----------------------------------------------------------------------- */
  function mapearGenerosSteam(descs) {
    const alias = {
      shooter: 'tiro', fighting: 'luta', 'role-playing': 'rpg', rpg: 'rpg',
      platformer: 'plataforma', adventure: 'aventura', strategy: 'estrategia',
      racing: 'corrida', horror: 'terror', simulation: 'simulacao',
      action: 'acao', sports: null
    };
    const out = [];
    toArray(descs).forEach(function (d) {
      const nd = norm(d);
      for (const k in GENEROS) {
        if (nd === norm(GENEROS[k]) || nd === k) { if (out.indexOf(k) < 0) out.push(k); return; }
      }
      if (alias[nd] && out.indexOf(alias[nd]) < 0) out.push(alias[nd]);
    });
    return out;
  }

  function dadosParaPatch(dados) {
    const p = Object.assign({}, dados || {});
    if (p.genero && p.genero.length) p.genero = mapearGenerosSteam(p.genero);
    const s = p.release_str;
    const coming = p.coming_soon;
    const anoMatch = s ? String(s).match(/(20\d{2})/) : null;
    const ano = anoMatch ? parseInt(anoMatch[1], 10) : null;
    if (coming) {
      p.status_lancamento = ano ? 'nao_lancado' : 'indefinido';
      if (ano) p.ano_alvo = ano;
    } else if (s) {
      p.status_lancamento = 'lancado';
    }
    if (p.origem === 'steam' && p.nome) p.status_curadoria = 'validado';
    // capa determinística de reserva (Steam/YouTube), quando a API não trouxe
    if (!p.capa_url) {
      const c = capaDeterministica({ steam_appid: p.steam_appid, url_origem: p.url_origem, url_video: p.url_video });
      if (c) p.capa_url = c;
    }
    // limpa campos auxiliares que não fazem parte do modelo salvo
    delete p.release_str; delete p.coming_soon; delete p.autor;
    delete p.short_description; delete p.is_free;
    return p;
  }

  // chave de deduplicação: appid quando é Steam; senão host+caminho+QUERY.
  // IMPORTANTE: mantém a query — é ela que distingue youtube (?v=), Google Play
  // (?id=) e buscas do Google (?q=). Sem isso, todos colapsavam em 1 só.
  function normalizarUrlChave(url) {
    if (!url) return '';
    const app = extrairAppId(url);
    if (app) return 'steam:' + app;
    try {
      const u = new URL(url);
      return (u.host.replace(/^www\./, '') + u.pathname + u.search).replace(/\/+$/, '').toLowerCase();
    } catch (e) {
      return String(url).trim().toLowerCase();
    }
  }

  const GJF = {
    STORAGE_KEY, SETTINGS_KEY, DEFAULT_SETTINGS,
    GENEROS, ESTILOS, VIBES, INTENCOES, PRIORIDADES,
    STATUS_LANCAMENTO, STATUS_CURADORIA, ORIGENS,
    uuid, norm, toArray, uniao,
    extrairAppId, ehYouTube, detectarOrigem, hostDe, normalizarUrlChave,
    capaSteam, youtubeId, capaYoutube, capaDeterministica,
    mapearGenerosSteam, dadosParaPatch,
    novoJogo, normalizarJogo, ehZeraRapido, diasRestantes, formatarContagem,
    carregarJogos, salvarJogos, carregarConfig, salvarConfig, upsertJogo
  };

  root.GJF = GJF;
})(typeof self !== 'undefined' ? self : this);
