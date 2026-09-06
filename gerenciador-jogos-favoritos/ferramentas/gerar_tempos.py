#!/usr/bin/env python3
"""Gera ../tempos_dados.js a partir de tempos.txt.

A extensão carrega tempos_dados.js automaticamente (nas páginas e no service
worker), então TODO jogo importado/favoritado cujo nome esteja na lista já
recebe o tempo para zerar (Main Story) sem depender do HowLongToBeat ao vivo.

Uso:
    python3 ferramentas/gerar_tempos.py          # lê ferramentas/tempos.txt
    python3 ferramentas/gerar_tempos.py lista.txt # lê outro arquivo

Formato de cada linha do .txt:  Nome do Jogo - 8.93h
"""
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
ENTRADA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, "tempos.txt")
SAIDA = os.path.join(RAIZ, "tempos_dados.js")

LINHA = re.compile(r"^\s*(.+?)\s*[-–—:]\s*([\d]+[.,]?[\d]*)\s*h\b", re.I)


def main():
    jogos = []
    with open(ENTRADA, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            m = LINHA.match(ln)
            if not m:
                print("  (ignorada) " + ln)
                continue
            horas = float(m.group(2).replace(",", "."))
            if horas > 0:
                jogos.append([m.group(1).strip(), horas])

    header = (
        "/* ======================================================================= *\n"
        " * tempos_dados.js -- Lista de tempos para zerar (Main Story) EMBUTIDA.\n"
        " *\n"
        " * Gerado a partir de ferramentas/tempos.txt. NAO editar a mao: regenere com\n"
        " *   python3 ferramentas/gerar_tempos.py\n"
        " * quando alterar a lista. Carregado ANTES de shared.js (nas paginas e no\n"
        " * service worker), que o converte em indice de busca por nome.\n"
        " *\n"
        " * Cada item: [nome, horasMainStory]. " + str(len(jogos)) + " jogos.\n"
        " * ======================================================================= */\n"
    )
    body = (
        "(function (root) {\n  root.GJF_TEMPOS = "
        + json.dumps(jogos, ensure_ascii=False)
        + ";\n})(typeof self !== 'undefined' ? self : this);\n"
    )
    with open(SAIDA, "w", encoding="utf-8") as f:
        f.write(header + body)
    print("Gerado " + SAIDA + " com " + str(len(jogos)) + " jogos.")


if __name__ == "__main__":
    main()
