#!/usr/bin/env python3
"""Parser cirurgico de fatura Equatorial GO (PDF) -> campos do Minha Usina.
Uso: parse_fatura.py <pdf>  -> JSON na stdout. Nada e gravado no sistema.
Regras validadas em Leomar 09/2026 e 10/2026:
- UC: padrao 1.512.168.012-10 no cabecalho (sem pontuacao = 151216801210)
- Referencia: OUT/2026 etc (mes da fatura, nao vencimento)
- Consumo total: linha ENERGIA ATIVA - KWH ... ultimo numero antes da data
- Preco kW: linha CONSUMO NAO COMPENSADO, coluna preco (ex 1,146179)
- Consumo nao compensado e SCEE: quantidades dessas linhas
- Iluminacao: CONTRIB. ILUM. PUBLICA - MUNICIPAL
- Juros/multa: JUROS MORATORIA. + MULTA - (somar; podem estar ausentes = 0)
- Total distribuidora: linha TOTAL, primeiro valor; vencimento: data apos total
- Vencimento e total tambem conferem com o corpo do e-mail.
"""
import sys, re, json, subprocess, tempfile, os

def num(s):
    return float(s.replace('.', '').replace(',', '.'))

def parse(pdf_path):
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as tf:
        txt_path = tf.name
    subprocess.run(['pdftotext', '-layout', pdf_path, txt_path], check=True)
    text = open(txt_path, encoding='utf-8', errors='ignore').read()
    os.unlink(txt_path)
    flat = re.sub(r'\s+', ' ', text)

    def search(pat, flags=re.I):
        m = re.search(pat, text, flags)
        return m

    # UC: 1.512.168.012-10
    m = re.search(r'(\d\.\d{3}\.\d{3}\.\d{3}-\d{2})', text)
    uc = re.sub(r'\D', '', m.group(1)) if m else None
    # Referencia: OUT/2026, SET/2026...
    m = re.search(r'\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/(\d{4})\b', text)
    ref = f"{m.group(1)}/{m.group(2)}" if m else None
    # Total + vencimento: linha com R$****291,31 ... 07/11/2026
    m = re.search(r'R\$\*+([\d.,]+)\s+(\d{2}/\d{2}/\d{4})', text)
    total_dist, due = (num(m.group(1)), m.group(2)) if m else (None, None)
    # Consumo nao compensado
    m = re.search(r'CONSUMO N[AÃ]O COMPENSADO\s+kWh\s+([\d.,]+)\s+([\d.,]+)', text)
    cons_nc, price_kw = (num(m.group(1)), num(m.group(2))) if m else (None, None)
    # Consumo SCEE
    m = re.search(r'CONSUMO SCEE\s+kWh\s+([\d.,]+)\s+([\d.,]+)', text)
    cons_scee, price_scee = (num(m.group(1)), num(m.group(2))) if m else (None, None)
    # Energia ativa total
    m = re.search(r'ENERGIA ATIVA - KWH.*?([\d.,]+)\s+\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}', text, re.S)
    cons_total = num(m.group(1)) if m else (round(cons_nc + cons_scee, 2) if cons_nc is not None and cons_scee is not None else None)
    # Iluminacao
    m = re.search(r'CONTRIB\. ILUM\. P[UÚ]BLICA - MUNICIPAL\s+([\d.,]+)', text)
    ilum = num(m.group(1)) if m else None
    # Juros + multa (podem nao existir)
    juros = 0.0; multa = 0.0
    m = re.search(r'JUROS MORAT[OÓ]RIA\.\s+([\d.,]+)', text)
    if m: juros = num(m.group(1))
    m = re.search(r'MULTA - \d{2}/\d{4}\.\s+([\d.,]+)', text)
    if m: multa = num(m.group(1))
    interest_fine = round(juros + multa, 2)
    # UC geradora + rateio
    m = re.search(r'GERA[CÇ][AÃ]O CICLO.*?UC 0*(\d{12})', text)
    gen_uc = m.group(1) if m else None
    return {
        'uc_number': uc, 'reference': ref, 'due_date': due,
        'consumption_kw': cons_total,
        'consumption_non_compensated_kw': cons_nc,
        'price_kw': price_kw,
        'consumption_scee_kw': cons_scee,
        'price_scee': price_scee,
        'public_lighting': ilum,
        'interest_fine': interest_fine,
        'interest_fine_parts': {'juros': juros, 'multa': multa},
        'distributor_invoice': total_dist,
        'generation_uc': gen_uc,
        'source_pdf': os.path.basename(pdf_path),
    }

if __name__ == '__main__':
    print(json.dumps(parse(sys.argv[1]), indent=2, ensure_ascii=False))
