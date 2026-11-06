import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Zap, FileText, Power, PowerOff, Settings, TrendingUp, Pencil, Trash2, Eye, ShieldAlert, Paperclip, Loader2 } from "lucide-react";
import { CLIENT_COLORS, brl, initial, monthLabelFromISO, getClientButtonStyles } from "@/lib/format";
import { useState, useEffect } from "react";
import { toast } from "sonner";

type Client = {
  id: string; name: string; phone: string | null; email: string | null;
  color: string; uc_number: string; notes: string | null; active: boolean;
  discount_pct: number;
  public_lighting_value: number;
};
type InvoiceRow = { id: string; client_id: string; reference_date: string; attachment_url: string | null; notes: string | null };

/** Fatura extraída do PDF do e-mail e aguardando importação. Não aparece como lista: só faz o avatar do cliente pulsar. */
type PendingImport = {
  id: string;
  client_id: string;
  reference_date: string;
  consumption_kw: number;
  price_kw: number;
  price_kw_exact: string | null;
  public_lighting: number;
  interest_fine: number;
  distributor_invoice: number;
  due_date: string | null;
  attachment_url: string | null;
  source_pdf_filename: string | null;
};

type Invoice = {
  id: string;
  client_id: string;
  reference_date: string;
  consumption_kw: number;
  price_kw: number;
  public_lighting: number;
  interest_fine: number;
  value_without_plant: number;
  client_pays: number;
  distributor_invoice: number;
  notes: string | null;
  attachment_url: string | null;
};

/** Status de pagamento em notes: [[status:pendente]] — sem tag = pago */
function invoicePaymentStatus(notes: string | null | undefined): "pago" | "pendente" {
  if (notes?.includes("[[status:pendente]]")) return "pendente";
  return "pago";
}
function stripPaymentTag(notes: string | null | undefined): string {
  return (notes || "")
    .replace(/\[\[status:(pago|pendente)\]\]/g, "")
    .replace(/\[\[due:\d{4}-\d{2}-\d{2}\]\]/g, "")
    .replace(/\[\[price_kw_exact:[^\]]+\]\]/g, "")
    .trim();
}

function invoiceExactPrice(notes: string | null | undefined, fallback: number): string {
  const exact = (notes || "").match(/\[\[price_kw_exact:([^\]]+)\]\]/)?.[1]?.trim();
  return exact || String(fallback);
}

function normalizeExactDecimal(value: string): string {
  const normalized = value.trim().replace(/\s/g, "");
  if (!normalized) return "0";
  return normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized;
}

/** Vencimento da fatura em notes: [[due:yyyy-mm-dd]] */
function invoiceDueDate(notes: string | null | undefined): string {
  return (notes || "").match(/\[\[due:(\d{4}-\d{2}-\d{2})\]\]/)?.[1] ?? "";
}
function withPaymentTag(
  notes: string | null | undefined,
  status: "pago" | "pendente",
  due?: string,
  exactPriceKw?: string,
): string | null {
  const cleaned = stripPaymentTag(notes);
  const tags = [
    status === "pendente" ? "[[status:pendente]]" : "",
    due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? `[[due:${due}]]` : "",
    exactPriceKw ? `[[price_kw_exact:${normalizeExactDecimal(exactPriceKw)}]]` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const out = [cleaned, tags].filter(Boolean).join(" ").trim();
  return out || null;
}

async function fetchFaturasPage() {
  const [c, i, p] = await Promise.all([
    supabase.from("clients").select("*").order("created_at", { ascending: true }),
    supabase.from("invoices").select("id,client_id,reference_date,attachment_url,notes"),
    supabase
      .from("pending_invoice_imports")
      .select("id,client_id,reference_date,consumption_kw,price_kw,price_kw_exact,public_lighting,interest_fine,distributor_invoice,due_date,attachment_url,source_pdf_filename")
      .eq("status", "pending")
      .order("reference_date", { ascending: true }),
  ]);
  if (c.error) throw new Error(c.error.message || "Erro ao carregar clientes");
  if (i.error) throw new Error(i.error.message || "Erro ao carregar faturas");
  return {
    clients: (c.data ?? []) as Client[],
    invoices: (i.data ?? []) as InvoiceRow[],
    // A tabela de pendentes só existe após aplicar a migration; sem ela, a página segue sem pulsar.
    pending: (p.error ? [] : (p.data ?? [])) as PendingImport[],
  };
}

export const Route = createFileRoute("/_app/faturas")({
  ssr: false,
  component: FaturasPage,
  head: () => ({
    meta: [
      { title: "Faturas — Usina dos Irmãos" },
      { name: "description", content: "Gestão de clientes e lançamento de faturas mensais." },
    ],
  }),
});

function FaturasPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["faturas-page"],
    queryFn: fetchFaturasPage,
    retry: 1,
    staleTime: 2 * 60_000,
  });

  const [showInactive, setShowInactive] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<Client | null>(null);
  const [historyFor, setHistoryFor] = useState<Client | null>(null);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Carregando faturas e clientes...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="mx-auto max-w-lg space-y-4 border-border p-8 text-center">
        <h2 className="text-lg font-bold text-foreground">Não foi possível carregar</h2>
        <p className="text-sm text-muted-foreground">
          {(error as Error)?.message || "Erro desconhecido ao buscar dados."}
        </p>
        <Button onClick={() => refetch()} disabled={isFetching} className="gap-2">
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Tentar de novo
        </Button>
      </Card>
    );
  }

  const active = data.clients.filter((c) => c.active);
  const inactive = data.clients.filter((c) => !c.active);
  const shown = showInactive ? inactive : active;

  const invCount = (id: string) => data.invoices.filter((i) => i.client_id === id).length;

  // Uma pendência por cliente (a mais antiga, se houver mais de uma).
  const pendingByClient = new Map<string, PendingImport>();
  for (const p of data.pending) {
    if (!pendingByClient.has(p.client_id)) pendingByClient.set(p.client_id, p);
  }

  async function toggleActive(c: Client) {
    const { error: err } = await supabase.from("clients").update({ active: !c.active }).eq("id", c.id);
    if (err) return toast.error(err.message);
    toast.success(c.active ? "Cliente desativado" : "Cliente reativado");
    qc.invalidateQueries({ queryKey: ["faturas-page"] });
    qc.invalidateQueries({ queryKey: ["relatorio-page"] });
  }

  async function deleteClientForever(c: Client) {
    const typed = window.prompt(
      `EXCLUSÃO DEFINITIVA de "${c.name}".\n\nIsso apaga o cliente e TODOS os dados lançados (faturas, rateio e vínculos de acesso). Essa ação não pode ser desfeita.\n\nDigite EXCLUIR para confirmar:`,
    );
    if (typed?.trim().toUpperCase() !== "EXCLUIR") return;
    const inv = await supabase.from("invoices").delete().eq("client_id", c.id);
    if (inv.error) return toast.error(inv.error.message);
    const alloc = await supabase.from("client_allocations").delete().eq("client_id", c.id);
    if (alloc.error) return toast.error(alloc.error.message);
    await supabase.from("user_clients").delete().eq("client_id", c.id);
    const cli = await supabase.from("clients").delete().eq("id", c.id);
    if (cli.error) return toast.error(cli.error.message);
    toast.success(`Cliente ${c.name} excluído definitivamente`);
    qc.invalidateQueries({ queryKey: ["faturas-page"] });
    qc.invalidateQueries({ queryKey: ["relatorio-page"] });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="truncate text-3xl font-bold tracking-tight text-foreground">Faturas</h1>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground light:text-emerald-600">
            {active.length} ativos · {inactive.length} inativos
          </p>
        </div>
        <div className="flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button
            variant="outline"
            onClick={() => setShowInactive((v) => !v)}
            className="glass-card border-border bg-accent text-muted-foreground hover:text-foreground rounded-lg"
          >
            {showInactive ? "Ver ativos" : "Ver inativos"}
          </Button>
          <Button
            onClick={() => setNewClientOpen(true)}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2 font-bold shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            <Plus className="h-4 w-4" /> Novo Cliente
          </Button>
        </div>
      </div>

      {shown.length === 0 && (
        <Card className="glass-card border-border p-10 text-center text-muted-foreground">
          {showInactive ? "Nenhum cliente inativo." : "Nenhum cliente cadastrado. Clique em Novo Cliente."}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-3 [&>*]:glass-card-interactive">
        {shown.map((c) => (
          <Card key={c.id} className="glass-card relative overflow-hidden p-5" style={{ borderLeft: `4px solid ${c.color}` }}>
            <div className="mb-3 flex w-full items-start justify-between text-left">
              <div className="flex items-center gap-2.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ${
                    pendingByClient.has(c.id) ? "animate-pulse ring-2 ring-amber-400" : ""
                  }`}
                  style={{ backgroundColor: c.color }}
                  title={
                    pendingByClient.has(c.id)
                      ? `Fatura de ${monthLabelFromISO(pendingByClient.get(c.id)!.reference_date)} aguardando importação — clique em Lançar`
                      : undefined
                  }
                >
                  {initial(c.name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-bold text-sm text-foreground">{c.name}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    UC {c.uc_number}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditClient(c)}
                  className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Editar ${c.name}`}
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={() => toggleActive(c)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                  title={c.active ? "Desativar" : "Ativar"}
                  aria-label={c.active ? `Desativar ${c.name}` : `Ativar ${c.name}`}
                >
                  {c.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" /> 1 UC
              </span>
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {invCount(c.id)} {invCount(c.id) === 1 ? "fatura" : "faturas"}
              </span>
              {data.invoices.some((i) => i.client_id === c.id && i.attachment_url) && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Paperclip className="h-3 w-3" /> Anexos
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                className="w-full gap-2 transition-all hover:opacity-90 text-white font-bold rounded-lg px-3 py-1.5 border-0 text-[11px] uppercase tracking-wider"
                style={getClientButtonStyles(c.color)}
                onClick={() => setInvoiceFor(c)}
                disabled={!c.active}
              >
                <Plus className="h-3 w-3 text-white" />
                <span>Lançar</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border border-border bg-accent text-muted-foreground hover:bg-accent/80 rounded-lg px-3 py-1.5 font-bold text-[11px] uppercase tracking-wider transition-all"
                onClick={() => setHistoryFor(c)}
              >
                <Eye className="h-3 w-3 text-muted-foreground" /> Histórico
              </Button>
            </div>
            {!c.active && (
              <Button
                variant="outline"
                className="mt-2 w-full gap-2 border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg px-4 py-2 transition-all"
                onClick={() => deleteClientForever(c)}
              >
                <ShieldAlert className="h-4 w-4" /> Excluir definitivo
              </Button>
            )}
          </Card>
        ))}
      </div>

      {(newClientOpen || editClient) && (
        <ClientDialog
          client={editClient}
          open
          onClose={() => {
            setNewClientOpen(false);
            setEditClient(null);
          }}
        />
      )}
      {invoiceFor && (
        <InvoiceDialog
          client={invoiceFor}
          pending={pendingByClient.get(invoiceFor.id) ?? null}
          onClose={() => setInvoiceFor(null)}
        />
      )}
      {historyFor && (
        <HistoryDialog
          client={historyFor}
          pending={pendingByClient.get(historyFor.id) ?? null}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}

function ClientDialog({ client, open, onClose }: { client: Client | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: client?.name ?? "",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    color: client?.color ?? CLIENT_COLORS[0],
    uc_number: client?.uc_number ?? "",
    notes: client?.notes ?? "",
    discount_pct: client?.discount_pct ?? 30,
    public_lighting_value: client?.public_lighting_value ?? 0,
  });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!f.name.trim() || !f.uc_number.trim()) {
      toast.error("Nome e Número da UC são obrigatórios");
      return;
    }
    setSaving(true);
    const payload = {
      name: f.name.trim(),
      phone: f.phone || null,
      email: f.email || null,
      color: f.color,
      uc_number: f.uc_number.trim(),
      notes: f.notes || null,
      discount_pct: Number(f.discount_pct),
      public_lighting_value: Number(f.public_lighting_value),
    };
    const res = client
      ? await supabase.from("clients").update(payload).eq("id", client.id)
      : await supabase.from("clients").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success(client ? "Cliente atualizado" : "Cliente criado");
    qc.invalidateQueries({ queryKey: ["faturas-page"] });
    qc.invalidateQueries({ queryKey: ["relatorio-page"] });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card border-border text-foreground max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground dark:text-glow">
            {client ? "Editar Cliente" : "Novo Cliente"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-muted-foreground">Nome Completo *</Label>
            <Input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Ex: Pantera's Bar"
              className="bg-input border-border text-foreground"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-muted-foreground">Telefone</Label>
              <Input
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
                placeholder="(00) 00000-0000"
                className="bg-input border-border text-foreground"
              />
            </div>
            <div>
              <Label className="text-muted-foreground">E-mail</Label>
              <Input
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
                placeholder="email@exemplo.com"
                className="bg-input border-border text-foreground"
              />
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground">Cor do Cliente</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {CLIENT_COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setF({ ...f, color: col })}
                  className={`h-8 w-8 rounded-full ring-offset-2 transition-all ${
                    f.color === col ? "ring-2 ring-foreground scale-110" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: col }}
                />
              ))}
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground">Número da UC *</Label>
            <Input
              value={f.uc_number}
              onChange={(e) => setF({ ...f, uc_number: e.target.value })}
              placeholder="Ex: 303007001223"
              className="bg-input border-border text-foreground"
            />
          </div>
          <div>
            <Label className="text-muted-foreground">Observações</Label>
            <Textarea
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Opcional"
              className="bg-input border-border text-foreground"
            />
          </div>
          <div>
            <Label className="text-muted-foreground">Desconto (%) *</Label>
            <Input
              type="number"
              value={f.discount_pct}
              onChange={(e) => setF({ ...f, discount_pct: Number(e.target.value) })}
              placeholder="Ex: 30"
              className="bg-input border-border text-foreground"
            />
          </div>
          <div>
            <Label className="text-muted-foreground">Iluminação Pública (Valor Fixo) *</Label>
            <Input
              type="number"
              step="0.01"
              value={f.public_lighting_value}
              onChange={(e) => setF({ ...f, public_lighting_value: Number(e.target.value) })}
              placeholder="Ex: 26.36"
              className="bg-input border-border text-foreground"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground">
            {saving ? "Salvando..." : client ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDialog({
  client,
  invoice,
  pending,
  onClose,
}: {
  client: Client;
  invoice?: Invoice;
  pending?: PendingImport | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [f, setF] = useState({
    reference_month: invoice?.reference_date?.slice(0, 7) ?? currentMonth,
    consumption_kw: invoice ? String(invoice.consumption_kw) : "",
    price_kw: invoice ? invoiceExactPrice(invoice.notes, invoice.price_kw) : "",
    public_lighting: String(client.public_lighting_value || 0),
    interest_fine: invoice ? String(invoice.interest_fine) : "0",
    value_without_plant: invoice ? String(invoice.value_without_plant) : "0",
    client_pays: invoice ? String(invoice.client_pays) : "",
    distributor_invoice: invoice ? String(invoice.distributor_invoice) : "0",
    notes: stripPaymentTag(invoice?.notes),
    attachment_url: invoice?.attachment_url ?? "",
    payment_status: invoicePaymentStatus(invoice?.notes) as "pago" | "pendente",
    due_date: invoiceDueDate(invoice?.notes),
  });

  useEffect(() => {
    if (invoice) {
      setF({
        reference_month: invoice.reference_date.slice(0, 7),
        consumption_kw: String(invoice.consumption_kw),
        price_kw: invoiceExactPrice(invoice.notes, invoice.price_kw),
        public_lighting: String(client.public_lighting_value || 0),
        interest_fine: String(invoice.interest_fine),
        value_without_plant: String(invoice.value_without_plant),
        client_pays: String(invoice.client_pays),
        distributor_invoice: String(invoice.distributor_invoice),
        notes: stripPaymentTag(invoice.notes),
        attachment_url: invoice.attachment_url ?? "",
        payment_status: invoicePaymentStatus(invoice.notes),
        due_date: invoiceDueDate(invoice.notes),
      });
    }
  }, [invoice, client.public_lighting_value]);

  // Lançamento novo com fatura aguardando importação: pré-preenche com os dados extraídos do PDF.
  useEffect(() => {
    if (invoice || !pending) return;
    const { value_without_plant, client_pays } = calculateValues(
      String(pending.consumption_kw),
      pending.price_kw_exact || String(pending.price_kw),
      String(pending.public_lighting),
      String(pending.interest_fine),
      pending.reference_date.slice(0, 7),
    );
    setF({
      reference_month: pending.reference_date.slice(0, 7),
      consumption_kw: String(pending.consumption_kw),
      price_kw: pending.price_kw_exact || String(pending.price_kw),
      public_lighting: String(pending.public_lighting),
      interest_fine: String(pending.interest_fine),
      value_without_plant,
      client_pays,
      distributor_invoice: String(pending.distributor_invoice),
      notes: "",
      attachment_url: pending.attachment_url ?? "",
      payment_status: "pago",
      due_date: pending.due_date ?? "",
    });
  }, [pending, invoice]);

  const parseNum = (value: string | number) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;

    const normalized = String(value).trim().replace(/\s/g, "");
    if (!normalized) return 0;

    // Entradas pt-BR usam vírgula decimal; valores vindos do banco usam ponto decimal.
    const decimalValue = normalized.includes(",")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized;
    const parsed = Number(decimalValue);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmtBR = (n: number) =>
    n.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 10,
      useGrouping: false,
    });

  const usesPostOctober2026Formula = (referenceMonth: string) =>
    referenceMonth >= "2026-10";

  const computeRaw = (
    consumption: string,
    price: string,
    lighting: string,
    fine: string,
    referenceMonth: string,
  ) => {
    const c = parseNum(consumption);
    const p = parseNum(price);
    const l = parseNum(lighting);
    const j = parseNum(fine);
    const discount = (client.discount_pct ?? 30) / 100;
    const baseWithoutFine = c * p + l;

    if (usesPostOctober2026Formula(referenceMonth)) {
      return {
        sUsina: baseWithoutFine,
        cPaga: baseWithoutFine * (1 - discount) + j,
      };
    }

    const sUsina = baseWithoutFine + j;
    return { sUsina, cPaga: sUsina * (1 - discount) };
  };

  const calculateValues = (
    consumption: string,
    price: string,
    lighting: string,
    fine: string,
    referenceMonth: string,
  ) => {
    const { sUsina, cPaga } = computeRaw(
      consumption,
      price,
      lighting,
      fine,
      referenceMonth,
    );
    return {
      value_without_plant: fmtBR(sUsina),
      client_pays: fmtBR(cPaga),
    };
  };

  const handleCalcChange = (field: string, val: string) => {
    setF((prev) => {
      const next = { ...prev, [field]: val };
      const { value_without_plant, client_pays } = calculateValues(
        next.consumption_kw,
        next.price_kw,
        next.public_lighting,
        next.interest_fine,
        next.reference_month,
      );
      return { ...next, value_without_plant, client_pays };
    });
  };
  const handleReferenceMonthChange = (referenceMonth: string) => {
    setF((prev) => {
      const next = { ...prev, reference_month: referenceMonth };
      const { value_without_plant, client_pays } = calculateValues(
        next.consumption_kw,
        next.price_kw,
        next.public_lighting,
        next.interest_fine,
        referenceMonth,
      );
      return { ...next, value_without_plant, client_pays };
    });
  };

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!f.reference_month) {
      toast.error("Selecione o mês de referência");
      return;
    }
    if (!f.consumption_kw || !f.price_kw || !f.client_pays) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }
    setSaving(true);
    const { sUsina, cPaga } = computeRaw(
      f.consumption_kw,
      f.price_kw,
      f.public_lighting,
      f.interest_fine,
      f.reference_month,
    );
    const payload = {
      client_id: client.id,
      uc_number: client.uc_number,
      reference_date: `${f.reference_month}-01`,
      consumption_kw: parseNum(f.consumption_kw),
      price_kw: parseNum(f.price_kw),
      public_lighting: parseNum(f.public_lighting || "0"),
      interest_fine: parseNum(f.interest_fine || "0"),
      value_without_plant: sUsina,
      client_pays: cPaga,
      distributor_invoice: parseNum(f.distributor_invoice || "0"),
      notes: withPaymentTag(f.notes, f.payment_status, f.due_date, f.price_kw),
      attachment_url: f.attachment_url || null,
    };
    const { error } = invoice
      ? await supabase.from("invoices").update(payload).eq("id", invoice.id)
      : await supabase.from("invoices").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (!invoice && pending) {
      const { error: pendingError } = await supabase
        .from("pending_invoice_imports")
        .update({ status: "imported" })
        .eq("id", pending.id);
      if (pendingError) toast.error("Fatura lançada, mas não consegui marcar a pendência como importada");
    }
    toast.success(invoice ? "Fatura atualizada" : "Fatura lançada");
    qc.invalidateQueries({ queryKey: ["faturas-page"] });
    qc.invalidateQueries({ queryKey: ["relatorio-page"] });
    onClose();
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const filePath = `${client.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("faturas_v3_privado_v2")
        .upload(filePath, file);
      if (uploadError) throw uploadError;
      setF((prev) => ({ ...prev, attachment_url: filePath }));
      toast.success("Arquivo anexado!");
    } catch (err: any) {
      toast.error("Erro ao subir arquivo: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card border-border text-foreground max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{invoice ? "Editar Fatura" : "Lançar Fatura"} — {client.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Mês de referência *</Label>
            <Input
              type="month"
              value={f.reference_month}
              onChange={(e) => handleReferenceMonthChange(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Consumo (kW) *</Label>
              <Input
                value={f.consumption_kw}
                onChange={(e) => handleCalcChange("consumption_kw", e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Preço kW *</Label>
              <Input
                value={f.price_kw}
                onChange={(e) => handleCalcChange("price_kw", e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Iluminação pública</Label>
              <Input
                value={Number(f.public_lighting || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                readOnly
                disabled
                title="Definido nas configurações do cliente"
                className="mt-1 bg-accent text-muted-foreground"
              />
            </div>
            <div>
              <Label>Juros/Multa</Label>
              <Input
                value={f.interest_fine}
                onChange={(e) => handleCalcChange("interest_fine", e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Valor S/ Usina</Label>
              <Input value={f.value_without_plant} readOnly disabled className="mt-1 bg-accent text-muted-foreground" />
            </div>
            <div>
              <Label>Cliente paga ({client.discount_pct ?? 30}% desc.)</Label>
              <Input value={f.client_pays} readOnly disabled className="mt-1 bg-accent text-muted-foreground" />
            </div>
          </div>
          <div>
            <Label>Fat. Concessionária</Label>
            <Input
              value={f.distributor_invoice}
              onChange={(e) => setF((prev) => ({ ...prev, distributor_invoice: e.target.value }))}
              className="mt-1"
            />
          </div>

          <div className="rounded-xl border border-border bg-accent/40 p-4 space-y-3">
            <Label className="text-foreground font-semibold">Status de pagamento</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setF((prev) => ({ ...prev, payment_status: "pago" }))}
                className={`h-9 px-4 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-all ${
                  f.payment_status === "pago"
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-background border-border text-muted-foreground hover:border-emerald-500"
                }`}
              >
                Pago
              </button>
              <button
                type="button"
                onClick={() => setF((prev) => ({ ...prev, payment_status: "pendente" }))}
                className={`h-9 px-4 rounded-lg text-[11px] font-bold uppercase tracking-wider border transition-all ${
                  f.payment_status === "pendente"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-background border-border text-muted-foreground hover:border-amber-500"
                }`}
              >
                Pendente
              </button>
            </div>
            <div>
              <Label>Venc. Fatura</Label>
              <Input
                type="date"
                value={f.due_date}
                onChange={(e) => setF((prev) => ({ ...prev, due_date: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea
              value={f.notes}
              onChange={(e) => setF((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Opcional"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Anexar Fatura / Comprovante</Label>
            <div className="mt-2 flex items-center gap-3">
              <Button variant="outline" type="button" className="gap-2 relative" disabled={uploading} asChild>
                <label className="cursor-pointer">
                  <Paperclip className="h-4 w-4" />
                  {uploading ? "Enviando..." : f.attachment_url ? "Trocar arquivo" : "Selecionar arquivo"}
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </label>
              </Button>
              {f.attachment_url && (
                <button
                  type="button"
                  onClick={() => setF((prev) => ({ ...prev, attachment_url: "" }))}
                  className="text-xs text-red-500 hover:underline"
                >
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground">
            {saving ? "Salvando..." : invoice ? "Salvar alterações" : "Lançar fatura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  client,
  pending,
  onClose,
}: {
  client: Client;
  pending?: PendingImport | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["client-invoices", client.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("client_id", client.id)
        .order("reference_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });
  const [launching, setLaunching] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);

  const totalClient = invoices.reduce((s, i) => s + Number(i.client_pays), 0);
  const totalDistributor = invoices.reduce((s, i) => s + Number(i.distributor_invoice), 0);
  const netProfit = totalClient - totalDistributor;

  async function deleteInvoice(inv: Invoice) {
    if (!window.confirm(`Excluir fatura de ${monthLabelFromISO(inv.reference_date)}?`)) return;
    const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
    if (error) return toast.error(error.message);
    toast.success("Fatura excluída");
    qc.invalidateQueries({ queryKey: ["client-invoices", client.id] });
    qc.invalidateQueries({ queryKey: ["faturas-page"] });
    qc.invalidateQueries({ queryKey: ["relatorio-page"] });
  }

  return (
    <>
      <Dialog open={!launching && !editing} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico — {client.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Card className="p-4 border-none shadow-sm bg-accent">
              <div className="text-xs font-medium text-muted-foreground">Cliente pagou</div>
              <div className="mt-1 text-xl font-bold text-emerald-500">{brl(totalClient)}</div>
            </Card>
            <Card className="p-4 border-none shadow-sm bg-accent">
              <div className="text-xs font-medium text-muted-foreground">Fat. Concessionária</div>
              <div className="mt-1 text-xl font-bold text-negative">{brl(totalDistributor)}</div>
            </Card>
            <Card className="p-4 border-none shadow-sm bg-accent">
              <div className="text-xs font-medium text-muted-foreground">Lucro Bruto</div>
              <div className="mt-1 text-xl font-bold text-emerald-500">{brl(netProfit)}</div>
            </Card>
          </div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-positive">
              <TrendingUp className="h-4 w-4" /> Histórico de Faturas
            </div>
            <Button
              className="gap-2 text-white"
              style={{ backgroundColor: client.color }}
              onClick={() => setLaunching(true)}
              disabled={!client.active}
            >
              <Plus className="h-4 w-4" /> Lançar Fatura
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
            ) : invoices.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma fatura lançada.</p>
            ) : (
              <table className="w-full text-[12px] table-fixed">
                <thead className="sticky top-0 bg-accent">
                  <tr className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-1.5 py-1.5 text-left font-semibold w-[15%]">Mês</th>
                    <th className="px-1.5 py-1.5 text-right font-semibold w-[10%]">Consumo</th>
                    <th className="px-1.5 py-1.5 text-right font-semibold w-[12%]">S/ Usina</th>
                    <th className="px-1.5 py-1.5 text-right font-semibold w-[13%]">Cliente</th>
                    <th className="px-1.5 py-1.5 text-right font-semibold text-[#D64545] w-[13%]">Concession.</th>
                    <th className="px-1.5 py-1.5 text-right font-semibold text-emerald-500 w-[12%]">Lucro</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold w-[6%]">Anexo</th>
                    <th className="px-1.5 py-1.5 text-center font-semibold w-[11%]">Status</th>
                    <th className="w-[8%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const lucro = Number(inv.client_pays) - Number(inv.distributor_invoice);
                    return (
                      <tr key={inv.id} className="border-t border-border hover:bg-accent even:bg-accent/30">
                        <td className="py-2 px-1.5 truncate font-medium">{monthLabelFromISO(inv.reference_date)}</td>
                        <td className="py-2 px-1.5 text-right text-muted-foreground tabular-nums">
                          {Number(inv.consumption_kw).toLocaleString("pt-BR")}
                        </td>
                        <td className="py-2 px-1.5 text-right tabular-nums">{brl(Number(inv.value_without_plant))}</td>
                        <td className="py-2 px-1.5 text-right text-emerald-500 tabular-nums">{brl(Number(inv.client_pays))}</td>
                        <td className="py-2 px-1.5 text-right text-negative tabular-nums">{brl(Number(inv.distributor_invoice))}</td>
                        <td className="py-2 px-1.5 text-right font-semibold text-emerald-500 tabular-nums">{brl(lucro)}</td>
                        <td className="py-2 px-1 text-center">
                          {inv.attachment_url ? <Paperclip className="h-3.5 w-3.5 mx-auto text-muted-foreground" /> : "—"}
                        </td>
                        <td className="py-2 px-1 text-center">
                          {invoicePaymentStatus(inv.notes) === "pago" ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-800">Pago</span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">Pend.</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setEditing(inv)}
                              className="p-1.5 text-muted-foreground hover:text-foreground"
                              title="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => deleteInvoice(inv)}
                              className="p-1.5 text-muted-foreground hover:text-red-500"
                              title="Excluir"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {launching && (
        <InvoiceDialog
          client={client}
          pending={pending ?? null}
          onClose={() => { setLaunching(false); qc.invalidateQueries({ queryKey: ["client-invoices", client.id] }); }}
        />
      )}
      {editing && (
        <InvoiceDialog
          client={client}
          invoice={editing}
          onClose={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["client-invoices", client.id] });
          }}
        />
      )}
    </>
  );
}
