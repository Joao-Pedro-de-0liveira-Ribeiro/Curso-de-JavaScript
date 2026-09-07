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
  let importTipo = null;       // 'html' | 'json' | 'txt'
  let importJson = null;       // dados do backup .json selecionado
  let enriquecendo = false;
  let revalidandoPrecos = false;

  const filtros = {
    busca: '', zera: false, zerado: null, promo: false, ordenar: 'data_adicao',
    prioridade: new Set(), intencao: new Set(), status: new Set(),
    genero: new Set(), estilo: new Set(), vibe: new Set(),
    origem: new Set(), curadoria: new Set(), ano: new Set(), marcador: new Set()
  };
  const CHAVES_FILTRO = ['prioridade', 'intencao', 'status', 'genero', 'estilo', 'vibe', 'origem', 'curadoria', 'ano', 'marcador'];

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rotulo(mapa, k) { return mapa[k] || k; }
  // rótulo com ícone (quando houver) — para chips, tags e presets
  function lbl(mapa, k) { return (G.ICONES[k] ? G.ICONES[k] + ' ' : '') + (mapa[k] || k); }
  function pedir(msg) { return new Promise(function (r) { chrome.runtime.sendMessage(msg, r); }); }
  function toast(txt, err) {
    const t = $('#toast'); t.textContent = txt; t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false; clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* =========================================================================
   * INICIALIZAÇÃO
   * ======================================================================= */
  let temposSalvos = [];       // lista de tempos importada, persistida

  async function init() {
    config = await G.carregarConfig();
    jogos = await G.carregarJogos();
    temposSalvos = await new Promise(function (r) { chrome.storage.local.get('gjf_tempos', function (o) { r((o && o.gjf_tempos) || []); }); });
    construirFiltros();
    construirVisoes();
    construirSelectsModal();
    ligarEventos();
    render();
    aplicarTemposSalvos(); // preenche tempos faltantes pela lista embutida do projeto
    tratarHash();
    // NÃO consulta a Steam sozinho ao abrir a página — isso gerava o bloqueio
    // por excesso de acesso (rate limit). Preços só quando você clica em
    // "💲 Atualizar preços" na barra de topo.
  }

  // Revalida preço/desconto dos jogos da Steam. SÓ roda quando o usuário clica
  // no botão "💲 Atualizar preços" (nunca sozinho). Gentil e resistente a bloqueio.
  // forcar=true (padrão do botão) ignora a janela de horas e checa todos.
  async function revalidarPrecos(forcar) {
    if (revalidandoPrecos) { revalidandoPrecos = false; return; } // 2º clique = cancelar
    const limiteMs = (config.precoRevalidarHoras || 6) * 3600000;
    const agora = Date.now();
    const alvos = jogos.filter(function (j) {
      if (!j.steam_appid || j.edited_manually) return false;
      if (forcar || !j.preco_check) return true;
      return (agora - new Date(j.preco_check).getTime()) > limiteMs;
    });
    const elBtn = $('#btn-precos');
    if (!alvos.length) {
      const el = $('#preco-status'); el.hidden = false;
      el.textContent = '💲 Nenhum jogo da Steam para atualizar.';
      setTimeout(function () { el.hidden = true; }, 3000);
      return;
    }
    const el = $('#preco-status'); el.hidden = false;
    revalidandoPrecos = true;
    if (elBtn) elBtn.textContent = '✕ Parar (atualizando…)';
    let i = 0, rate = 0, ok = 0, mudou = 0, bloqueou = false;
    while (i < alvos.length) {
      if (!revalidandoPrecos) { break; }
      const j = alvos[i];
      el.textContent = '💲 Atualizando preços ' + (i + 1) + '/' + alvos.length + '…';
      const r = await pedir({ tipo: 'steam', appid: j.steam_appid });
      if (r && r.ok) {
        const p = G.dadosParaPatch(r.dados);
        const antes = j.desconto_pct;
        if (p.preco_atual != null) j.preco_atual = p.preco_atual;
        j.desconto_pct = p.desconto_pct != null ? p.desconto_pct : null; // some promo ao acabar
        j.preco_check = new Date().toISOString();
        if (j.desconto_pct !== antes) mudou++;
        rate = 0; ok++; i++;
        if (ok % 8 === 0) { await G.salvarJogos(jogos); render(); }
        await dorme(2000);
      } else if (r && r.erro === 'rate') {
        rate++;
        if (rate > 2) { bloqueou = true; break; }
        await dorme(8000);
      } else {
        j.preco_check = new Date().toISOString(); i++; await dorme(2000);
      }
    }
    await G.salvarJogos(jogos); render(); atualizarFiltros();
    const cancelado = !revalidandoPrecos && i < alvos.length && !bloqueou;
    revalidandoPrecos = false;
    if (elBtn) elBtn.textContent = '💲 Atualizar preços';
    if (bloqueou) el.textContent = '💲 A Steam bloqueou (' + ok + ' atualizados). Espere alguns minutos e clique de novo.';
    else if (cancelado) el.textContent = '💲 Parado (' + ok + ' atualizados).';
    else el.textContent = '💲 Preços atualizados' + (mudou ? ' — ' + mudou + ' mudaram' : '') + ' (' + ok + ').';
    setTimeout(function () { el.hidden = true; }, 4000);
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
      el.textContent = (chave === 'marcador') ? (G.iconeTag(k) + ' ' + (mapa[k] || k)) : lbl(mapa, k);
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

  // anos presentes na lista (para o filtro por ano), do mais novo ao mais antigo
  function mapaAnos() {
    const set = {};
    jogos.forEach(function (j) { if (j.ano_alvo) set[j.ano_alvo] = true; });
    const out = {};
    Object.keys(set).map(Number).sort(function (a, b) { return b - a; })
      .forEach(function (a) { out[String(a)] = String(a); });
    return out;
  }

  // marcadores populares presentes, mais frequentes primeiro (limita p/ não explodir)
  function mapaMarcadores() {
    const freq = {};
    jogos.forEach(function (j) { (j.marcadores || []).forEach(function (m) { freq[m] = (freq[m] || 0) + 1; }); });
    const out = {};
    Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a] || a.localeCompare(b, 'pt'); })
      .slice(0, 80).forEach(function (m) { out[m] = m; });
    return out;
  }

  function construirFiltros() {
    chipsDe('#f-prioridade', G.PRIORIDADES, 'prioridade', true);
    chipsDe('#f-intencao', G.INTENCOES, 'intencao');
    chipsDe('#f-status', G.STATUS_LANCAMENTO, 'status');
    chipsDe('#f-ano', mapaAnos(), 'ano');
    chipsDe('#f-genero', mapaComExtras(G.GENEROS, 'genero'), 'genero');
    chipsDe('#f-estilo', mapaComExtras(G.ESTILOS, 'estilo_visual'), 'estilo');
    chipsDe('#f-vibe', mapaComExtras(G.VIBES, 'vibe'), 'vibe');
    chipsDe('#f-origem', G.ORIGENS, 'origem');
    chipsDe('#f-curadoria', G.STATUS_CURADORIA, 'curadoria');
    chipsDe('#f-marcadores', mapaMarcadores(), 'marcador');
  }

  // reconstrói os chips (para captar categorias novas) preservando a seleção atual
  function atualizarFiltros() { construirFiltros(); sincronizarChips(); }

  function sincronizarChips() {
    document.querySelectorAll('.filtros .chip').forEach(function (el) {
      const grupo = el.closest('.filtro-grupo').querySelector('.chips').id;
      const chave = ({ 'f-prioridade': 'prioridade', 'f-intencao': 'intencao', 'f-status': 'status',
        'f-ano': 'ano', 'f-genero': 'genero', 'f-estilo': 'estilo', 'f-vibe': 'vibe', 'f-origem': 'origem', 'f-curadoria': 'curadoria', 'f-marcadores': 'marcador' })[grupo];
      if (!chave || !filtros[chave]) return; // grupos especiais (ex.: #f-zerado) têm handler próprio
      const on = filtros[chave].has(el.dataset.k);
      el.classList.toggle('on', on);
      el.classList.toggle(el.dataset.k, on && grupo === 'f-prioridade');
    });
    $('#f-zera').checked = filtros.zera;
    $('#f-promo').checked = filtros.promo;
    $('#ordenar').value = filtros.ordenar;
    sincronizarZerado();
  }

  function sincronizarZerado() {
    document.querySelectorAll('#f-zerado .chip').forEach(function (c) {
      const alvo = c.dataset.z === 'sim' ? true : false;
      c.classList.toggle('on', filtros.zerado === alvo);
    });
  }

  function limparFiltros() {
    filtros.busca = ''; filtros.zera = false; filtros.zerado = null; filtros.promo = false;
    CHAVES_FILTRO.forEach(function (k) { filtros[k].clear(); });
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
    { id: 'promo', nome: '🏷️ Em promoção', aplica: function () { limparFiltrosState(); filtros.promo = true; filtros.ordenar = 'desconto'; } },
    { id: 'zerados', nome: '✔ Zerados', aplica: function () { limparFiltrosState(); filtros.zerado = true; } },
    { id: 'backlog', nome: '🎯 Falta zerar', aplica: function () { limparFiltrosState(); filtros.zerado = false; } },
    { id: 'leads', nome: '🔎 A pesquisar', aplica: function () { limparFiltrosState(); filtros.curadoria.add('a_pesquisar'); } }
  ];
  let visaoAtiva = 'todos';

  function limparFiltrosState() {
    filtros.busca = ''; filtros.zera = false; filtros.zerado = null; filtros.promo = false; filtros.ordenar = 'data_adicao';
    CHAVES_FILTRO.forEach(function (k) { filtros[k].clear(); });
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
    if (filtros.promo && !(j.desconto_pct > 0)) return false;
    if (filtros.zerado === true && !j.zerado) return false;
    if (filtros.zerado === false && j.zerado) return false;
    if (filtros.prioridade.size && !filtros.prioridade.has(j.prioridade)) return false;
    if (filtros.intencao.size && !filtros.intencao.has(j.intencao)) return false;
    if (filtros.status.size && !filtros.status.has(G.statusEfetivo(j))) return false;
    if (filtros.ano.size && !filtros.ano.has(String(j.ano_alvo))) return false;
    if (filtros.origem.size && !filtros.origem.has(j.origem)) return false;
    if (filtros.curadoria.size) { if (!filtros.curadoria.has(j.status_curadoria)) return false; }
    else if (j.status_curadoria === 'arquivado') return false;
    if (filtros.genero.size && !algum(j.genero, filtros.genero)) return false;
    if (filtros.estilo.size && !algum(j.estilo_visual, filtros.estilo)) return false;
    if (filtros.vibe.size && !algum(j.vibe, filtros.vibe)) return false;
    if (filtros.marcador.size && !algum(j.marcadores || [], filtros.marcador)) return false;
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
    const st = G.statusEfetivo(j);
    const badges = [];
    badges.push(mini(lbl(G.ORIGENS, j.origem), 'accent'));
    badges.push(mini(rotulo(G.INTENCOES, j.intencao)));
    if (j.zerado) badges.push(mini('✔ Zerado', 'ok'));
    if (G.ehZeraRapido(j, config)) badges.push(mini('⚡ ' + j.tempo_para_zerar + 'h', 'zera'));
    if (j.desconto_pct) badges.push(mini('-' + j.desconto_pct + '%', 'desc'));
    if (j.preco_atual) badges.push(mini(esc(j.preco_atual)));
    if (j.status_curadoria === 'a_pesquisar') badges.push(mini('🔎 pesquisar', 'warn'));

    // TAG de lançamento (entre as tags): ✅ Lançado / ⏳ faltam X dias / ⏳ Não lançado
    let statusTag;
    if (st === 'lancado') {
      statusTag = '<span class="tag tag-lancado">✅ Lançado</span>';
    } else {
      statusTag = '<span class="tag tag-naolancado">⏳ ' + esc(G.formatarContagem(j) || 'Não lançado') + '</span>';
    }
    // ⏱ tempo para zerar SEMPRE aparece
    const tempoTag = '<span class="tag tag-tempo">' +
      (j.tempo_para_zerar != null ? '⏱ ' + j.tempo_para_zerar + 'h' : '⏱ tempo?') + '</span>';

    // categorias com ícone
    const cats = []
      .concat(j.genero.map(function (g) { return lbl(G.GENEROS, g); }))
      .concat(j.estilo_visual.map(function (e) { return lbl(G.ESTILOS, e); }))
      .concat(j.vibe.map(function (v) { return lbl(G.VIBES, v); }));
    const catsHtml = cats.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');

    // marcadores populares da Steam (crus) — sem repetir o que já virou categoria
    const jaNorm = {};
    j.genero.forEach(function (g) { jaNorm[norm(rotulo(G.GENEROS, g))] = true; });
    j.estilo_visual.forEach(function (e) { jaNorm[norm(rotulo(G.ESTILOS, e))] = true; });
    j.vibe.forEach(function (v) { jaNorm[norm(rotulo(G.VIBES, v))] = true; });
    const marc = (j.marcadores || []).filter(function (m) { return !jaNorm[norm(m)]; });
    const marcHtml = marc.slice(0, 12).map(function (m) { return '<span class="tag tag-marcador">' + G.iconeTag(m) + ' ' + esc(m) + '</span>'; }).join('');

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
        '<div class="card-tags">' + statusTag + tempoTag + catsHtml + marcHtml + '</div>' +
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

    $('#ed-zerado').checked = !!jogo.zerado;
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
    j.zerado = $('#ed-zerado').checked;
    j.genero = tagInputs.genero.get();
    j.estilo_visual = tagInputs.estilo.get();
    j.vibe = tagInputs.vibe.get();
    j.steam_appid = j.steam_appid || G.extrairAppId(j.url_origem);
    j.edited_manually = true;
    G.normalizarJogo(j);

    const eraNovo = editando.ehNovo;
    if (eraNovo) jogos.push(j);
    await G.salvarJogos(jogos);
    fecharModais(); render(); atualizarFiltros();
    toast(eraNovo ? 'Jogo adicionado!' : 'Alterações salvas.');
    // jogo NOVO sem tempo → consulta o HowLongToBeat só desse jogo
    if (eraNovo && j.tempo_para_zerar == null && j.nome) {
      toast('Buscando tempo para zerar…');
      buscarTempoNovo(j.id);
    }
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
    if (p.data_prevista) $('#ed-data').value = p.data_prevista;
    toast('Dados atualizados da Steam.');
  }

  // busca uma capa automaticamente para o jogo aberto no editor
  async function buscarCapaJogoAtual() {
    const j = editando && editando.jogo; if (!j) return;
    const url = $('#ed-url').value.trim() || j.url_origem;
    const appid = j.steam_appid || G.extrairAppId(url);
    let capa = '';
    if (appid) {
      capa = G.capaSteam(appid);
    } else if (G.ehYouTube(url)) {
      capa = G.capaYoutube(url);
      if (!capa) { const r = await pedir({ tipo: 'youtube', url: url }); if (r && r.ok && r.dados) capa = r.dados.capa_url; }
    } else if (url) {
      toast('Buscando capa no site…');
      const r = await pedir({ tipo: 'og', url: url });
      if (r && r.ok && r.dados) capa = r.dados.capa_url;
    }
    if (capa) { $('#ed-capa-url').value = capa; atualizarCapaModal(capa, j.url_origem, j.url_video); toast('Capa encontrada!'); }
    else toast('Não achei capa automática — use o Google Imagens e cole a URL da capa.', true);
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
    // linha de OPÇÕES PRONTAS (clicáveis) logo abaixo do campo
    if (container.nextElementSibling && container.nextElementSibling.classList.contains('ti-presets')) {
      container.nextElementSibling.remove();
    }
    const presets = document.createElement('div');
    presets.className = 'ti-presets';
    container.parentNode.insertBefore(presets, container.nextSibling);

    function renderPresets() {
      presets.innerHTML = '';
      Object.keys(sugest).forEach(function (k) {
        if (st.valores.indexOf(k) >= 0) return;   // esconde o que já foi escolhido
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'preset';
        c.textContent = '+ ' + (G.ICONES[k] ? G.ICONES[k] + ' ' : '') + sugest[k];
        c.addEventListener('click', function () { add(sugest[k]); });
        presets.appendChild(c);
      });
    }
    function render() {
      Array.prototype.slice.call(container.querySelectorAll('.ti-chip')).forEach(function (n) { n.remove(); });
      st.valores.forEach(function (v, i) {
        const chip = document.createElement('span'); chip.className = 'ti-chip';
        chip.textContent = (G.ICONES[v] ? G.ICONES[v] + ' ' : '') + (sugest[v] || v);
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '×';
        x.addEventListener('click', function () { st.valores.splice(i, 1); render(); });
        chip.appendChild(x); container.insertBefore(chip, input);
      });
      renderPresets();
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
    let txt;
    try { txt = await lerArquivo(f); } catch (err) { return toast('Erro ao ler o arquivo.', true); }
    const prev = $('#imp-previa');
    importParsed = importJson = null; importTipo = null;
    const nome = (f.name || '').toLowerCase();
    const ehJson = nome.endsWith('.json') || /^\s*[\[{]/.test(txt);

    if (ehJson) {
      let d;
      try { d = JSON.parse(txt); } catch (err) { $('#btn-fazer-import').disabled = true; return toast('JSON inválido.', true); }
      const lista = Array.isArray(d) ? d : (d.jogos || []);
      importJson = d; importTipo = 'json';
      const rotulo = d.pendentes ? 'Tempos pendentes (JSON)' : 'Backup JSON';
      prev.innerHTML = '<strong>📦 ' + rotulo + '</strong> — ' + lista.length + ' jogos. Clique em <strong>Importar</strong> para mesclar (atualiza os existentes pelo AppID/URL).';
      prev.hidden = false;
      $('#btn-fazer-import').disabled = lista.length === 0;
      return;
    }
    // HTML (favoritos)
    importParsed = IMP.parse(txt); importTipo = 'html';
    const amostra = importParsed.patches.slice(0, 30).map(function (p) {
      return '<div class="imp-linha"><span>' + esc(p.nome || '(sem nome)') + '</span>' +
        '<span class="muted">' + esc(rotulo(G.ORIGENS, p.origem)) + '</span></div>';
    }).join('');
    prev.innerHTML = '<strong>🔖 ' + importParsed.totalLinks + ' links</strong> em ' +
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

  // chave única de um jogo/patch (mesma lógica do dedup)
  function chaveJogo(g) {
    const app = g.steam_appid || G.extrairAppId(g.url_origem);
    if (app) return 'steam:' + app;
    return G.normalizarUrlChave(g.url_origem) || ('id:' + (g.id || Math.random()));
  }

  // mescla uma lista de patches DE UMA VEZ (1 leitura + 1 escrita no storage).
  // Antes era 1 upsert por item (O(n²) no storage) → travava com centenas de jogos.
  async function mesclarEmLote(patches) {
    const atual = await G.carregarJogos();
    const idx = {};
    atual.forEach(function (g) { idx[chaveJogo(g)] = g; });
    let criados = 0, mesclados = 0;
    patches.forEach(function (p) {
      const k = chaveJogo(p);
      const ex = idx[k];
      if (ex) {
        ex.genero = G.uniao(ex.genero, G.toArray(p.genero));
        ex.estilo_visual = G.uniao(ex.estilo_visual, G.toArray(p.estilo_visual));
        ex.vibe = G.uniao(ex.vibe, G.toArray(p.vibe));
        if (!ex.url_video && p.url_video) ex.url_video = p.url_video;
        if (!ex.notas && p.notas) ex.notas = p.notas;
        mesclados++;
      } else {
        const novo = G.novoJogo(p);
        atual.push(novo); idx[k] = novo; criados++;
      }
    });
    await G.salvarJogos(atual);
    jogos = atual;
    return { criados: criados, mesclados: mesclados };
  }

  async function executarImportacao() {
    $('#btn-fazer-import').disabled = true;
    try {
      if (importTipo === 'json') { await importarJson(importJson); }
      else if (importParsed && importParsed.patches.length) {
        const res = await mesclarEmLote(importParsed.patches);
        render(); atualizarFiltros();
        $('#imp-status').textContent = res.criados + ' novos, ' + res.mesclados + ' já existiam (' +
          resumoPorOrigem(importParsed.porOrigem) + ').';
        toast('Importados: ' + res.criados + ' — validando tudo (capa, tags, lançamento)…');
        await enriquecerTudo(); // valida Steam/tags/capas de uma vez — NÃO mexe no tempo
      }
    } finally {
      $('#btn-fazer-import').disabled = false;
    }
  }

  // aplica um backup JSON (mescla; o backup atualiza o jogo existente)
  async function aplicarBackup(dados, substituir) {
    const lista = Array.isArray(dados) ? dados : ((dados && dados.jogos) || []);
    const importados = lista.map(G.normalizarJogo);
    if (!importados.length) return { vazio: true };
    if (substituir) { await G.salvarJogos(importados); jogos = importados; return { novos: importados.length, atualizados: 0 }; }
    const atual = await G.carregarJogos();
    const idx = {};
    atual.forEach(function (g) { idx[chaveJogo(g)] = g; });
    let novos = 0, atualizados = 0;
    importados.forEach(function (imp) {
      const k = chaveJogo(imp); const ex = idx[k];
      if (ex) { const keepId = ex.id; Object.assign(ex, imp); ex.id = keepId; atualizados++; }
      else { atual.push(imp); idx[k] = imp; novos++; }
    });
    await G.salvarJogos(atual); jogos = atual;
    return { novos: novos, atualizados: atualizados };
  }

  async function importarJson(dados) {
    const r = await aplicarBackup(dados, false);
    if (r.vazio) return toast('Nenhum jogo no JSON.', true);
    if (dados && dados.config) { config = Object.assign({}, G.DEFAULT_SETTINGS, dados.config); await G.salvarConfig(config); }
    jogos = await G.carregarJogos(); render(); atualizarFiltros();
    $('#imp-status').textContent = 'JSON: ' + r.novos + ' novos, ' + r.atualizados + ' atualizados.';
    toast('Importado do JSON (' + jogos.length + ' jogos).');
  }

  /* ---- lista de tempos "Nome - Xh" ---- */
  // procura o tempo de UM nome: 1º na sua lista importada, 2º na lista EMBUTIDA
  // do projeto (tempos_dados.js). null se não achar em nenhuma.
  function tempoDaLista(nome) { return G.casarTempoTudo(nome, temposSalvos); }

  // preenche o tempo dos jogos que ainda não têm, usando a lista importada +
  // a EMBUTIDA no projeto. Usado ao abrir o gerenciador.
  function aplicarTemposSalvos() {
    let n = 0;
    jogos.forEach(function (j) {
      if (j.tempo_para_zerar != null || !j.nome) return;
      const h = tempoDaLista(j.nome);
      if (h != null) { j.tempo_para_zerar = h; j.hltb_check = true; n++; }
    });
    if (n) { G.salvarJogos(jogos); render(); atualizarFiltros(); }
    return n;
  }

  const dorme = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  let errosImport = [];

  // roda as 3 etapas em sequência e no fim apresenta os erros
  async function enriquecerTudo() {
    revalidandoPrecos = false; // evita bater na Steam em paralelo
    errosImport = [];
    $('#imp-erros').hidden = true;
    await enriquecerSteamCompleto();
    if (!enriquecendo && errosImport.some(function (e) { return e.bloqueio; })) { mostrarErros(); return; }
    await enriquecerCapas();
    // NÃO busca tempo (HLTB) para todos — isso só acontece ao favoritar um jogo novo
    // ou pelo botão do card. Para preencher em massa, use a lista de tempos ou o Python.
    mostrarErros();
  }

  // Enriquece SÓ um jogo novo: tags populares da Steam + tempo (HLTB).
  // Usado ao FAVORITAR/adicionar um jogo novo (não roda para todos).
  async function buscarTempoNovo(id) {
    const j = jogos.find(function (x) { return x.id === id; });
    if (!j) return;
    // tags da Steam (marcadores + categorias)
    if (j.steam_appid && !j.steam_tags_ok) {
      const rt = await pedir({ tipo: 'steamtags', appid: j.steam_appid });
      if (rt && rt.ok && rt.tags) {
        const m = G.mapearTagsSteam(rt.tags);
        j.genero = G.uniao(j.genero, m.genero);
        j.estilo_visual = G.uniao(j.estilo_visual, m.estilo_visual);
        j.vibe = G.uniao(j.vibe, m.vibe);
        j.marcadores = G.uniao(j.marcadores, rt.tags);
        j.steam_tags_ok = true;
      }
    }
    // tempo: primeiro tenta a SUA lista salva; senão HowLongToBeat
    if (j.tempo_para_zerar == null && j.nome) {
      const daLista = tempoDaLista(j.nome);
      if (daLista != null) { j.tempo_para_zerar = daLista; j.hltb_check = true; }
      else {
        const r = await pedir({ tipo: 'hltb', nome: j.nome });
        if (r && r.ok && r.horas != null) { j.tempo_para_zerar = r.horas; j.hltb_check = true; }
      }
    }
    await G.salvarJogos(jogos);
    render(); atualizarFiltros();
  }

  function mostrarErros() {
    const box = $('#imp-erros');
    if (!errosImport.length) { box.hidden = true; return; }
    const linhas = errosImport.slice(0, 200).map(function (e) {
      return '<div class="imp-linha"><span>' + esc(e.nome) + '</span>' +
        '<span class="muted">' + esc(e.etapa + ': ' + e.motivo) + '</span></div>';
    }).join('');
    box.innerHTML = '<strong>⚠️ ' + errosImport.length + ' não validaram:</strong>' + linhas +
      (errosImport.length > 200 ? '<div class="muted pequeno">…e mais ' + (errosImport.length - 200) + '.</div>' : '');
    box.hidden = false;
  }

  // Executor de lote com progresso + backoff/retry em rate limit + coleta de erros.
  // `fazer(j)` devolve 'ok' | 'skip' | 'rate' | { res, motivo }.
  async function processarLote(alvos, fazer, rotulo, espera) {
    const box = $('#imp-progresso'); box.hidden = false;
    if (!alvos.length) { $('#imp-progresso-txt').textContent = rotulo + ': nada pendente.'; $('#imp-barra').style.width = '100%'; return; }
    espera = espera || 1500;
    enriquecendo = true;
    let i = 0, rate = 0, ok = 0;
    while (i < alvos.length) {
      if (!enriquecendo) { $('#imp-progresso-txt').textContent = 'Parado em ' + i + '/' + alvos.length + '.'; break; }
      $('#imp-progresso-txt').textContent = rotulo + ' ' + (i + 1) + '/' + alvos.length + '…';
      $('#imp-barra').style.width = Math.round((i / alvos.length) * 100) + '%';
      const out = await fazer(alvos[i]);
      const res = typeof out === 'string' ? out : out.res;
      if (res === 'rate') {
        rate++;
        if (rate > 3) {
          errosImport.push({ nome: '(' + (alvos.length - i) + ' jogos)', etapa: rotulo, motivo: 'Steam bloqueou temporariamente — pendentes; reimporte em alguns minutos', bloqueio: true });
          $('#imp-progresso-txt').textContent = 'Steam bloqueou. Pausado em ' + i + '/' + alvos.length + '.';
          break;
        }
        await dorme(6000); continue;
      }
      if (out && out.motivo) errosImport.push({ nome: alvos[i].nome || '(sem nome)', etapa: rotulo, motivo: out.motivo });
      rate = 0; if (res === 'ok') ok++;
      i++;
      if (i % 10 === 0) { await G.salvarJogos(jogos); render(); }
      await dorme(espera);
    }
    await G.salvarJogos(jogos); render(); atualizarFiltros();
    if (enriquecendo && i >= alvos.length) {
      $('#imp-barra').style.width = '100%';
      $('#imp-progresso-txt').textContent = rotulo + ': ' + ok + ' de ' + alvos.length + ' ok.';
    }
    enriquecendo = false;
  }

  // Validação Steam COMPLETA por jogo: appdetails (nome, capa, preço, gênero,
  // lançamento) + tags populares da loja (marcadores/pixel/retrô) NA MESMA
  // passada — assim os jogos processados antes de um bloqueio saem completos
  // (com tags), em vez de todos validarem e nenhum receber tags.
  async function enriquecerSteamCompleto() {
    const alvos = jogos.filter(function (j) { return j.steam_appid && !j.edited_manually && (!j.steam_validado || !j.steam_tags_ok); });
    await processarLote(alvos, async function (j) {
      // 1) appdetails
      if (!j.steam_validado) {
        const r = await pedir({ tipo: 'steam', appid: j.steam_appid });
        if (r && r.erro === 'rate') return 'rate';
        if (r && r.ok) {
          const p = G.dadosParaPatch(r.dados);
          if (p.nome) j.nome = p.nome;
          if (p.capa_url && !j.capa_url) j.capa_url = p.capa_url;
          if (p.preco_atual != null) j.preco_atual = p.preco_atual;
          if (p.desconto_pct != null) j.desconto_pct = p.desconto_pct;
          if (p.status_lancamento) j.status_lancamento = p.status_lancamento;
          if (p.ano_alvo) j.ano_alvo = p.ano_alvo;
          if (p.data_prevista) j.data_prevista = p.data_prevista;
          if (p.genero && p.genero.length) j.genero = G.uniao(j.genero, p.genero);
          j.steam_validado = true; j.preco_check = new Date().toISOString();
        } else {
          j.steam_validado = true;
          errosImport.push({ nome: j.nome || '(sem nome)', etapa: 'Steam', motivo: (r && r.msg) || 'não validou' });
        }
        await dorme(600); // respiro entre as 2 chamadas do mesmo jogo
      }
      // 2) tags da loja (marcadores)
      if (!j.steam_tags_ok) {
        const rt = await pedir({ tipo: 'steamtags', appid: j.steam_appid });
        if (rt && rt.erro === 'rate') return 'rate'; // reprocessa o item (só as tags faltam)
        if (rt && rt.ok) {
          const m = G.mapearTagsSteam(rt.tags);
          j.genero = G.uniao(j.genero, m.genero);
          j.estilo_visual = G.uniao(j.estilo_visual, m.estilo_visual);
          j.vibe = G.uniao(j.vibe, m.vibe);
          j.marcadores = G.uniao(j.marcadores, rt.tags);
        }
        j.steam_tags_ok = true;
      }
      return 'ok';
    }, 'Validando Steam (dados + tags)', 1500);
  }

  // 3) Capas das OUTRAS fontes: YouTube (playlist via oEmbed), itch, Nintendo,
  //    Google Play, Kickstarter, sites de dev — via og:image / estrutura do site.
  async function enriquecerCapas() {
    const alvos = jogos.filter(function (j) { return !j.capa_url && j.url_origem && j.origem !== 'google'; });
    await processarLote(alvos, async function (j) {
      let capa = '';
      if (j.origem === 'youtube' || G.ehYouTube(j.url_origem)) {
        const r = await pedir({ tipo: 'youtube', url: j.url_video || j.url_origem });
        if (r && r.ok && r.dados && r.dados.capa_url) capa = r.dados.capa_url;
      } else {
        const r = await pedir({ tipo: 'og', url: j.url_origem });
        if (r && r.ok && r.dados && r.dados.capa_url) capa = r.dados.capa_url;
      }
      if (capa) { j.capa_url = capa; return 'ok'; }
      return { res: 'skip', motivo: 'sem capa automática' };
    }, 'Buscando capas', 900);
  }

  /* =========================================================================
   * BACKUP (JSON)
   * ======================================================================= */
  // baixa um conteúdo como arquivo
  function baixarArquivo(conteudo, nomeArq, mime) {
    const blob = new Blob([conteudo], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArq;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportarJson() {
    const dados = { versao: 1, exportadoEm: new Date().toISOString(), config: config, jogos: jogos };
    baixarArquivo(JSON.stringify(dados, null, 2),
      'jogos-favoritos-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
    $('#backup-status').textContent = 'Exportado ' + jogos.length + ' jogos (JSON).';
  }

  // Exporta SÓ os jogos já lançados e SEM tempo para zerar cadastrado.
  // Backup-shaped (jogos: [...]) → compatível com o script Python e com
  // "Restaurar de um JSON (Mesclar)", que casa por AppID/URL e atualiza só esses.
  function exportarTemposPendentes() {
    const pend = jogos.filter(function (j) {
      const semTempo = (j.tempo_para_zerar == null || j.tempo_para_zerar === '');
      return semTempo && G.statusEfetivo(j) === 'lancado';
    });
    if (!pend.length) {
      $('#backup-status').textContent = 'Nenhum jogo lançado está sem tempo — nada pendente. 🎉';
      return;
    }
    const dados = {
      versao: 1, exportadoEm: new Date().toISOString(),
      pendentes: true, tipo: 'tempos-pendentes', jogos: pend
    };
    baixarArquivo(JSON.stringify(dados, null, 2),
      'tempos-pendentes-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
    $('#backup-status').textContent = pend.length + ' jogo(s) pendente(s) exportado(s). ' +
      'Preencha o tempo e restaure com “Mesclar”.';
  }

  async function restaurarJson(e) {
    const input = e.target;
    const f = input.files && input.files[0]; if (!f) return;
    let dados;
    try { dados = JSON.parse(await lerArquivo(f)); } catch (err) { input.value = ''; return toast('JSON inválido.', true); }
    const substituir = !$('#restaurar-mesclar').checked;
    if (substituir && !confirm('Substituir TODOS os jogos atuais por este backup?')) { input.value = ''; return; }
    const r = await aplicarBackup(dados, substituir);
    if (r.vazio) { input.value = ''; return toast('Nenhum jogo encontrado no arquivo.', true); }
    if (dados.config) { config = Object.assign({}, G.DEFAULT_SETTINGS, dados.config); await G.salvarConfig(config); }
    jogos = await G.carregarJogos();
    render(); atualizarFiltros();
    input.value = '';
    $('#backup-status').textContent = substituir
      ? ('Substituído por ' + r.novos + ' jogos.')
      : ('Restaurado: ' + r.novos + ' novos, ' + r.atualizados + ' atualizados.');
    toast('Backup restaurado (' + jogos.length + ' jogos).');
  }

  /* =========================================================================
   * CONFIG
   * ======================================================================= */
  async function abrirConfig() {
    $('#cfg-zera').value = config.zeraRapidoLimite;
    $('#cfg-lang').value = config.steamLang;
    $('#cfg-cc').value = config.steamCc;
    abrirModal('#modal-config');
  }
  async function salvarConfigUI() {
    config.zeraRapidoLimite = Math.max(1, parseInt($('#cfg-zera').value, 10) || 6);
    config.steamLang = $('#cfg-lang').value.trim() || 'portuguese';
    config.steamCc = $('#cfg-cc').value.trim() || 'br';
    await G.salvarConfig(config);
    render();
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
    $('#f-promo').addEventListener('change', function () { filtros.promo = this.checked; limparVisaoAtiva(); render(); });
    $('#f-zerado').addEventListener('click', function (e) {
      const c = e.target.closest('.chip'); if (!c) return;
      const alvo = c.dataset.z === 'sim' ? true : false;
      filtros.zerado = filtros.zerado === alvo ? null : alvo; // clica de novo = desliga
      sincronizarZerado(); limparVisaoAtiva(); render();
    });
    $('#btn-limpar').addEventListener('click', limparFiltros);

    $('#ed-salvar').addEventListener('click', salvarEdicao);
    $('#ed-revalidar').addEventListener('click', revalidarSteam);
    $('#ed-hltb').addEventListener('click', async function () {
      const nome = $('#ed-nome').value.trim(); if (!nome) return;
      // 1) lista de tempos (sua importada + a embutida no projeto) — instantâneo
      const daLista = tempoDaLista(nome);
      if (daLista != null) { $('#ed-tempo').value = daLista; return toast('⏱ ' + daLista + 'h preenchido (lista de tempos).'); }
      // 2) HowLongToBeat ao vivo (melhor esforço — pode ser bloqueado pelo site)
      toast('Consultando HowLongToBeat…');
      const r = await pedir({ tipo: 'hltb', nome: nome });
      if (r && r.ok && r.horas != null) {
        $('#ed-tempo').value = r.horas;
        toast('⏱ ' + r.horas + 'h preenchido (HowLongToBeat).');
      } else {
        // NÃO abre o site — preenche manualmente e, se quiser, o Python resolve em massa
        toast('Não encontrei o tempo deste jogo na lista nem no HLTB. Preencha à mão no campo Tempo.', true);
      }
    });
    $('#ed-google-img').addEventListener('click', function () {
      const nome = $('#ed-nome').value.trim();
      window.open('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(nome + ' game capa'), '_blank', 'noopener');
    });
    $('#ed-buscar-capa').addEventListener('click', buscarCapaJogoAtual);
    $('#ed-status').addEventListener('change', function () {
      // se marcar "lançado", esconde relevância de data (apenas UX leve)
    });

    $('#btn-precos').addEventListener('click', function () { revalidarPrecos(true); });
    $('#btn-importar').addEventListener('click', function () { $('#imp-status').textContent = ''; abrirModal('#modal-importar'); });
    $('#arquivo-bookmarks').addEventListener('change', arquivoBookmarksSelecionado);
    $('#btn-fazer-import').addEventListener('click', executarImportacao);
    $('#imp-cancelar').addEventListener('click', function () { enriquecendo = false; });

    $('#btn-backup').addEventListener('click', function () { $('#backup-status').textContent = ''; abrirModal('#modal-backup'); });
    $('#btn-exportar-json').addEventListener('click', exportarJson);
    $('#btn-exportar-pendentes').addEventListener('click', exportarTemposPendentes);
    $('#arquivo-json').addEventListener('change', restaurarJson);

    $('#btn-config').addEventListener('click', abrirConfig);
    ['#cfg-zera', '#cfg-lang', '#cfg-cc'].forEach(function (s) { $(s).addEventListener('change', salvarConfigUI); });
    $('#btn-limpar-tudo').addEventListener('click', limparTudo);

    document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', fecharModais); });
    document.querySelectorAll('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) fecharModais(); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharModais(); });
  }

  init();
})();
