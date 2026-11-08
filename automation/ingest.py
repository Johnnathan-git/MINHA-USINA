#!/usr/bin/env python3
"""Minha Usina — ponte Gmail -> sistema.

Lê os e-mails da Equatorial encaminhados para o Gmail, baixa o PDF de
cada um, extrai os campos com parse_fatura.py e envia para o sistema:
- UC de cliente -> POST /api/import-pending, grava a fatura como
  pendente (tabela pending_invoice_imports). A rota confere duplicata:
  se a fatura já foi lançada ou já está pendente, nada é criado.
- UC geradora (423837601225) -> POST /api/import-expense, grava direto
  a despesa "Fatura de Energia Usina" (categoria Fatura Usina, status
  pendente), com o valor total da fatura da usina. Sem filtro de revisão,
  como o usuário escolheu em 2026-11-06.
- Internet da usina -> a despesa fixa "Fatura de Internet Usina"
  (R$ 79,00, categoria Fatura Usina, pendente) do mês M é criada no dia
  25 do mês M-1. A rotina também garante a do mês corrente, caso o dia
  25 já tenha passado. A rota confere duplicata por categoria +
  descrição + mês.
- Água (Demae) -> os e-mails "Sua Fatura de Agua" trazem o PDF da
  fatura. Só a matrícula 59289-7 é da usina; outras matrículas no nome
  dele (ex.: 39220-0, outro imóvel) são ignoradas. Vira a despesa
  "Fatura de Agua Usina" com o valor total da fatura.

Uso:
  python3 ingest.py --dry-run            # só lê e extrai, não envia nada
  python3 ingest.py                      # envia
  python3 ingest.py --message-id <id>    # processa só uma mensagem do Gmail

O segredo vai pelo conector custom.minha-usina-import (cofre), nunca
por variável de ambiente nem por argumento.
"""
import argparse
import base64
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GMAIL_ACCOUNT = "2614840304fd4824a1f5e0a33ecf7139"  # johnnathanmendonca92@gmail.com
APP_URL = "https://usinadosirmaos.lovable.app"
MONTHS = {
    "JAN": "01", "FEV": "02", "MAR": "03", "ABR": "04", "MAI": "05", "JUN": "06",
    "JUL": "07", "AGO": "08", "SET": "09", "OUT": "10", "NOV": "11", "DEZ": "12",
}


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"comando falhou ({r.returncode}): {' '.join(cmd)}\n{r.stderr[:500]}")
    return r.stdout


def gmail_json(args):
    out = run(["/opt/hatch/bin/hatch_gws_cli", "gmail"] + args)
    return json.loads(out)


def list_equatorial_messages():
    # Os encaminhamentos às vezes caem no spam do Gmail. A busca normal
    # não inclui o spam, então consultamos os dois e juntamos sem duplicar.
    seen = set()
    out = []
    for q in ("Fatura da Equatorial Energia", "in:spam Fatura da Equatorial Energia"):
        data = gmail_json([
            "users", "messages", "list", "--account", GMAIL_ACCOUNT,
            # Assunto original da Equatorial; vale para os redirecionados
            # (remetente atendimento@) e para os encaminhados manualmente.
            "--params", json.dumps({"userId": "me", "q": q}),
        ])
        for m in data.get("messages", []):
            if m["id"] not in seen:
                seen.add(m["id"])
                out.append(m)
    return out


def find_pdf_part(payload):
    if (payload.get("filename") or "").lower().endswith(".pdf"):
        return payload
    for part in payload.get("parts") or []:
        found = find_pdf_part(part)
        if found:
            return found
    return None


def find_all_pdf_parts(payload, out=None):
    if out is None:
        out = []
    if (payload.get("filename") or "").lower().endswith(".pdf"):
        out.append(payload)
    for part in payload.get("parts") or []:
        find_all_pdf_parts(part, out)
    return out


def list_demae_messages():
    seen = set()
    out = []
    for q in ("Sua Fatura de Agua", "in:spam Sua Fatura de Agua"):
        data = gmail_json([
            "users", "messages", "list", "--account", GMAIL_ACCOUNT,
            "--params", json.dumps({"userId": "me", "q": q}),
        ])
        for m in data.get("messages", []):
            if m["id"] not in seen:
                seen.add(m["id"])
                out.append(m)
    return out


def download_pdf(message_id, attachment_id):
    data = gmail_json([
        "users", "messages", "attachments", "get", "--account", GMAIL_ACCOUNT,
        "--params", json.dumps({"userId": "me", "messageId": message_id, "id": attachment_id}),
    ])
    raw = base64.urlsafe_b64decode(data["data"] + "=" * (-len(data["data"]) % 4))
    return raw


def parse_pdf(pdf_path):
    out = run([sys.executable, os.path.join(HERE, "parse_fatura.py"), pdf_path])
    return json.loads(out)


def parse_demae_pdf(pdf_path):
    out = run([sys.executable, os.path.join(HERE, "parse_demae.py"), pdf_path])
    return json.loads(out)


def process_demae_message(message_id, dry_run):
    msg = gmail_json([
        "users", "messages", "get", "--account", GMAIL_ACCOUNT,
        "--params", json.dumps({"userId": "me", "id": message_id, "format": "full"}),
    ])
    results = []
    for part in find_all_pdf_parts(msg["payload"]):
        pdf_bytes = download_pdf(message_id, part["body"]["attachmentId"])
        pdf_path = f"/tmp/demae-{message_id}-{part['filename']}"
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes)
        parsed = parse_demae_pdf(pdf_path)
        mon, year = parsed["reference"].split("/")
        result = {
            "message_id": message_id,
            "kind": "expense_water",
            "matricula": parsed["matricula"],
            "reference": parsed["reference"],
            "total": parsed["total"],
            "pdf": part["filename"],
        }
        if parsed["matricula"] != PLANT_WATER_MATRICULA:
            result["status"] = "skipped_other_matricula"
            results.append(result)
            continue
        expense = {
            "category": EXPENSE_CATEGORY,
            "description": WATER_DESCRIPTION,
            "amount": parsed["total"],
            "reference_date": f"{year}-{mon}-01",
            "notes": PENDING_NOTES,
            "due_date": to_iso_date(parsed.get("due_date")),
            "pdf_base64": base64.b64encode(open(pdf_path, "rb").read()).decode(),
        }
        result["expense_amount"] = expense["amount"]
        if dry_run:
            result["status"] = "dry_run_ok"
            results.append(result)
            continue
        status, body = post_via_helper(HELPER_EXPENSE, expense)
        result["http"] = status
        result.update({k: v for k, v in body.items() if k != "http"})
        results.append(result)
    if not results:
        results.append({"message_id": message_id, "kind": "expense_water", "status": "no_pdf"})
    return results


def to_iso_date(br):
    if not br:
        return None
    d, m, y = br.split("/")
    return f"{y}-{m}-{d}"


def build_payload(parsed, message_id, pdf_bytes):
    mon, year = parsed["reference"].split("/")
    return {
        "uc_number": parsed["uc_number"],
        "reference_date": f"{year}-{MONTHS[mon]}-01",
        "consumption_kw": parsed["consumption_kw"],
        "price_kw": parsed["price_kw"],
        "price_kw_exact": str(parsed["price_kw"]),
        "public_lighting": parsed["public_lighting"],
        "interest_fine": parsed["interest_fine"],
        "distributor_invoice": parsed["distributor_invoice"],
        "due_date": to_iso_date(parsed.get("due_date")),
        "source_gmail_message_id": message_id,
        "source_pdf_filename": parsed.get("source_pdf"),
        "pdf_base64": base64.b64encode(pdf_bytes).decode(),
    }


HELPER_DIR = "/home/hatch/workspace/custom-connectors/custom.minha-usina-import/bin"
HELPER_PENDING = os.path.join(HELPER_DIR, "import_pending.py")
HELPER_EXPENSE = os.path.join(HELPER_DIR, "import_expense.py")

GENERATING_UC = "423837601225"  # UC geradora da usina
PLANT_WATER_MATRICULA = "59289-7"  # matrícula Demae da usina (R. CH-06)
WATER_DESCRIPTION = "Fatura Agua Usina"
INTERNET_LAUNCH_DAY = 25  # a internet do mês M é lançada no dia 25 do mês M-1
EXPENSE_CATEGORY = "Fatura Usina"
ENERGY_DESCRIPTION = "Fatura Energia Usina"
INTERNET_DESCRIPTION = "Boleto Internet Usina"
INTERNET_AMOUNT = 79.00  # valor fixo todo mês, confirmado pelo usuário
PENDING_NOTES = "[[status:pendente]]"


def post_via_helper(helper, payload):
    """Post through the registered custom.minha-usina-import connector.

    The secret is never read here. The helper attaches the surrogate
    and authd swaps in the real credential for the approved request.
    """
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        path = f.name
    out = run([sys.executable, helper, path])
    os.unlink(path)
    body = json.loads(out)
    return body.get("http", 0), body


def build_expense_payload(parsed, pdf_bytes=None):
    mon, year = parsed["reference"].split("/")
    payload = {
        "category": EXPENSE_CATEGORY,
        "description": ENERGY_DESCRIPTION,
        "amount": parsed["distributor_invoice"],
        "reference_date": f"{year}-{MONTHS[mon]}-01",
        "notes": PENDING_NOTES,
        "due_date": to_iso_date(parsed.get("due_date")),
    }
    if pdf_bytes:
        payload["pdf_base64"] = base64.b64encode(pdf_bytes).decode()
    return payload


def process_message(message_id, dry_run):
    msg = gmail_json([
        "users", "messages", "get", "--account", GMAIL_ACCOUNT,
        "--params", json.dumps({"userId": "me", "id": message_id, "format": "full"}),
    ])
    part = find_pdf_part(msg["payload"])
    if not part:
        return {"message_id": message_id, "status": "no_pdf"}
    pdf_bytes = download_pdf(message_id, part["body"]["attachmentId"])
    pdf_path = f"/tmp/ingest-{message_id}.pdf"
    with open(pdf_path, "wb") as f:
        f.write(pdf_bytes)
    parsed = parse_pdf(pdf_path)
    payload = build_payload(parsed, message_id, pdf_bytes)
    result = {
        "message_id": message_id,
        "uc": parsed["uc_number"],
        "reference": parsed["reference"],
        "consumption_kw": parsed["consumption_kw"],
        "price_kw": parsed["price_kw"],
        "distributor_invoice": parsed["distributor_invoice"],
        "pdf": part["filename"],
    }
    if parsed["uc_number"] == GENERATING_UC:
        result["kind"] = "expense_energy"
        expense = build_expense_payload(parsed, pdf_bytes)
        result["expense_amount"] = expense["amount"]
        if dry_run:
            result["status"] = "dry_run_ok"
            return result
        status, body = post_via_helper(HELPER_EXPENSE, expense)
        result["http"] = status
        result.update({k: v for k, v in body.items() if k != "http"})
        return result
    if dry_run:
        result["status"] = "dry_run_ok"
        return result
    status, body = post_via_helper(HELPER_PENDING, payload)
    result["http"] = status
    result.update({k: v for k, v in body.items() if k != "http"})
    return result


def internet_target_months(today=None):
    """Meses da internet a garantir: o corrente sempre, e o próximo
    quando já passou do dia 25 (a internet do mês M é lançada no dia
    25 do mês M-1). Retorna lista de (ano, mês)."""
    from datetime import date
    today = today or date.today()
    targets = [(today.year, today.month)]
    if today.day >= INTERNET_LAUNCH_DAY:
        y, m = (today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1)
        targets.append((y, m))
    return targets


def internet_boleto_path(y, m):
    """Boleto da internet do mês (quando o provedor manda o arquivo).
    Os boletos ficam em boletos-internet/AAAA-MM.pdf; sem o arquivo, a
    despesa é lançada sem anexo (o botão no Fluxo de Caixa fica sem boleto)."""
    path = os.path.join(HERE, "boletos-internet", f"{y}-{m:02d}.pdf")
    return path if os.path.isfile(path) else None


def ensure_internet_expense(dry_run):
    """Garante as despesas fixas de internet devidas até hoje."""
    from datetime import date
    results = []
    for (y, m) in internet_target_months():
        payload = {
            "category": EXPENSE_CATEGORY,
            "description": INTERNET_DESCRIPTION,
            "amount": INTERNET_AMOUNT,
            "reference_date": f"{y}-{m:02d}-01",
            "notes": PENDING_NOTES,
            # O boleto vence no dia 10 (conferido no arquivo do provedor).
            "due_date": f"{y}-{m:02d}-10",
        }
        boleto = internet_boleto_path(y, m)
        if boleto:
            with open(boleto, "rb") as f:
                payload["pdf_base64"] = base64.b64encode(f.read()).decode()
        result = {"kind": "expense_internet", "reference": f"{y}-{m:02d}",
                  "amount": INTERNET_AMOUNT}
        if dry_run:
            result["status"] = "dry_run_ok"
            results.append(result)
            continue
        status, body = post_via_helper(HELPER_EXPENSE, payload)
        result["http"] = status
        result.update({k: v for k, v in body.items() if k != "http"})
        results.append(result)
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--message-id", default=None)
    args = ap.parse_args()

    if not args.dry_run:
        # A credencial vem do conector custom.minha-usina-import, não de variável de ambiente.
        pass

    ids = [args.message_id] if args.message_id else [m["id"] for m in list_equatorial_messages()]
    print(f"{len(ids)} mensagem(ns) da Equatorial no Gmail.")
    failed = 0
    for mid in ids:
        try:
            print(json.dumps(process_message(mid, args.dry_run), ensure_ascii=False))
        except Exception as e:
            failed += 1
            print(json.dumps({"message_id": mid, "status": "error", "error": str(e)[:300]}, ensure_ascii=False))
    if not args.message_id:
        dem = list_demae_messages()
        print(f"{len(dem)} mensagem(ns) do Demae no Gmail.")
        for m in dem:
            try:
                for r in process_demae_message(m["id"], args.dry_run):
                    print(json.dumps(r, ensure_ascii=False))
            except Exception as e:
                failed += 1
                print(json.dumps({"message_id": m["id"], "status": "error", "error": str(e)[:300]}, ensure_ascii=False))
        try:
            for r in ensure_internet_expense(args.dry_run):
                print(json.dumps(r, ensure_ascii=False))
        except Exception as e:
            failed += 1
            print(json.dumps({"kind": "expense_internet", "status": "error", "error": str(e)[:300]}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
