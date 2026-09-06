#!/usr/bin/env python3
"""
preencher_hltb.py — preenche o "tempo para zerar" (HowLongToBeat) de TODOS os
jogos de um backup JSON exportado pela extensão Gerenciador de Jogos Favoritos.

Fluxo:
  1. Na extensão: ⇅ Backup → "Exportar tudo (JSON)".
  2. Rode:  python3 preencher_hltb.py jogos-favoritos-2026-09-06.json
  3. Na extensão: ⇅ Backup → "Restaurar de um JSON" (com "Mesclar" marcado)
     e selecione o arquivo *-hltb.json gerado.

Depois disso, o campo "tempo para zerar" fica com o valor real (Main Story) e o
filtro/badge "⚡ Zera rápido" passa a usar esse número por jogo.

Requisitos:  pip install howlongtobeatpy --break-system-packages
"""
import argparse
import asyncio
import json
import re
import sys

try:
    from howlongtobeatpy import HowLongToBeat
except ImportError:
    sys.exit("Instale a dependência:  pip install howlongtobeatpy --break-system-packages")


def limpar_nome(nome: str) -> str:
    """Remove 'boilerplate' de loja para melhorar a busca na HLTB."""
    n = " " + (nome or "") + " "
    n = re.sub(r"^\s*(economize|poupe|save(?:\s+up\s+to)?)\s+\d+\s*%\s+(em|on|no|na)\s+", "", n, flags=re.I)
    n = re.sub(r"\s*(?:[-–—|:]\s*)?(?:no|na|on)\s+steam\s*$", "", n, flags=re.I)
    n = re.sub(r"\s*[-–—|:]?\s*(?:apps|aplicativos|jogos|games)\s+(?:no|on)\s+google\s+play\s*$", "", n, flags=re.I)
    n = re.sub(r"\s*[-–—|]\s*(nintendo|google play|itch\.io).*$", "", n, flags=re.I)
    return re.sub(r"\s{2,}", " ", n).strip()


async def buscar_horas(nome: str):
    """Retorna (main_story_horas) ou None."""
    try:
        resultados = await HowLongToBeat().async_search(nome)
    except Exception:
        return None
    if not resultados:
        return None
    melhor = max(resultados, key=lambda r: r.similarity)
    h = melhor.main_story or melhor.main_extra or melhor.completionist
    if not h or h <= 0:
        return None
    return round(float(h) * 2) / 2  # arredonda para 0,5h


def limpar_nota_estimada(notas: str) -> str:
    if not notas:
        return notas
    partes = [p.strip() for p in notas.split("·")]
    partes = [p for p in partes if "tempo estimado" not in p.lower()]
    return " · ".join(partes)


async def main():
    ap = argparse.ArgumentParser(description="Preenche tempo para zerar (HowLongToBeat) num backup JSON.")
    ap.add_argument("arquivo", help="backup JSON exportado pela extensão")
    ap.add_argument("-o", "--saida", help="arquivo de saída (padrão: <entrada>-hltb.json)")
    ap.add_argument("--forcar", action="store_true", help="rebusca mesmo jogos que já têm tempo")
    ap.add_argument("--intervalo", type=float, default=1.0, help="segundos entre buscas (padrão 1.0)")
    args = ap.parse_args()

    with open(args.arquivo, encoding="utf-8") as f:
        dados = json.load(f)

    jogos = dados.get("jogos", [])
    total = len(jogos)
    preenchidos = nao_achou = pulados = 0

    for i, j in enumerate(jogos, 1):
        nome = limpar_nome(j.get("nome", ""))
        tem = j.get("tempo_para_zerar")
        j["notas"] = limpar_nota_estimada(j.get("notas", ""))
        if not nome:
            pulados += 1
            continue
        if tem and not args.forcar:
            pulados += 1
            continue
        horas = await buscar_horas(nome)
        if horas:
            j["tempo_para_zerar"] = horas
            preenchidos += 1
            print(f"[{i}/{total}] ✓ {nome}: {horas}h")
        else:
            nao_achou += 1
            print(f"[{i}/{total}] — {nome}: não encontrado")
        await asyncio.sleep(args.intervalo)

    saida = args.saida or re.sub(r"\.json$", "", args.arquivo) + "-hltb.json"
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)

    print(f"\nConcluído: {preenchidos} preenchidos, {nao_achou} não encontrados, {pulados} pulados.")
    print(f"Arquivo gerado: {saida}")
    print("Agora restaure esse arquivo na extensão (⇅ Backup → Restaurar de um JSON, com 'Mesclar' marcado).")


if __name__ == "__main__":
    asyncio.run(main())
