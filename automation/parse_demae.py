#!/usr/bin/env python3
"""Extrai os campos de uma fatura de água do Demae (Caldas Novas/GO).

Uso: python3 parse_demae.py <arquivo.pdf>
Saída: JSON com matricula, invoice_number, reference (MM/AAAA),
due_date (dd/mm/aaaa) e total (float).

O PDF é de 1 página. Os campos usados:
- "Matrícula: 59289-7" no cabeçalho
- "Referência: 10/2026"
- "Data de Vencimento: 26/10/2026"
- "Valor: R$ 32,59" no cabeçalho e "TOTAL A PAGAR 32,59" no corpo
  (os dois são conferidos; se divergirem, o script falha)
"""
import json
import re
import subprocess
import sys


def brl(text):
    return float(text.replace(".", "").replace(",", "."))


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    text = subprocess.run(
        ["pdftotext", "-layout", sys.argv[1], "-"],
        capture_output=True, text=True, check=True,
    ).stdout

    matricula = re.search(r"Matr[íi]cula:\s*([\d-]+)", text)
    invoice = re.search(r"Fatura n[ºo]:\s*(\d+)", text)
    reference = re.search(r"Refer[êe]ncia:\s*(\d{2}/\d{4})", text)
    due = re.search(r"Data de Vencimento:\s*(\d{2}/\d{2}/\d{4})", text)
    header_value = re.search(r"Valor:\s*R\$\s*([\d.,]+)", text)
    total = re.search(r"TOTAL A PAGAR\s+([\d.,]+)", text)

    missing = [n for n, v in (
        ("matricula", matricula), ("invoice_number", invoice),
        ("reference", reference), ("due_date", due),
        ("header_value", header_value), ("total", total),
    ) if not v]
    if missing:
        print(json.dumps({"error": "campos não encontrados", "missing": missing},
                         ensure_ascii=False), file=sys.stderr)
        return 1

    header_total = brl(header_value.group(1))
    total_value = brl(total.group(1))
    if abs(header_total - total_value) > 0.005:
        print(json.dumps({"error": "Valor do cabeçalho diverge do TOTAL A PAGAR",
                          "header": header_total, "total": total_value},
                         ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps({
        "matricula": matricula.group(1),
        "invoice_number": invoice.group(1),
        "reference": reference.group(1),
        "due_date": due.group(1),
        "total": total_value,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
