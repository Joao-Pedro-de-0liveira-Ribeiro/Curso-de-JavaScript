#!/usr/bin/env python3
"""
Preenche o campo "tempo_para_zerar" de cada jogo no JSON do catálogo
com o tempo de "Main Story" (história principal) do HowLongToBeat,
com casas decimais (ex: 11.9, 51.68).

Instalação:
    pip install howlongtobeatpy --break-system-packages

Uso (o jeito fácil):
    1. Na extensão: ⇅ Backup → "Exportar toda a base (JSON)".
       (baixa um "jogos-favoritos-AAAA-MM-DD.json" na sua pasta de Downloads)
    2. Rode:  python3 preencher_tempos_catalogo.py
       (acha sozinho o JSON mais recente na sua pasta de Downloads)
    3. Na extensão: ⇅ Backup → "Restaurar de um JSON" (com "Mesclar" marcado)
       e escolha o "*-com-tempos.json" gerado ao lado do original.

Também dá para passar o caminho do arquivo à mão:
    python3 preencher_tempos_catalogo.py /caminho/do/jogos-favoritos-....json

Lê:   o arquivo mais recente "jogos-favoritos-*.json" (ou "tempos-pendentes-*.json")
      da sua pasta de Downloads (~/Downloads, ~/Transferências) ou da pasta atual.
Gera: <nome-do-arquivo>-com-tempos.json (mesma pasta) -> não sobrescreve o original.

O que este script faz de esperto:
  - Só busca jogos com "status_lancamento": "lancado" - pula
    "indefinido" e "nao_lancado" (não faz sentido procurar tempo
    de conclusão de jogo que ainda não saiu).
  - Filtro de limpeza bem amplo: tira "- YouTube", "- Pesquisa Google",
    "/ Twitter", "— Kickstarter", "— Game Jolt", "Apps Android no",
    prefixos tipo "Let's Play :", "Oficina Steam::", e tenta separar
    títulos com " | " ou "::" testando os dois lados.
  - Cada jogo testa até 8 variantes de nome antes de desistir.
  - VALIDAÇÃO (desligada por padrão - VALIDAR_JA_PREENCHIDOS): se ligar,
    também re-busca os que JÁ têm tempo_para_zerar e sinaliza divergências
    num relatório separado, sem sobrescrever nada.

Regras:
  - Pula jogos com "edited_manually": true sempre (nunca mexe).
  - Delay aleatório entre buscas pra não parecer bot.
  - Salva o progresso a cada jogo preenchido (jogos só validados,
    sem mudança, não geram escrita no JSON).
"""

import asyncio
import json
import random
import re
import ssl
import sys
from pathlib import Path

# ---------- Correção de SSL (Python 3.13+) ----------
_criar_contexto_padrao_original = ssl.create_default_context


def _criar_contexto_padrao_sem_x509_strict(*args, **kwargs):
    contexto = _criar_contexto_padrao_original(*args, **kwargs)
    contexto.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return contexto


ssl.create_default_context = _criar_contexto_padrao_sem_x509_strict

try:
    from howlongtobeatpy import HowLongToBeat
except ImportError:
    sys.exit("Instale a dependência primeiro:\n"
             "    pip install howlongtobeatpy --break-system-packages")

# ---------- Configuração ----------
# Aceita como entrada tanto o backup completo ("jogos-favoritos-*.json")
# quanto o export de pendentes ("tempos-pendentes-*.json").
PADROES_ENTRADA = ("jogos-favoritos-*.json", "tempos-pendentes-*.json")

ENTRADA = None
SAIDA = None
RELATORIO_PENDENTES = None
RELATORIO_VALIDACAO = None


def _pastas_candidatas() -> list:
    """Pastas onde procurar o JSON, em ordem de preferência. Funciona em
    qualquer máquina: ~/Downloads, ~/Transferências, ~/Descargas e a atual."""
    pastas = []
    home = Path.home()
    for nome in ("Downloads", "Transferências", "Transferencias", "Descargas", "Download"):
        p = home / nome
        if p.is_dir():
            pastas.append(p)
    pastas.append(Path.cwd())
    # remove duplicados preservando ordem
    vistos, saida = set(), []
    for p in pastas:
        if p not in vistos:
            vistos.add(p)
            saida.append(p)
    return saida


def localizar_arquivo_entrada() -> Path:
    # 1) caminho passado na linha de comando (arquivo ou pasta)
    if len(sys.argv) > 1:
        alvo = Path(sys.argv[1]).expanduser()
        if alvo.is_file():
            return alvo
        if alvo.is_dir():
            pastas = [alvo]
        else:
            sys.exit(f"Caminho não encontrado: {alvo}")
    else:
        pastas = _pastas_candidatas()

    candidatos = []
    for pasta in pastas:
        for padrao in PADROES_ENTRADA:
            candidatos += [
                p for p in pasta.glob(padrao)
                if "-com-tempos" not in p.stem and "-validacao" not in p.stem
            ]

    if not candidatos:
        locais = " , ".join(str(p) for p in pastas)
        print("Nenhum arquivo 'jogos-favoritos-*.json' ou 'tempos-pendentes-*.json' encontrado em:")
        print(f"    {locais}")
        print("\nExporte o JSON na extensão (⇅ Backup) e rode de novo, ou passe o caminho:")
        print("    python3 preencher_tempos_catalogo.py /caminho/do/arquivo.json")
        sys.exit(1)

    escolhido = max(candidatos, key=lambda p: p.stat().st_mtime)
    if len(candidatos) > 1:
        print(f"[aviso] {len(candidatos)} arquivos possíveis:")
        for c in sorted(candidatos, key=lambda p: p.stat().st_mtime, reverse=True):
            marca = "  <- usando este (mais recente)" if c == escolhido else ""
            print(f"    - {c}{marca}")
        print()
    return escolhido


PULAR_EDITADOS_MANUALMENTE = True   # nunca mexe em edited_manually: true
VALIDAR_JA_PREENCHIDOS = False      # True = também re-checa quem já tem tempo_para_zerar
SO_JOGOS_LANCADOS = True            # só busca jogos com status_lancamento == "lancado"

DELAY_MIN = 4.0
DELAY_MAX = 8.0
SIMILARIDADE_ACEITAVEL = 0.4     # abaixo disso: quase certamente errado
SIMILARIDADE_REVISAO = 0.85      # abaixo disso: entra em "vale conferir" (não é erro certo)
DIFERENCA_HORAS_SUSPEITA = 1.0   # + 25% do valor salvo, o que for maior -> suspeito na validação
CASE_SENSITIVE = False
MAX_TENTATIVAS = 3
BACKOFF_BASE = 5

# ---------- Limpeza de nome ----------
PREFIXOS_PARA_REMOVER = [
    r"^\s*let'?s\s*play\s*:?\s*",
    r"^\s*gameplay\s*:?\s*",
    r"^\s*detonado\s*:?\s*",
    r"^\s*review\s*:?\s*",
    r"^\s*trailer\s*:?\s*",
    r"^\s*oficina\s+steam::\s*",
    r"^\s*steam\s+workshop::\s*",
    r"^\s*steam\s+greenlight::\s*",
]

SUFIXOS_PARA_REMOVER = [
    r"\s*-\s*youtube\s*$",
    r"\s*\|\s*youtube\s*$",
    r"\s+on\s+steam\s*$",
    r"\s*-\s*steam\s*$",
    r"[-–—]\s*pesquisa\s+google\s*$",
    r"[-–—]\s*google\s+search\s*$",
    r"[-–—]\s*apps?\s+android\s+no\s*$",
    r"\s*/\s*twitter\s*$",
    r"[-–—]\s*kickstarter\s*$",
    r"[-–—]\s*game\s*jolt\s*$",
]

MARCADORES_DE_CORTE = [
    r"#\d+",
    r"\bgameplay\b", r"\bdetonado\b", r"\bzerando\b", r"\bzerei\b",
    r"\breview\b", r"\banálise\b", r"\banalise\b",
    r"\bdublado\b", r"\blegendado\b", r"\bwalkthrough\b",
    r"\blet'?s\s*play\b", r"\bplaythrough\b", r"\btrailer\b",
    r"\boficial\b", r"\bfull\s*game\b",
    r"\bep(?:is[oó]dio)?\.?\s*\d+\b", r"\bparte\s*\d+\b", r"\bpart\s*\d+\b",
    r"\bo\s+come[çc]o\b", r"\bin[ií]cio\b", r"\bfinal\b", r"\bprimeira\s+gameplay\b",
]

PALAVRAS_RUIDO_BUSCA = [
    "baixar", "download", "jogar", "jogo", "game", "pc", "apk", "rom",
]

# Abreviações comuns de série -> nome completo. Testado como PREFIXO do
# nome já limpo (ex: "RE9 chegou, BORA!" -> "Resident Evil 9 chegou, BORA!").
ABREVIACOES_JOGOS = [
    (r"^\s*re\s*(\d+)\b", "Resident Evil"),
    (r"^\s*gow\s*(\d*)\b", "God of War"),
    (r"^\s*tlou\s*(\d*)\b", "The Last of Us"),
    (r"^\s*mgs\s*(\d*)\b", "Metal Gear Solid"),
    (r"^\s*gta\s*(\d*)\b", "Grand Theft Auto"),
    (r"^\s*ff\s*(\d+)\b", "Final Fantasy"),
    (r"^\s*botw\b", "Breath of the Wild"),
    (r"^\s*totk\b", "Tears of the Kingdom"),
]


def _aplicar_padroes(titulo: str, padroes: list) -> str:
    t = titulo.strip()
    mudou = True
    while mudou:
        mudou = False
        for padrao in padroes:
            novo = re.sub(padrao, "", t, flags=re.IGNORECASE).strip()
            if novo != t:
                t = novo
                mudou = True
    return t


def limpar_nome(titulo: str) -> str:
    t = _aplicar_padroes(titulo, PREFIXOS_PARA_REMOVER)
    t = _aplicar_padroes(t, SUFIXOS_PARA_REMOVER)
    return t


def cortar_no_primeiro_marcador(titulo: str) -> str:
    menor_pos = len(titulo)
    for padrao in MARCADORES_DE_CORTE:
        m = re.search(padrao, titulo, flags=re.IGNORECASE)
        if m and m.start() < menor_pos:
            menor_pos = m.start()
    cortado = titulo[:menor_pos].strip(" -|:#")
    return cortado if len(cortado) >= 3 else titulo


def cortar_no_primeiro_traco(titulo: str) -> str:
    """Último recurso: corta no primeiro ' - ' solto. Pega casos tipo
    'Bloodborne - 10 anos atrasado' ou 'Dark Souls - Matando a Saudade',
    onde tudo depois do traço é só comentário, não faz parte do nome."""
    m = re.search(r"\s[-–—]\s", titulo)
    if not m:
        return titulo
    cortado = titulo[:m.start()].strip()
    return cortado if len(cortado) >= 3 else titulo


def expandir_abreviacao(titulo: str):
    """Se o título começa com uma abreviação conhecida (RE9, GOW, TLOU...),
    devolve (nome_curto_expandido, titulo_completo_expandido). Senão, None."""
    for padrao, nome_completo in ABREVIACOES_JOGOS:
        m = re.match(padrao, titulo, flags=re.IGNORECASE)
        if m:
            numero = m.group(1) if m.groups() and m.group(1) else ""
            nome_curto = f"{nome_completo} {numero}".strip()
            resto = titulo[m.end():].strip()
            completo = f"{nome_curto} {resto}".strip() if resto else nome_curto
            completo = re.sub(r"\s+", " ", completo)
            return nome_curto, completo
    return None


def gerar_candidatos(nome_original: str) -> list:
    """Gera até 8 variantes do nome pra tentar na busca, da mais
    conservadora pra mais agressiva. Sem duplicados."""
    candidatos = []

    def add(c):
        c = c.strip()
        if len(c) >= 2 and c not in candidatos:
            candidatos.append(c)

    limpo = limpar_nome(nome_original)
    add(limpo)

    # Abreviação conhecida (RE9, GOW, TLOU...) tem prioridade alta -
    # é o tipo de correção que mais aumenta a chance de achar certo.
    abrev = expandir_abreviacao(limpo)
    if abrev:
        nome_curto, completo = abrev
        add(nome_curto)
        add(cortar_no_primeiro_marcador(completo))

    cortado = cortar_no_primeiro_marcador(limpo)
    add(cortado)

    sem_pontuacao = re.sub(r"[:;]", " ", limpo)
    sem_pontuacao = re.sub(r"\s+", " ", sem_pontuacao).strip()
    add(sem_pontuacao)

    if " | " in limpo:
        antes, depois = limpo.split(" | ", 1)
        add(antes)
        add(depois)

    if "::" in limpo:
        add(limpo.split("::")[-1])

    # Título inteiro em minúsculas = geralmente é texto de busca digitado
    # (ex: "baixar to the moon", "earthbound"), não o nome oficial. Tira
    # palavras de ruído comuns desse tipo de busca.
    if limpo == limpo.lower() and limpo != limpo.upper():
        palavras = limpo.split()
        filtradas = [p for p in palavras if p.strip(".,!?") not in PALAVRAS_RUIDO_BUSCA]
        sem_ruido = " ".join(filtradas).strip()
        if sem_ruido and sem_ruido != limpo:
            add(sem_ruido)

    # Último recurso: corta no primeiro " - " solto (pega "Bloodborne -
    # 10 anos atrasado" -> "Bloodborne"). Fica por último de propósito -
    # só é tentado se os candidatos mais conservadores não bastarem.
    add(cortar_no_primeiro_traco(limpo))

    return candidatos[:8]


async def _buscar(nome_para_busca: str):
    return await HowLongToBeat(0.0).async_search(
        nome_para_busca, similarity_case_sensitive=CASE_SENSITIVE
    )


async def buscar_main_story(nome_original: str) -> dict:
    candidatos_nome = gerar_candidatos(nome_original)

    for tentativa in range(1, MAX_TENTATIVAS + 1):
        try:
            melhor_geral = None
            nome_usado = None

            for candidato in candidatos_nome:
                resultados = await _buscar(candidato)
                if resultados:
                    melhor = max(resultados, key=lambda r: r.similarity)
                    if melhor_geral is None or melhor.similarity > melhor_geral.similarity:
                        melhor_geral = melhor
                        nome_usado = candidato
                    if melhor_geral.similarity >= SIMILARIDADE_REVISAO:
                        break

            if melhor_geral is None:
                return {"horas": None, "motivo": "sem resultados no HLTB"}

            baixa_confianca = melhor_geral.similarity < SIMILARIDADE_ACEITAVEL
            vale_revisar = melhor_geral.similarity < SIMILARIDADE_REVISAO

            if melhor_geral.main_story is None:
                return {
                    "horas": None,
                    "nome_hltb": melhor_geral.game_name,
                    "similaridade": round(melhor_geral.similarity, 2),
                    "baixa_confianca": baixa_confianca,
                    "vale_revisar": vale_revisar,
                    "motivo": "encontrado mas sem tempo de main story cadastrado",
                }

            return {
                "horas": melhor_geral.main_story,
                "nome_hltb": melhor_geral.game_name,
                "similaridade": round(melhor_geral.similarity, 2),
                "baixa_confianca": baixa_confianca,
                "vale_revisar": vale_revisar,
                "nome_usado_na_busca": nome_usado,
            }

        except Exception as e:
            espera = BACKOFF_BASE * (2 ** (tentativa - 1))
            print(f"  [ERRO] '{nome_original}' (tentativa {tentativa}/{MAX_TENTATIVAS}): {e}")
            if tentativa < MAX_TENTATIVAS:
                print(f"  Aguardando {espera}s antes de tentar de novo...")
                await asyncio.sleep(espera)
            else:
                return {"horas": None, "motivo": f"falhou após {MAX_TENTATIVAS} tentativas: {e}"}


async def main():
    global ENTRADA, SAIDA, RELATORIO_PENDENTES, RELATORIO_VALIDACAO

    print(f"[diagnóstico] Python {sys.version.split()[0]}")
    _ctx_teste = ssl.create_default_context()
    _strict_ativo = bool(_ctx_teste.verify_flags & ssl.VERIFY_X509_STRICT)
    print(f"[diagnóstico] patch de SSL - VERIFY_X509_STRICT ainda ativo? {_strict_ativo}")

    ENTRADA = localizar_arquivo_entrada()
    SAIDA = ENTRADA.with_name(ENTRADA.stem + "-com-tempos.json")
    RELATORIO_PENDENTES = ENTRADA.with_name(ENTRADA.stem + "-pendentes.txt")
    RELATORIO_VALIDACAO = ENTRADA.with_name(ENTRADA.stem + "-validacao.txt")
    print(f"[diagnóstico] usando como entrada: {ENTRADA}\n")

    with open(ENTRADA, "r", encoding="utf-8") as f:
        dados = json.load(f)

    jogos = dados["jogos"]

    a_preencher = []   # tempo_para_zerar == null
    a_validar = []     # já tem valor, não é manual, vamos re-checar

    for jogo in jogos:
        if PULAR_EDITADOS_MANUALMENTE and jogo.get("edited_manually"):
            continue
        if SO_JOGOS_LANCADOS and jogo.get("status_lancamento") != "lancado":
            continue
        if jogo.get("tempo_para_zerar") is None:
            a_preencher.append(jogo)
        elif VALIDAR_JA_PREENCHIDOS:
            a_validar.append(jogo)

    total = len(a_preencher) + len(a_validar)
    print(f"{len(jogos)} jogos no total | filtro: status_lancamento == 'lancado' | "
          f"{len(a_preencher)} para preencher | {len(a_validar)} para validar\n")

    pendentes = []
    suspeitos_validacao = []
    contador = 0
    cache_resultados = {}  # nome -> resultado, evita buscar o mesmo nome 2x (tem duplicados no arquivo)

    # ---- Fase 1: preencher os que estão null ----
    for jogo in a_preencher:
        contador += 1
        nome = jogo["nome"]
        print(f"[preencher {contador}/{total}] {nome}")

        if nome in cache_resultados:
            resultado = cache_resultados[nome]
            print("  -> (repetido no arquivo, reaproveitando busca anterior)")
            fez_busca_de_verdade = False
        else:
            resultado = await buscar_main_story(nome)
            cache_resultados[nome] = resultado
            fez_busca_de_verdade = True

        if resultado["horas"] is not None:
            jogo["tempo_para_zerar"] = resultado["horas"]
            aviso = "  ⚠️ baixa confiança" if resultado.get("baixa_confianca") else (
                "  (conferir)" if resultado.get("vale_revisar") else "")
            print(
                f"  -> {resultado['nome_hltb']}: {resultado['horas']}h "
                f"(similaridade {resultado['similaridade']}, "
                f"busquei por: '{resultado['nome_usado_na_busca']}'){aviso}"
            )
            if resultado.get("vale_revisar"):
                pendentes.append(f"{nome}  =>  {resultado['nome_hltb']} "
                                 f"({resultado['horas']}h, similaridade {resultado['similaridade']})")
        else:
            print(f"  -> {resultado.get('motivo', 'não encontrado')}")
            pendentes.append(f"{nome}  =>  {resultado.get('motivo', 'não encontrado')}")

        with open(SAIDA, "w", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=False, indent=2)

        if contador < total and fez_busca_de_verdade:
            await asyncio.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

    # ---- Fase 2: validar os que já têm valor (não sobrescreve) ----
    for jogo in a_validar:
        contador += 1
        nome = jogo["nome"]
        valor_atual = jogo["tempo_para_zerar"]
        print(f"[validar {contador}/{total}] {nome} (salvo: {valor_atual}h)")

        if nome in cache_resultados:
            resultado = cache_resultados[nome]
            print("  -> (repetido no arquivo, reaproveitando busca anterior)")
            fez_busca_de_verdade = False
        else:
            resultado = await buscar_main_story(nome)
            cache_resultados[nome] = resultado
            fez_busca_de_verdade = True

        if resultado["horas"] is not None:
            diff = abs(resultado["horas"] - valor_atual)
            limiar_diff = max(DIFERENCA_HORAS_SUSPEITA, valor_atual * 0.25)
            suspeito = resultado.get("vale_revisar") or diff > limiar_diff

            if suspeito:
                print(f"  ⚠️ possível divergência -> {resultado['nome_hltb']}: "
                      f"{resultado['horas']}h agora vs {valor_atual}h salvo "
                      f"(similaridade {resultado['similaridade']})")
                suspeitos_validacao.append(
                    f"{nome}\n"
                    f"    salvo atualmente: {valor_atual}h\n"
                    f"    achado agora:     {resultado['horas']}h  ({resultado['nome_hltb']}, "
                    f"similaridade {resultado['similaridade']}, busquei por: "
                    f"'{resultado['nome_usado_na_busca']}')"
                )
            else:
                print(f"  -> OK, bate com o salvo (achado agora: {resultado['horas']}h, "
                      f"similaridade {resultado['similaridade']})")
        else:
            print(f"  ⚠️ não achei mais nada pra validar contra ({resultado.get('motivo')})")
            suspeitos_validacao.append(
                f"{nome}\n"
                f"    salvo atualmente: {valor_atual}h\n"
                f"    achado agora:     nada ({resultado.get('motivo')})"
            )

        if contador < total and fez_busca_de_verdade:
            await asyncio.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

    preenchidos_agora = sum(1 for j in a_preencher if j.get("tempo_para_zerar") is not None)
    print(f"\nConcluído: {preenchidos_agora}/{len(a_preencher)} novos preenchidos, "
          f"{len(a_validar)} validados ({len(suspeitos_validacao)} com possível divergência).")

    if pendentes:
        with open(RELATORIO_PENDENTES, "w", encoding="utf-8") as f:
            f.write("\n".join(pendentes))
        print(f"{len(pendentes)} pendentes/baixa confiança -> {RELATORIO_PENDENTES}")

    if suspeitos_validacao:
        with open(RELATORIO_VALIDACAO, "w", encoding="utf-8") as f:
            f.write("\n\n".join(suspeitos_validacao))
        print(f"{len(suspeitos_validacao)} valores salvos com possível divergência -> {RELATORIO_VALIDACAO}")
        print("(nada foi sobrescrito automaticamente nos já preenchidos - revise e corrija à mão)")

    print(f"\nJSON atualizado (só os novos preenchimentos) salvo em: {SAIDA}")
    print("Agora restaure esse arquivo na extensão (⇅ Backup → Restaurar de um JSON, com 'Mesclar' marcado).")


if __name__ == "__main__":
    asyncio.run(main())
