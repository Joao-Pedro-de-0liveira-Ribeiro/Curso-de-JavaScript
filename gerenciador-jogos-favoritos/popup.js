/* =============================================================================
 * popup.js — captura rápida (fluxo crítico da seção 2 da spec)
 *
 * Ao abrir: lê a aba atual, descobre a origem e tenta validar/enriquecer.
 *   - Steam        → valida via appdetails e mostra nome/capa/data/preço
 *   - YouTube      → procura link da Steam na descrição; senão salva o vídeo
 *   - outras fontes→ tenta Open Graph (se permitido) ou esqueleto manual
 * Um clique em "Favoritar" grava direto na lista — sem pasta, sem renomear.
 * ============================================================================= */
(function () {
  'use strict';
  const G = window.GJF;

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    carregando: $('carregando'), preview: $('preview'), fallback: $('fallback'),
    fallbackMsg: $('fallback-msg'), btnPermOG: $('btn-perm-og'),
    capa: $('capa'), capaVazia: $('capa-vazia'), titulo: $('titulo'),
    badges: $('badges'), descricao: $('descricao'), jaFav: $('ja-favoritado'),
    prioSeg: $('prioridade-seg'), intencao: $('intencao'),
    favoritar: $('favoritar'), msg: $('msg'),
    urlCola: $('url-cola'), btnValidarUrl: $('btn-validar-url'),
    leadNome: $('lead-nome'), btnLead: $('btn-lead')
  };

  let patchAtual = null;      // patch que o botão Favoritar vai gravar
  let prioridade = 'media';
  let jaExiste = false;

  /* ---- helpers de mensagem ao background ---- */
  function pedir(msg) {
    return new Promise(function (res) { chrome.runtime.sendMessage(msg, res); });
  }

  /* ---- injeta scan na aba para achar link da Steam / OG ---- */
  function escanearAba(tabId) {
    return new Promise(function (res) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function () {
          const out = { steamUrl: '', ogTitle: '', ogImage: '' };
          const a = document.querySelector('a[href*="store.steampowered.com/app/"]');
          if (a) out.steamUrl = a.href;
          if (!out.steamUrl) {
            const m = (document.body ? document.body.innerText : '')
              .match(/https?:\/\/store\.steampowered\.com\/app\/\d+[^\s"'<]*/i);
            if (m) out.steamUrl = m[0];
          }
          const meta = function (p) {
            const n = document.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]');
            return n ? n.content : '';
          };
          out.ogTitle = meta('og:title');
          out.ogImage = meta('og:image');
          return out;
        }
      }, function (r) {
        res(chrome.runtime.lastError || !r || !r[0] ? {} : r[0].result || {});
      });
    });
  }

  /* ---- fluxo inicial ---- */
  async function init() {
    montarIntencoes();
    ligarEventos();

    const tabs = await new Promise(function (res) {
      chrome.tabs.query({ active: true, currentWindow: true }, res);
    });
    const tab = tabs && tabs[0];
    const url = tab && tab.url ? tab.url : '';

    if (!url || /^(chrome|edge|about|vivaldi|extension):/i.test(url)) {
      return mostrarFallback('Abra a página de um jogo (Steam, YouTube, itch…) e clique de novo — ou cole uma URL abaixo.');
    }

    const appid = G.extrairAppId(url);

    if (G.ehYouTube(url)) {
      // tenta achar link da Steam na descrição do vídeo
      const scan = tab.id ? await escanearAba(tab.id) : {};
      if (scan.steamUrl) {
        const r = await pedir({ tipo: 'validar', url: scan.steamUrl });
        if (r && r.ok) {
          r.dados.url_video = url;   // guarda de onde veio
          return aplicar(r);
        }
      }
      // sem Steam na descrição → salva como lead do YouTube (com título via oEmbed)
      const r = await pedir({ tipo: 'validar', url: url });
      return aplicar(r);
    }

    if (appid || G.detectarOrigem(url) !== 'dev_site') {
      const r = await pedir({ tipo: 'validar', url: url });
      if ((!r || (!r.ok && !r.dados)) && !appid) {
        // fonte genérica sem OG → tenta scan da própria página
        const scan = tab.id ? await escanearAba(tab.id) : {};
        return aplicar(montarDeScan(url, scan));
      }
      return aplicar(r);
    }

    // dev_site / desconhecido → tenta OG via background, com scan como reforço
    const r = await pedir({ tipo: 'validar', url: url });
    if (r && (r.ok || (r.dados && r.dados.nome))) return aplicar(r);
    const scan = tab.id ? await escanearAba(tab.id) : {};
    if (scan.steamUrl) {
      const rs = await pedir({ tipo: 'validar', url: scan.steamUrl });
      if (rs && rs.ok) return aplicar(rs);
    }
    return aplicar(montarDeScan(url, scan, r));
  }

  function montarDeScan(url, scan, rAnterior) {
    const dados = {
      url_origem: url, origem: G.detectarOrigem(url),
      nome: scan.ogTitle || '', capa_url: scan.ogImage || ''
    };
    return {
      ok: !!scan.ogTitle, parcial: !scan.ogTitle,
      semPermissaoOG: rAnterior && rAnterior.semPermissaoOG, dados: dados
    };
  }

  /* ---- aplica o resultado da validação na UI ---- */
  async function aplicar(r) {
    el.carregando.hidden = true;
    if (!r || (!r.ok && !r.dados)) {
      return mostrarFallback((r && r.msg) || 'Não consegui reconhecer esta página como um jogo. Cole a URL manualmente abaixo.');
    }

    patchAtual = G.dadosParaPatch(r.dados);
    // completa origem/url se faltou
    if (!patchAtual.origem) patchAtual.origem = G.detectarOrigem(patchAtual.url_origem);

    // já está na lista?
    const lista = await G.carregarJogos();
    const chave = G.normalizarUrlChave(patchAtual.url_origem);
    const appid = patchAtual.steam_appid;
    jaExiste = lista.some(function (g) {
      return (appid && g.steam_appid === appid) || (chave && G.normalizarUrlChave(g.url_origem) === chave);
    });

    renderPreview(r);
    el.preview.hidden = false;
  }

  function renderPreview(r) {
    const p = patchAtual;
    // capa
    if (p.capa_url) {
      el.capa.src = p.capa_url; el.capa.hidden = false; el.capaVazia.hidden = true;
      el.capa.onerror = function () { el.capa.hidden = true; el.capaVazia.hidden = false; };
    } else {
      el.capa.hidden = true; el.capaVazia.hidden = false;
    }
    el.titulo.textContent = p.nome || '(sem nome — edite depois)';

    // badges
    const b = [];
    b.push(badge(G.ORIGENS[p.origem] || p.origem, 'accent'));
    if (p.status_lancamento === 'nao_lancado' || p.status_lancamento === 'indefinido') {
      b.push(badge('⏳ ' + (G.formatarContagem(p) || 'não lançado'), 'warn'));
    }
    if (p.desconto_pct) b.push(badge('-' + p.desconto_pct + '%', 'desc'));
    if (p.preco_atual) b.push(badge(p.preco_atual));
    if (p.url_video) b.push(badge('▶ do vídeo', 'ok'));
    el.badges.innerHTML = '';
    b.forEach(function (n) { el.badges.appendChild(n); });

    // descrição curta (só exibição — não gravada)
    const desc = r && r.dados && r.dados.short_description;
    if (desc) { el.descricao.textContent = desc; el.descricao.hidden = false; }

    el.jaFav.hidden = !jaExiste;
    el.favoritar.textContent = jaExiste ? '★ Atualizar / reafirmar' : '★ Favoritar';

    // avisos parciais
    if (r && r.semPermissaoOG && !p.nome) {
      mostrarAcaoOG();
    } else if (r && r.parcial) {
      mostrarMsg((r.msg || 'Link salvo sem validação automática — complete os detalhes no gerenciador.'), 'err', false);
    }
  }

  // mensagem com botão para conceder a permissão opcional e reenriquecer
  function mostrarAcaoOG() {
    el.msg.textContent = 'Sem permissão para ler dados deste site. ';
    const btn = document.createElement('button');
    btn.className = 'btn-secundario';
    btn.textContent = 'Permitir e tentar';
    btn.style.marginLeft = '6px';
    btn.addEventListener('click', pedirPermissaoOG);
    el.msg.className = 'msg err';
    el.msg.appendChild(btn);
    el.msg.hidden = false;
  }

  function badge(txt, cls) {
    const s = document.createElement('span');
    s.className = 'badge' + (cls ? ' ' + cls : '');
    s.textContent = txt;
    return s;
  }

  function mostrarFallback(txt) {
    el.carregando.hidden = true;
    el.preview.hidden = true;
    el.fallback.hidden = false;
    el.fallbackMsg.textContent = txt;
  }

  function mostrarMsg(txt, cls, some) {
    el.msg.textContent = txt;
    el.msg.className = 'msg ' + (cls || 'ok');
    el.msg.hidden = false;
    if (some) setTimeout(function () { el.msg.hidden = true; }, 3000);
  }

  /* ---- UI: intenções, prioridade ---- */
  function montarIntencoes() {
    Object.keys(G.INTENCOES).forEach(function (k) {
      const o = document.createElement('option');
      o.value = k; o.textContent = G.INTENCOES[k];
      el.intencao.appendChild(o);
    });
    el.intencao.value = 'jogar';
  }

  function ligarEventos() {
    el.prioSeg.addEventListener('click', function (e) {
      const b = e.target.closest('.seg'); if (!b) return;
      prioridade = b.dataset.v;
      Array.prototype.forEach.call(el.prioSeg.children, function (c) {
        c.classList.toggle('ativo', c === b);
      });
    });

    el.favoritar.addEventListener('click', favoritar);
    el.btnValidarUrl.addEventListener('click', function () {
      const u = el.urlCola.value.trim();
      if (u) revalidar(u);
    });
    el.urlCola.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && el.urlCola.value.trim()) revalidar(el.urlCola.value.trim());
    });
    el.btnLead.addEventListener('click', salvarLead);
    el.leadNome.addEventListener('keydown', function (e) { if (e.key === 'Enter') salvarLead(); });

    document.getElementById('btn-abrir-gerenciador').addEventListener('click', abrirGerenciador);
    document.getElementById('link-gerenciador').addEventListener('click', function (e) {
      e.preventDefault(); abrirGerenciador();
    });
    if (el.btnPermOG) el.btnPermOG.addEventListener('click', pedirPermissaoOG);
  }

  async function revalidar(url) {
    el.fallback.hidden = true;
    el.preview.hidden = true;
    el.carregando.hidden = false;
    const r = await pedir({ tipo: 'validar', url: url });
    if (r && r.semPermissaoOG) mostrarBotaoOG();
    await aplicar(r);
  }

  async function favoritar() {
    if (!patchAtual) return;
    el.favoritar.disabled = true;
    patchAtual.prioridade = prioridade;
    patchAtual.intencao = el.intencao.value;
    try {
      const res = await G.upsertJogo(patchAtual);
      mostrarMsg(res.criado ? '✓ Adicionado à sua lista!' : '✓ Atualizado na lista.', 'ok', false);
      el.favoritar.textContent = 'Editar no gerenciador →';
      el.favoritar.disabled = false;
      el.favoritar.onclick = function () { abrirGerenciador(res.jogo.id); };
    } catch (e) {
      mostrarMsg('Erro ao salvar: ' + e.message, 'err', false);
      el.favoritar.disabled = false;
    }
  }

  async function salvarLead() {
    const nome = el.leadNome.value.trim();
    if (!nome) return;
    await G.upsertJogo({
      nome: nome, origem: 'google', status_curadoria: 'a_pesquisar',
      prioridade: prioridade, intencao: el.intencao.value,
      url_origem: 'https://www.google.com/search?q=' + encodeURIComponent(nome + ' jogo')
    });
    el.leadNome.value = '';
    mostrarMsg('✓ Lead “' + nome + '” salvo para pesquisar depois.', 'ok', true);
  }

  function mostrarBotaoOG() {
    el.btnPermOG.hidden = false;
  }
  async function pedirPermissaoOG() {
    chrome.permissions.request({ origins: ['<all_urls>'] }, function (granted) {
      if (granted && patchAtual && patchAtual.url_origem) revalidar(patchAtual.url_origem);
    });
  }

  function abrirGerenciador(id) {
    const url = chrome.runtime.getURL('manager.html') + (id ? '#editar=' + id : '');
    chrome.tabs.create({ url: url });
    window.close();
  }

  init();
})();
