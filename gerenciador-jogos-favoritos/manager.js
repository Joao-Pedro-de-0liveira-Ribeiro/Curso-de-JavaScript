/* =============================================================================
 * manager.js — painel completo de favoritos
 * ============================================================================= */
(function () {
  'use strict';
  const G = window.GJF;
  const IMP = window.GJF_IMPORTADOR;
  const $ = function (s) { return document.querySelector(s); };
  const norm = G.norm;

  let jogos = [];
  let config = Object.assign({}, G.DEFAULT_SETTINGS);
  let editando = null;         // { jogo, ehNovo }
  let tagInputs = {};          // componentes de tag do modal
  let importParsed = null;     // patches vindos do .html
  let enriquecendo = false;

  const filtros = {
    busca: '', zera: false, ordenar: 'data_adicao',
    prioridade: new Set(), intencao: new Set(), status: new Set(),
    genero: new Set(), estilo: new Set(), vibe: new Set(),
    origem: new Set(), curadoria: new Set()
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rotulo(mapa, k) { return mapa[k] || k; }
  function pedir(msg) { return new Promise(function (r) { chrome.runtime.sendMessage(msg, r); }); }
  function toast(txt, err) {
    const t = $('#toast'); t.textContent = txt; t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false; clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* =========================================================================
   * INICIALIZAÇÃO
   * ======================================================================= */
  async function init() {
    config = await G.carregarConfig();
    jogos = await G.carregarJogos();
    construirFiltros();
    construirVisoes();
    construirSelectsModal();
    ligarEventos();
    render();
    tratarHash();
  }

  function tratarHash() {
    const h = location.hash || '';
    const mE = h.match(/editar=([\w-]+)/);
    if (mE) { const j = jogos.find(function (x) { return x.id === mE[1]; }); if (j) abrirEditar(j.id); return; }
    const mA = h.match(/add=([^&]+)/);
    if (mA) {
      const url = decodeURIComponent(mA[1]);
      $('#add-url').value = url;
      history.replaceState(null, '', location.pathname); // limpa o hash
      adicionarUrl();
    }
  }

  /* =========================================================================
   * FILTROS (sidebar)
   * ======================================================================= */
  function chipsDe(containerSel, mapa, chave, extraClasse) {
    const c = $(containerSel); c.innerHTML = '';
    Object.keys(mapa).forEach(function (k) {
      const el = document.createElement('span');
      el.className = 'chip';
      el.textContent = mapa[k];
      el.dataset.k = k;
      el.addEventListener('click', function () {
        const set = filtros[chave];
        if (set.has(k)) { set.delete(k); el.classList.remove('on'); }
        else { set.add(k); el.classList.add('on'); }
        if (extraClasse) el.classList.toggle(k, set.has(k));
        limparVisaoAtiva();
        render();
      });
      c.appendChild(el);
    });
  }

  // prettifica um slug custom (ex.: "roguelite_indie" → "Roguelite indie")
  function bonito(slug) {
    return String(slug).replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }
  // une o enum padrão com quaisquer categorias custom já presentes nos jogos,
  // para que categorias criadas à mão também virem filtros clicáveis
  function mapaComExtras(mapa, campoJogo) {
    const out = Object.assign({}, mapa);
    jogos.forEach(function (j) {
      (j[campoJogo] || []).forEach(function (v) { if (!(v in out)) out[v] = bonito(v); });
    });
    return out;
  }

  function construirFiltros() {
    chipsDe('#f-prioridade', G.PRIORIDADES, 'prioridade', true);
    chipsDe('#f-intencao', G.INTENCOES, 'intencao');
    chipsDe('#f-status', G.STATUS_LANCAMENTO, 'status');
    chipsDe('#f-genero', mapaComExtras(G.GENEROS, 'genero'), 'genero');
    chipsDe('#f-estilo', mapaComExtras(G.ESTILOS, 'estilo_visual'), 'estilo');
    chipsDe('#f-vibe', mapaComExtras(G.VIBES, 'vibe'), 'vibe');
    chipsDe('#f-origem', G.ORIGENS, 'origem');
    chipsDe('#f-curadoria', G.STATUS_CURADORIA, 'curadoria');
  }

  // reconstrói os chips (para captar categorias novas) preservando a seleção atual
  function atualizarFiltros() { construirFiltros(); sincronizarChips(); }

  function sincronizarChips() {
    document.querySelectorAll('.filtros .chip').forEach(function (el) {
      const grupo = el.closest('.filtro-grupo').querySelector('.chips').id;
      const chave = ({ 'f-prioridade': 'prioridade', 'f-intencao': 'intencao', 'f-status': 'status',
        'f-genero': 'genero', 'f-estilo': 'estilo', 'f-vibe': 'vibe', 'f-origem': 'origem', 'f-curadoria': 'curadoria' })[grupo];
      const on = filtros[chave].has(el.dataset.k);
      el.classList.toggle('on', on);
      el.classList.toggle(el.dataset.k, on && grupo === 'f-prioridade');
    });
    $('#f-zera').checked = filtros.zera;
    $('#ordenar').value = filtros.ordenar;
  }

  function limparFiltros() {
    filtros.busca = ''; filtros.zera = false;
    ['prioridade', 'intencao', 'status', 'genero', 'estilo', 'vibe', 'origem', 'curadoria']
      .forEach(function (k) { filtros[k].clear(); });
    $('#busca').value = '';
    sincronizarChips();
    limparVisaoAtiva();
    render();
  }

  /* =========================================================================
   * VISÕES PRONTAS (spec 7.3)
   * ======================================================================= */
  const VISOES = [
    { id: 'todos', nome: 'Todos', aplica: function () { limparFiltrosState(); } },
    { id: 'zera', nome: '⚡ Zera rápido', aplica: function () { limparFiltrosState(); filtros.zera = true; filtros.ordenar = 'tempo_para_zerar'; } },
    { id: 'lancar', nome: '⏳ Vão lançar ainda', aplica: function () { limparFiltrosState(); filtros.status.add('nao_lancado'); filtros.status.add('indefinido'); filtros.ordenar = 'data_prevista'; } },
    { id: 'alta', nome: '🔥 Prioridade alta', aplica: function () { limparFiltrosState(); filtros.prioridade.add('alta'); } },
    { id: 'detonado', nome: '👀 Só assistir', aplica: function () { limparFiltrosState(); filtros.intencao.add('assistir_walkthrough'); } },
    { id: 'apoiar', nome: '💜 Comprar e apoiar', aplica: function () { limparFiltrosState(); filtros.intencao.add('comprar_apoiar'); } },
    { id: 'rejogar', nome: '🔁 Rejogar', aplica: function () { limparFiltrosState(); filtros.intencao.add('rejogar'); } },
    { id: 'leads', nome: '🔎 A pesquisar', aplica: function () { limparFiltrosState(); filtros.curadoria.add('a_pesquisar'); } }
  ];
  let visaoAtiva = 'todos';

  function limparFiltrosState() {
    filtros.busca = ''; filtros.zera = false; filtros.ordenar = 'data_adicao';
    ['prioridade', 'intencao', 'status', 'genero', 'estilo', 'vibe', 'origem', 'curadoria']
      .forEach(function (k) { filtros[k].clear(); });
    $('#busca').value = '';
  }

  function construirVisoes() {
    const nav = $('#visoes'); nav.innerHTML = '';
    VISOES.forEach(function (v) {
      const b = document.createElement('button');
      b.className = 'visao' + (v.id === visaoAtiva ? ' ativa' : '');
      b.textContent = v.nome; b.dataset.id = v.id;
      b.addEventListener('click', function () {
        v.aplica(); visaoAtiva = v.id;
        document.querySelectorAll('.visao').forEach(function (x) { x.classList.toggle('ativa', x.dataset.id === v.id); });
        sincronizarChips(); render();
      });
      nav.appendChild(b);
    });
  }

  function limparVisaoAtiva() {
    visaoAtiva = null;
    document.querySelectorAll('.visao').forEach(function (x) { x.classList.remove('ativa'); });
  }

  /* =========================================================================
   * RENDER DA LISTA
   * ======================================================================= */
  function algum(arr, set) { return arr.some(function (x) { return set.has(x); }); }

  function passa(j) {
    if (filtros.busca) {
      const q = norm(filtros.busca);
      if (norm((j.nome || '') + ' ' + (j.notas || '')).indexOf(q) < 0) return false;
    }
    if (filtros.zera && !G.ehZeraRapido(j, config)) return false;
    if (filtros.prioridade.size && !filtros.prioridade.has(j.prioridade)) return false;
    if (filtros.intencao.size && !filtros.intencao.has(j.intencao)) return false;
    if (filtros.status.size && !filtros.status.has(j.status_lancamento)) return false;
    if (filtros.origem.size && !filtros.origem.has(j.origem)) return false;
    if (filtros.curadoria.size) { if (!filtros.curadoria.has(j.status_curadoria)) return false; }
    else if (j.status_curadoria === 'arquivado') return false;
    if (filtros.genero.size && !algum(j.genero, filtros.genero)) return false;
    if (filtros.estilo.size && !algum(j.estilo_visual, filtros.estilo)) return false;
    if (filtros.vibe.size && !algum(j.vibe, filtros.vibe)) return false;
    return true;
  }

  function ordenarLista(lista) {
    const prio = { alta: 0, media: 1, baixa: 2 };
    const arr = lista.slice();
    const ord = filtros.ordenar;
    function numAsc(a, b) {
      const an = a == null ? Infinity : a, bn = b == null ? Infinity : b;
      return an - bn;
    }
    arr.sort(function (a, b) {
      switch (ord) {
        case 'data_prevista': {
          const da = G.diasRestantes(a), db = G.diasRestantes(b);
          return numAsc(da == null ? null : da, db == null ? null : db);
        }
        case 'tempo_para_zerar': return numAsc(a.tempo_para_zerar, b.tempo_para_zerar);
        case 'prioridade': return (prio[a.prioridade] == null ? 9 : prio[a.prioridade]) - (prio[b.prioridade] == null ? 9 : prio[b.prioridade]);
        case 'desconto': return (b.desconto_pct || 0) - (a.desconto_pct || 0);
        case 'nome': return (a.nome || '').localeCompare(b.nome || '', 'pt');
        default: return String(b.data_adicao || '').localeCompare(String(a.data_adicao || ''));
      }
    });
    return arr;
  }

  function render() {
    const filtrados = ordenarLista(jogos.filter(passa));
    const grade = $('#grade');
    grade.innerHTML = filtrados.map(cardHtml).join('');
    $('#vazio').hidden = filtrados.length > 0;
    $('#grade').hidden = filtrados.length === 0;
    $('#resumo').textContent = filtrados.length + ' de ' + jogos.length + ' jogo' + (jogos.length === 1 ? '' : 's');
    // liga ações dos cards
    grade.querySelectorAll('[data-editar]').forEach(function (b) {
      b.addEventListener('click', function () { abrirEditar(b.dataset.editar); });
    });
    grade.querySelectorAll('[data-remover]').forEach(function (b) {
      b.addEventListener('click', function () { remover(b.dataset.remover); });
    });
  }

  function cardHtml(j) {
    const badges = [];
    badges.push(mini(rotulo(G.ORIGENS, j.origem), 'accent'));
    badges.push(mini(rotulo(G.INTENCOES, j.intencao)));
    if (j.status_lancamento !== 'lancado') {
      badges.push(mini('⏳ ' + (G.formatarContagem(j) || rotulo(G.STATUS_LANCAMENTO, j.status_lancamento)), 'warn'));
    }
    if (G.ehZeraRapido(j, config)) badges.push(mini('⚡ ' + j.tempo_para_zerar + 'h', 'zera'));
    if (j.desconto_pct) badges.push(mini('-' + j.desconto_pct + '%', 'desc'));
    if (j.preco_atual) badges.push(mini(esc(j.preco_atual)));
    if (j.status_curadoria === 'a_pesquisar') badges.push(mini('🔎 pesquisar', 'warn'));

    const tags = []
      .concat(j.genero.map(function (g) { return rotulo(G.GENEROS, g); }))
      .concat(j.estilo_visual.map(function (e) { return rotulo(G.ESTILOS, e); }))
      .concat(j.vibe.map(function (v) { return rotulo(G.VIBES, v); }));

    const capa = j.capa_url
      ? '<img class="card-capa" src="' + esc(j.capa_url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<div class="card-capa card-capa-vazia" style="display:none">🎮</div>'
      : '<div class="card-capa card-capa-vazia">🎮</div>';

    const acaoOrigem = j.url_origem
      ? '<a href="' + esc(j.url_origem) + '" target="_blank" rel="noopener">Abrir ↗</a>' : '';
    const acaoVideo = j.url_video
      ? '<a href="' + esc(j.url_video) + '" target="_blank" rel="noopener" title="Ver vídeo">▶</a>' : '';

    return '<article class="card">' +
      '<div class="card-prio ' + esc(j.prioridade) + '" title="Prioridade ' + esc(rotulo(G.PRIORIDADES, j.prioridade)) + '"></div>' +
      capa +
      '<div class="card-corpo">' +
        '<div class="card-titulo">' + esc(j.nome || '(sem nome)') + '</div>' +
        '<div class="card-badges">' + badges.join('') + '</div>' +
        (tags.length ? '<div class="card-tags">' + tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        (j.notas ? '<div class="card-notas">' + esc(j.notas) + '</div>' : '') +
        '<div class="card-acoes">' + acaoOrigem + acaoVideo +
          '<button data-editar="' + j.id + '">Editar</button>' +
          '<button class="rem" data-remover="' + j.id + '">Remover</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function mini(txt, cls) { return '<span class="mini' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</span>'; }

  async function remover(id) {
    const j = jogos.find(function (x) { return x.id === id; });
    if (!j) return;
    if (!confirm('Remover “' + (j.nome || 'este jogo') + '” da lista?')) return;
    jogos = jogos.filter(function (x) { return x.id !== id; });
    await G.salvarJogos(jogos);
    render(); atualizarFiltros(); toast('Removido.');
  }

  /* =========================================================================
   * MODAL EDITAR
   * ======================================================================= */
  function construirSelectsModal() {
    encherSelect('#ed-origem', G.ORIGENS);
    encherSelect('#ed-curadoria', G.STATUS_CURADORIA);
    encherSelect('#ed-intencao', G.INTENCOES);
    encherSelect('#ed-prioridade', G.PRIORIDADES);
    encherSelect('#ed-status', G.STATUS_LANCAMENTO);
  }
  function encherSelect(sel, mapa) {
    const s = $(sel); s.innerHTML = '';
    Object.keys(mapa).forEach(function (k) {
      const o = document.createElement('option'); o.value = k; o.textContent = mapa[k]; s.appendChild(o);
    });
  }

  function abrirEditar(id, patchNovo) {
    let jogo, ehNovo = false;
    if (id) { jogo = jogos.find(function (x) { return x.id === id; }); if (!jogo) return; }
    else { jogo = G.novoJogo(patchNovo || {}); ehNovo = true; }
    editando = { jogo: jogo, ehNovo: ehNovo };

    $('#editar-titulo').textContent = ehNovo ? 'Adicionar jogo' : 'Editar jogo';
    $('#ed-nome').value = jogo.nome || '';
    $('#ed-origem').value = jogo.origem || 'outro';
    $('#ed-curadoria').value = jogo.status_curadoria || 'validado';
    $('#ed-url').value = jogo.url_origem || '';
    $('#ed-video').value = jogo.url_video || '';
    $('#ed-capa-url').value = jogo.capa_url || '';
    $('#ed-intencao').value = jogo.intencao || 'jogar';
    $('#ed-prioridade').value = jogo.prioridade || 'media';
    $('#ed-status').value = jogo.status_lancamento || 'lancado';
    $('#ed-data').value = jogo.data_prevista || '';
    $('#ed-ano').value = jogo.ano_alvo || '';
    $('#ed-tempo').value = jogo.tempo_para_zerar == null ? '' : jogo.tempo_para_zerar;
    $('#ed-preco').value = jogo.preco_atual || '';
    $('#ed-desc').value = jogo.desconto_pct == null ? '' : jogo.desconto_pct;
    $('#ed-notas').value = jogo.notas || '';

    tagInputs.genero = makeTagInput($('#ed-genero'), jogo.genero, G.GENEROS);
    tagInputs.estilo = makeTagInput($('#ed-estilo'), jogo.estilo_visual, G.ESTILOS);
    tagInputs.vibe = makeTagInput($('#ed-vibe'), jogo.vibe, G.VIBES);

    atualizarCapaModal(jogo.capa_url, jogo.url_origem, jogo.url_video);
    $('#ed-revalidar').style.display = jogo.steam_appid ? '' : 'none';
    abrirModal('#modal-editar');
    $('#ed-nome').focus();
  }

  function atualizarCapaModal(capa, origem, video) {
    const img = $('#ed-capa-img'), vazia = $('#ed-capa-vazia');
    if (capa) { img.src = capa; img.hidden = false; vazia.hidden = true; img.onerror = function () { img.hidden = true; vazia.hidden = false; }; }
    else { img.hidden = true; vazia.hidden = false; }
    const lo = $('#ed-origem-link'), lv = $('#ed-video-link');
    if (origem) { lo.href = origem; lo.hidden = false; } else lo.hidden = true;
    if (video) { lv.href = video; lv.hidden = false; } else lv.hidden = true;
  }

  async function salvarEdicao() {
    const j = editando.jogo;
    j.nome = $('#ed-nome').value.trim();
    j.origem = $('#ed-origem').value;
    j.status_curadoria = $('#ed-curadoria').value;
    j.url_origem = $('#ed-url').value.trim();
    j.url_video = $('#ed-video').value.trim();
    j.capa_url = $('#ed-capa-url').value.trim();
    j.intencao = $('#ed-intencao').value;
    j.prioridade = $('#ed-prioridade').value;
    j.status_lancamento = $('#ed-status').value;
    j.data_prevista = $('#ed-data').value || '';
    j.ano_alvo = $('#ed-ano').value ? parseInt($('#ed-ano').value, 10) : null;
    j.tempo_para_zerar = $('#ed-tempo').value === '' ? null : Number($('#ed-tempo').value);
    j.preco_atual = $('#ed-preco').value.trim() || null;
    j.desconto_pct = $('#ed-desc').value === '' ? null : parseInt($('#ed-desc').value, 10);
    j.notas = $('#ed-notas').value.trim();
    j.genero = tagInputs.genero.get();
    j.estilo_visual = tagInputs.estilo.get();
    j.vibe = tagInputs.vibe.get();
    j.steam_appid = j.steam_appid || G.extrairAppId(j.url_origem);
    j.edited_manually = true;
    G.normalizarJogo(j);

    if (editando.ehNovo) jogos.push(j);
    await G.salvarJogos(jogos);
    fecharModais(); render(); atualizarFiltros();
    toast(editando.ehNovo ? 'Jogo adicionado!' : 'Alterações salvas.');
  }

  async function revalidarSteam() {
    const j = editando.jogo;
    const appid = j.steam_appid || G.extrairAppId(j.url_origem);
    if (!appid) return toast('Sem AppID da Steam.', true);
    toast('Consultando Steam…');
    const r = await pedir({ tipo: 'steam', appid: appid });
    if (!r || !r.ok) return toast((r && r.msg) || 'Falha na Steam.', true);
    const p = G.dadosParaPatch(r.dados);
    if (p.nome) $('#ed-nome').value = p.nome;
    if (p.capa_url) $('#ed-capa-url').value = p.capa_url;
    if (p.preco_atual) $('#ed-preco').value = p.preco_atual;
    if (p.desconto_pct != null) $('#ed-desc').value = p.desconto_pct;
    if (p.status_lancamento) $('#ed-status').value = p.status_lancamento;
    if (p.ano_alvo) $('#ed-ano').value = p.ano_alvo;
    if (p.genero && p.genero.length) tagInputs.genero.set(G.uniao(tagInputs.genero.get(), p.genero));
    atualizarCapaModal($('#ed-capa-url').value, j.url_origem, j.url_video);
    toast('Dados atualizados da Steam.');
  }

  /* componente de tag com sugestões (datalist) */
  function makeTagInput(container, valores, sugest) {
    container.innerHTML = '';
    const st = { valores: (valores || []).slice() };
    const dl = document.createElement('datalist');
    dl.id = container.id + '-dl';
    Object.keys(sugest).forEach(function (k) { const o = document.createElement('option'); o.value = sugest[k]; dl.appendChild(o); });
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = '+ adicionar…'; input.setAttribute('list', dl.id);
    function slug(t) { return norm(t).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
    function chaveDe(txt) {
      const n = norm(txt);
      for (const k in sugest) { if (norm(sugest[k]) === n || k === n) return k; }
      return slug(txt);
    }
    function render() {
      Array.prototype.slice.call(container.querySelectorAll('.ti-chip')).forEach(function (n) { n.remove(); });
      st.valores.forEach(function (v, i) {
        const chip = document.createElement('span'); chip.className = 'ti-chip';
        chip.textContent = sugest[v] || v;
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '×';
        x.addEventListener('click', function () { st.valores.splice(i, 1); render(); });
        chip.appendChild(x); container.insertBefore(chip, input);
      });
    }
    function add(txt) {
      txt = (txt || '').trim(); if (!txt) return;
      const k = chaveDe(txt);
      if (k && st.valores.indexOf(k) < 0) st.valores.push(k);
      input.value = ''; render();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
      else if (e.key === 'Backspace' && !input.value && st.valores.length) { st.valores.pop(); render(); }
    });
    input.addEventListener('change', function () { if (input.value) add(input.value); });
    container.appendChild(dl); container.appendChild(input); render();
    return { get: function () { return st.valores.slice(); }, set: function (v) { st.valores = (v || []).slice(); render(); } };
  }

  /* =========================================================================
   * ADICIONAR (topbar)
   * ======================================================================= */
  async function adicionarUrl() {
    const u = $('#add-url').value.trim();
    if (!u) return;
    toast('Validando…');
    const r = await pedir({ tipo: 'validar', url: u });
    const patch = G.dadosParaPatch((r && r.dados) || { url_origem: u, origem: G.detectarOrigem(u) });
    $('#add-url').value = '';
    if (r && r.semPermissaoOG) toast('Salvo. (Ative Open Graph em ⚙ para puxar nome/capa deste site.)');
    abrirEditar(null, patch);
  }

  function adicionarLead() {
    const nome = prompt('Nome do jogo (lead “a pesquisar”):');
    if (!nome) return;
    abrirEditar(null, {
      nome: nome.trim(), origem: 'google', status_curadoria: 'a_pesquisar',
      url_origem: 'https://www.google.com/search?q=' + encodeURIComponent(nome.trim() + ' jogo')
    });
  }

  /* =========================================================================
   * IMPORTAR .html
   * ======================================================================= */
  function lerArquivo(file) {
    return new Promise(function (res, rej) {
      const fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsText(file);
    });
  }

  async function arquivoBookmarksSelecionado(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const txt = await lerArquivo(f);
      importParsed = IMP.parse(txt);
    } catch (err) { return toast('Erro ao ler o arquivo.', true); }
    const prev = $('#imp-previa');
    const amostra = importParsed.patches.slice(0, 30).map(function (p) {
      return '<div class="imp-linha"><span>' + esc(p.nome || '(sem nome)') + '</span>' +
        '<span class="muted">' + esc(rotulo(G.ORIGENS, p.origem)) + '</span></div>';
    }).join('');
    prev.innerHTML = '<strong>' + importParsed.totalLinks + ' links</strong> em ' +
      importParsed.pastas.length + ' pastas.<br>' +
      '<div class="muted pequeno" style="margin:4px 0 8px">' + resumoPorOrigem(importParsed.porOrigem) + '</div>' +
      '<span class="muted pequeno">Amostra:</span>' + amostra +
      (importParsed.totalLinks > 30 ? '<div class="muted pequeno">…e mais ' + (importParsed.totalLinks - 30) + '.</div>' : '');
    prev.hidden = false;
    $('#btn-fazer-import').disabled = importParsed.totalLinks === 0;
  }

  function resumoPorOrigem(porOrigem) {
    return Object.keys(porOrigem || {})
      .sort(function (a, b) { return porOrigem[b] - porOrigem[a]; })
      .map(function (k) { return porOrigem[k] + ' ' + rotulo(G.ORIGENS, k); })
      .join(' · ');
  }

  async function executarImportacao() {
    if (!importParsed || !importParsed.patches.length) return;
    $('#btn-fazer-import').disabled = true;
    let criados = 0, mesclados = 0;
    for (const p of importParsed.patches) {
      const res = await G.upsertJogo(p);
      if (res.criado) criados++; else mesclados++;
    }
    jogos = await G.carregarJogos();
    render(); atualizarFiltros();
    $('#imp-status').textContent = criados + ' novos, ' + mesclados + ' já existiam (' +
      resumoPorOrigem(importParsed.porOrigem) + ').';
    toast('Importados: ' + criados + ' novos jogos/links.');

    if ($('#imp-enriquecer').checked) {
      await enriquecerSteam();
    }
    $('#btn-fazer-import').disabled = false;
  }

  const dorme = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Enriquece jogos da Steam que ainda não têm dados. Respeita o rate limit da
  // Steam (~200 req/5min): 800ms entre chamadas + backoff/retry no 429. Como só
  // mira jogos incompletos, rodar de novo depois continua de onde parou.
  async function enriquecerSteam() {
    const alvos = jogos.filter(function (j) { return j.steam_appid && (!j.nome || !j.capa_url || j.preco_atual == null); });
    const box = $('#imp-progresso'); box.hidden = false;
    if (!alvos.length) { $('#imp-progresso-txt').textContent = 'Nada a validar (tudo já tem dados).'; $('#imp-barra').style.width = '100%'; return; }
    enriquecendo = true;
    let i = 0, rateSeguidos = 0, ok = 0;
    while (i < alvos.length) {
      if (!enriquecendo) { $('#imp-progresso-txt').textContent = 'Parado em ' + i + '/' + alvos.length + '.'; break; }
      const j = alvos[i];
      $('#imp-progresso-txt').textContent = 'Validando Steam ' + (i + 1) + '/' + alvos.length + '…';
      $('#imp-barra').style.width = Math.round((i / alvos.length) * 100) + '%';
      const r = await pedir({ tipo: 'steam', appid: j.steam_appid });
      if (r && r.ok) {
        rateSeguidos = 0; ok++;
        const p = G.dadosParaPatch(r.dados);
        if (!j.nome && p.nome) j.nome = p.nome;
        if (!j.capa_url && p.capa_url) j.capa_url = p.capa_url;
        if (j.preco_atual == null && p.preco_atual != null) j.preco_atual = p.preco_atual;
        if (j.desconto_pct == null && p.desconto_pct != null) j.desconto_pct = p.desconto_pct;
        if (p.status_lancamento && j.status_lancamento === 'lancado' && p.status_lancamento !== 'lancado') j.status_lancamento = p.status_lancamento;
        if (!j.ano_alvo && p.ano_alvo) j.ano_alvo = p.ano_alvo;
        if (p.genero && p.genero.length) j.genero = G.uniao(j.genero, p.genero);
        i++;
        if (ok % 10 === 0) { await G.salvarJogos(jogos); render(); }
        await dorme(1500);
      } else if (r && r.erro === 'rate') {
        rateSeguidos++;
        if (rateSeguidos > 3) {
          $('#imp-progresso-txt').textContent = 'Steam limitou (rate limit). Pausado em ' + i + '/' + alvos.length +
            '. Rode “Validar Steam” de novo daqui a alguns minutos para continuar.';
          break;
        }
        await dorme(6000); // espera e tenta o MESMO item de novo
      } else {
        i++; // outro erro (appid removido etc.): pula
        await dorme(1500);
      }
    }
    await G.salvarJogos(jogos);
    render();
    if (enriquecendo && i >= alvos.length) {
      $('#imp-barra').style.width = '100%';
      $('#imp-progresso-txt').textContent = 'Concluído: ' + ok + ' validados de ' + alvos.length + '.';
      toast('Validação da Steam concluída.');
    }
    enriquecendo = false;
  }

  /* =========================================================================
   * BACKUP (JSON)
   * ======================================================================= */
  function exportarJson() {
    const dados = { versao: 1, exportadoEm: new Date().toISOString(), config: config, jogos: jogos };
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'jogos-favoritos-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    $('#backup-status').textContent = 'Exportado ' + jogos.length + ' jogos.';
  }

  async function restaurarJson(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    let dados;
    try { dados = JSON.parse(await lerArquivo(f)); } catch (err) { return toast('JSON inválido.', true); }
    const importados = (dados.jogos || []).map(G.normalizarJogo);
    if ($('#restaurar-mesclar').checked) {
      for (const j of importados) { await G.upsertJogo(j); }
    } else {
      if (!confirm('Substituir TODOS os jogos atuais por este backup?')) return;
      await G.salvarJogos(importados);
    }
    if (dados.config) { config = Object.assign({}, G.DEFAULT_SETTINGS, dados.config); await G.salvarConfig(config); }
    jogos = await G.carregarJogos();
    render(); atualizarFiltros();
    $('#backup-status').textContent = 'Restaurado. Agora: ' + jogos.length + ' jogos.';
    toast('Backup restaurado.');
  }

  /* =========================================================================
   * CONFIG
   * ======================================================================= */
  async function abrirConfig() {
    $('#cfg-zera').value = config.zeraRapidoLimite;
    $('#cfg-lang').value = config.steamLang;
    $('#cfg-cc').value = config.steamCc;
    chrome.permissions.contains({ origins: ['<all_urls>'] }, function (has) { $('#cfg-og').checked = !!has; });
    abrirModal('#modal-config');
  }
  async function salvarConfigUI() {
    config.zeraRapidoLimite = Math.max(1, parseInt($('#cfg-zera').value, 10) || 6);
    config.steamLang = $('#cfg-lang').value.trim() || 'portuguese';
    config.steamCc = $('#cfg-cc').value.trim() || 'br';
    await G.salvarConfig(config);
    render();
  }
  function toggleOG() {
    if ($('#cfg-og').checked) {
      chrome.permissions.request({ origins: ['<all_urls>'] }, function (g) { $('#cfg-og').checked = !!g; });
    } else {
      chrome.permissions.remove({ origins: ['<all_urls>'] }, function () {});
    }
  }
  async function limparTudo() {
    if (!confirm('Apagar TODOS os ' + jogos.length + ' jogos? Isso não pode ser desfeito.')) return;
    if (!confirm('Tem certeza mesmo? Considere exportar um backup antes.')) return;
    jogos = []; await G.salvarJogos(jogos); render(); atualizarFiltros(); toast('Tudo apagado.');
  }

  /* =========================================================================
   * MODAIS (helpers) + EVENTOS
   * ======================================================================= */
  function abrirModal(sel) { $(sel).hidden = false; }
  function fecharModais() { document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; }); }

  function ligarEventos() {
    $('#btn-add-url').addEventListener('click', adicionarUrl);
    $('#add-url').addEventListener('keydown', function (e) { if (e.key === 'Enter') adicionarUrl(); });
    $('#btn-add-lead').addEventListener('click', adicionarLead);

    $('#busca').addEventListener('input', function () { filtros.busca = this.value; limparVisaoAtiva(); render(); });
    $('#ordenar').addEventListener('change', function () { filtros.ordenar = this.value; render(); });
    $('#f-zera').addEventListener('change', function () { filtros.zera = this.checked; limparVisaoAtiva(); render(); });
    $('#btn-limpar').addEventListener('click', limparFiltros);

    $('#ed-salvar').addEventListener('click', salvarEdicao);
    $('#ed-revalidar').addEventListener('click', revalidarSteam);
    $('#ed-hltb').addEventListener('click', function () {
      const nome = $('#ed-nome').value.trim();
      window.open('https://howlongtobeat.com/?q=' + encodeURIComponent(nome), '_blank', 'noopener');
    });
    $('#ed-status').addEventListener('change', function () {
      // se marcar "lançado", esconde relevância de data (apenas UX leve)
    });

    $('#btn-importar').addEventListener('click', function () { $('#imp-status').textContent = ''; abrirModal('#modal-importar'); });
    $('#arquivo-bookmarks').addEventListener('change', arquivoBookmarksSelecionado);
    $('#btn-fazer-import').addEventListener('click', executarImportacao);
    $('#btn-so-enriquecer').addEventListener('click', enriquecerSteam);
    $('#imp-cancelar').addEventListener('click', function () { enriquecendo = false; });

    $('#btn-backup').addEventListener('click', function () { $('#backup-status').textContent = ''; abrirModal('#modal-backup'); });
    $('#btn-exportar-json').addEventListener('click', exportarJson);
    $('#arquivo-json').addEventListener('change', restaurarJson);

    $('#btn-config').addEventListener('click', abrirConfig);
    ['#cfg-zera', '#cfg-lang', '#cfg-cc'].forEach(function (s) { $(s).addEventListener('change', salvarConfigUI); });
    $('#cfg-og').addEventListener('change', toggleOG);
    $('#btn-limpar-tudo').addEventListener('click', limparTudo);

    document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', fecharModais); });
    document.querySelectorAll('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) fecharModais(); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharModais(); });
  }

  init();
})();
