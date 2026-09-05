/* =============================================================================
 * importador.js — migração do arquivo de favoritos .html (spec seção 8)
 *
 * Converte a hierarquia de pastas (Netscape Bookmarks) em jogos + tags:
 *   Detonado            → intenção "só assistir" (+ url_video se YouTube)
 *   Zera Rapido         → tempo estimado (entra no filtro "Zera rápido")
 *   ReZerar / ZERA DNV  → intenção "rejogar"
 *   Vão Lança Ainda     → status "não lançado"; subpastas 2022–2025 → ano_alvo
 *   Extremamente Indefinitivos → status "indefinido"
 *   Prioridade Alta/Média/Baixa → prioridade
 *   Compre e Admire / Implora Pirataria → intenção "comprar_apoiar"
 *   Tiro/Luta/RPG/História/Exploração → gênero
 *   PIXEL PRIMITIVO / Pixel → estilo_visual
 *   Ambientação e Nostalgia / Contemplação / Kawaii / Surpresa → vibe
 *   Buscas do Google / sem loja → curadoria "a_pesquisar"
 *   Anotações entre parênteses no título → notas (título fica limpo)
 * ============================================================================= */
(function (root) {
  'use strict';
  const G = root.GJF;

  function slugParaNome(href) {
    const app = G.extrairAppId(href);
    if (app) {
      const m = href.match(/\/app\/\d+\/([^\/?#]+)/);
      if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ').trim();
    }
    const h = G.hostDe(href);
    return h || href;
  }

  // percorre um <DL>, mantendo o caminho de pastas
  function processarDL(dl, path, addLink) {
    let node = dl.firstElementChild;
    while (node) {
      const tag = node.tagName;
      if (tag === 'DT') {
        const h3 = node.querySelector(':scope > h3');
        const a = node.querySelector(':scope > a');
        if (h3) {
          const nome = h3.textContent.trim();
          let sub = node.querySelector(':scope > dl');
          let pulou = null;
          if (!sub && node.nextElementSibling && node.nextElementSibling.tagName === 'DL') {
            sub = node.nextElementSibling; pulou = sub;
          }
          if (sub) processarDL(sub, path.concat(nome), addLink);
          if (pulou) node = pulou; // já consumido
        } else if (a && a.getAttribute('href')) {
          addLink(a.getAttribute('href'), a.textContent || '', path);
        }
      } else if (tag === 'DL') {
        processarDL(node, path, addLink);
      }
      node = node.nextElementSibling;
    }
  }

  function mapear(href, title, path) {
    const P = path.map(G.norm);
    const has = function (frag) { return P.some(function (f) { return f.indexOf(frag) >= 0; }); };
    // casa o fragmento como PALAVRA inteira (evita "acao" casar dentro de "ambientacao")
    const temPalavra = function (frag) {
      const re = new RegExp('(^|[^a-z0-9])' + frag + '($|[^a-z0-9])');
      return P.some(function (f) { return re.test(f); });
    };
    const patch = { url_origem: href, origem: G.detectarOrigem(href), genero: [], estilo_visual: [], vibe: [] };

    const appid = G.extrairAppId(href);
    if (appid) patch.steam_appid = appid;
    // qualquer link de vídeo do YouTube guarda a url_video (não só na pasta Detonado)
    if (G.ehYouTube(href)) patch.url_video = href;

    // nome + notas entre parênteses
    let nome = (title || '').trim();
    const notas = [];
    nome = nome.replace(/\(([^)]*)\)/g, function (m, g1) { if (g1.trim()) notas.push(g1.trim()); return ''; })
      .replace(/\s{2,}/g, ' ').trim();
    patch.nome = nome || slugParaNome(href);
    if (notas.length) patch.notas = notas.join(' · ');

    // intenção
    if (has('detonado')) patch.intencao = 'assistir_walkthrough';
    if (has('rezerar') || has('zera dnv') || has('comprra e zera') || has('compra e zera')) patch.intencao = 'rejogar';
    if (has('compre e admire') || has('implora pirataria')) patch.intencao = 'comprar_apoiar';

    // prioridade
    if (has('prioridade alta')) patch.prioridade = 'alta';
    else if (has('prioridade media')) patch.prioridade = 'media';
    else if (has('prioridade baixa')) patch.prioridade = 'baixa';

    // gênero (palavra inteira, para não confundir "acao" com "ambientacao")
    ['tiro', 'luta', 'rpg', 'historia', 'exploracao', 'acao', 'plataforma', 'puzzle', 'aventura', 'terror', 'corrida']
      .forEach(function (k) { if (temPalavra(k)) patch.genero.push(k); });

    // estilo visual
    if (has('pixel primitivo')) patch.estilo_visual.push('pixel_primitivo');
    else if (has('pixel')) patch.estilo_visual.push('pixel_art');

    // vibe
    if (has('ambientacao bela') || has('ambientacao e nostalgia')) patch.vibe.push('ambientacao_bela');
    if (has('nostalgia')) patch.vibe.push('nostalgia');
    if (has('contemplacao') || has('calmaria')) patch.vibe.push('contemplacao_calmaria');
    if (has('kawaii')) patch.vibe.push('kawaii');
    if (has('surpresa')) patch.vibe.push('surpresa');
    if (has('sombrio')) patch.vibe.push('sombrio');
    patch.vibe = patch.vibe.filter(function (v, i, a) { return a.indexOf(v) === i; });

    // "Zera rápido": não temos horas exatas → estimativa curta para o filtro fazer sentido
    if (has('zera rapido')) {
      patch.tempo_para_zerar = 5;
      patch.notas = (patch.notas ? patch.notas + ' · ' : '') + 'tempo estimado (pasta Zera Rapido)';
    }

    // lançamento
    if (has('vao lanca ainda') || has('vao lancar') || has('nao lancado') || has('vao lança ainda')) {
      patch.status_lancamento = 'nao_lancado';
    }
    if (has('extremamente indefinit')) patch.status_lancamento = 'indefinido';
    let ano = null;
    P.forEach(function (f) { const m = f.match(/\b(20\d{2})\b/); if (m) ano = parseInt(m[1], 10); });
    if (ano) { patch.ano_alvo = ano; if (!patch.status_lancamento) patch.status_lancamento = 'nao_lancado'; }

    // curadoria: buscas do Google são leads "a pesquisar"
    if (patch.origem === 'google') { patch.status_curadoria = 'a_pesquisar'; patch.nome = patch.nome || 'Lead'; }

    return patch;
  }

  // recebe o texto do .html e devolve { patches, totalLinks, pastas }
  function parse(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const patches = [];
    const pastas = new Set();
    const vistos = new Set();
    const addLink = function (href, title, path) {
      if (!href || /^javascript:/i.test(href) || /^place:/i.test(href)) return;
      const chave = G.normalizarUrlChave(href);
      if (vistos.has(chave)) return;      // dedupe dentro do próprio arquivo
      vistos.add(chave);
      path.forEach(function (p) { pastas.add(p); });
      patches.push(mapear(href, title, path));
    };
    // 1) percurso estruturado (usa as pastas para classificar)
    const topo = doc.querySelectorAll('body > dl, body > dl > dl');
    if (topo.length) {
      topo.forEach(function (dl) { processarDL(dl, [], addLink); });
    } else {
      const qualquer = doc.querySelector('dl');
      if (qualquer) processarDL(qualquer, [], addLink);
    }
    // 2) rede de segurança: varre TODOS os <a href> do arquivo e adiciona os que
    //    o percurso estruturado não pegou (arquivos bagunçados, links soltos,
    //    buscas do Google, vídeos do YouTube). Assim NENHUM link se perde.
    doc.querySelectorAll('a[href]').forEach(function (a) {
      addLink(a.getAttribute('href'), a.textContent || '', []);
    });

    // contagem por origem para o resumo pós-importação
    const porOrigem = {};
    patches.forEach(function (p) { porOrigem[p.origem] = (porOrigem[p.origem] || 0) + 1; });

    return {
      patches: patches, totalLinks: patches.length,
      pastas: Array.from(pastas), porOrigem: porOrigem
    };
  }

  root.GJF_IMPORTADOR = { parse: parse, mapear: mapear };
})(typeof self !== 'undefined' ? self : this);
