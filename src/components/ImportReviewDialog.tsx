import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ParsedInvoicePdf } from "@/lib/parseInvoicePdf";

/** Número em formato brasileiro para o campo ("1234,56"); vazio quando não veio. */
function toField(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

/** Aceita "1.234,56", "1234,56" ou "1234.56". */
function fromField(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : null;
}

type Props = {
  parsed: ParsedInvoicePdf;
  fileName: string;
  /** Para quem vai: "Fatura de LEOMAR", "Despesa: Fatura Energia Usina"… */
  target: string;
  /** Impede confirmar (UC que não é de cliente, mês já lançado…). */
  error: string | null;
  /** Aviso que não impede (ex.: já existe pendência, só anexa o PDF). */
  note: string | null;
  onCancel: () => void;
  onConfirm: (edited: ParsedInvoicePdf) => Promise<void>;
};

/**
 * Conferência da fatura lida do PDF, antes de gravar qualquer coisa.
 * Mostra os dados extraídos, deixa corrigir e só lança no "Confirmar".
 * Cancelar não grava nada (nem sobe o PDF).
 */
export function ImportReviewDialog({ parsed, fileName, target, error, note, onCancel, onConfirm }: Props) {
  const isClientBill = parsed.kind === "equatorial" && !target.startsWith("Despesa");
  const [month, setMonth] = useState(parsed.referenceMonth);
  const [due, setDue] = useState(parsed.due_date ?? "");
  const [consumption, setConsumption] = useState(parsed.kind === "equatorial" ? toField(parsed.consumption_kw) : "");
  const [price, setPrice] = useState(parsed.kind === "equatorial" ? toField(parsed.price_kw) : "");
  const [lighting, setLighting] = useState(parsed.kind === "equatorial" ? toField(parsed.public_lighting) : "");
  const [fine, setFine] = useState(parsed.kind === "equatorial" ? toField(parsed.interest_fine) : "");
  const [total, setTotal] = useState(parsed.kind === "equatorial" ? toField(parsed.distributor_invoice) : toField(parsed.total));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function confirm() {
    if (!/^\d{4}-\d{2}$/.test(month)) return setFormError("Informe o mês de referência.");
    const totalN = fromField(total);
    if (totalN === null) return setFormError("Informe o valor da fatura.");
    let edited: ParsedInvoicePdf;
    if (parsed.kind === "equatorial") {
      const cons = fromField(consumption);
      if (isClientBill && cons === null) return setFormError("Informe o consumo (kWh).");
      edited = {
        ...parsed,
        referenceMonth: month,
        due_date: due || null,
        consumption_kw: cons,
        price_kw: fromField(price),
        public_lighting: fromField(lighting),
        interest_fine: fromField(fine) ?? 0,
        distributor_invoice: totalN,
      };
    } else {
      if (!due) return setFormError("Informe o vencimento.");
      edited = { ...parsed, referenceMonth: month, due_date: due, total: totalN };
    }
    setFormError("");
    setSaving(true);
    try {
      await onConfirm(edited);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent aria-describedby={undefined} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conferir fatura antes de lançar</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-foreground">{target}</p>
          <p className="text-xs text-muted-foreground">
            Arquivo: {fileName}
            {parsed.kind === "equatorial" ? ` · UC ${parsed.uc_number}` : ` · Matrícula ${parsed.matricula}`}
          </p>
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : (
          <>
            {note && <p className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-800">{note}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mês de referência</Label>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
              <div>
                <Label>Vencimento</Label>
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
              {isClientBill && (
                <>
                  <div>
                    <Label>Consumo (kWh)</Label>
                    <Input inputMode="decimal" value={consumption} onChange={(e) => setConsumption(e.target.value)} />
                  </div>
                  <div>
                    <Label>Preço do kW</Label>
                    <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="vazio = usa o do mês" />
                  </div>
                  <div>
                    <Label>Iluminação pública (R$)</Label>
                    <Input inputMode="decimal" value={lighting} onChange={(e) => setLighting(e.target.value)} />
                  </div>
                  <div>
                    <Label>Juros/multa (R$)</Label>
                    <Input inputMode="decimal" value={fine} onChange={(e) => setFine(e.target.value)} />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <Label>{isClientBill ? "Valor da fatura Equatorial (R$)" : "Valor da despesa (R$)"}</Label>
                <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {isClientBill
                ? "Ao confirmar, a fatura vira pendência do cliente (o ícone passa a pulsar) para você lançar."
                : "Ao confirmar, vira despesa pendente no Fluxo de Caixa, com o PDF anexado."}
            </p>
          </>
        )}
        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {error ? "Fechar" : "Cancelar"}
          </Button>
          {!error && (
            <Button onClick={() => void confirm()} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar lançamento
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
