import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchInvoicePdf } from "@/lib/invoicePdf";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { brl, monthLabelFromISO } from "@/lib/format";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Paperclip, CheckCircle2, Clock, AlertCircle, FileSpreadsheet, BarChart3 } from "lucide-react";
import { EconomiaGerada } from "@/components/EconomiaGerada";

type Invoice = {
  id: string; client_id: string; reference_date: string; uc_number: string;
  consumption_kw: number; price_kw: number; public_lighting: number;
  interest_fine: number; value_without_plant: number; client_pays: number;
  attachment_url: string | null; notes: string | null;
};
type Client = { id: string; name: string; phone: string | null; discount_pct: number; color: string };

function paymentStatus(notes: string | null | undefined): "pago" | "pendente" {
  if (notes?.includes("[[status:pendente]]")) return "pendente";
  return "pago";
}
function dueDateFromNotes(notes: string | null | undefined): string {
  const m = (notes || "").match(/\[\[due:(\d{4}-\d{2}-\d{2})\]\]/);
  return m?.[1] ?? "";
}

function exactPriceFromNotes(notes: string | null | undefined, fallback: number): number {
  const raw = (notes || "").match(/\[\[price_kw_exact:([^\]]+)\]\]/)?.[1]?.trim();
  if (!raw) return Number(fallback);
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number(fallback);
}

function formatDueShortBR(iso: string): string {
  if (!iso || iso.length < 10) return "";
  const [y, mo, d] = iso.slice(0, 10).split("-");
  return `${d}/${mo}`;
}

const q = queryOptions({
  queryKey: ["relatorio-page"],
  staleTime: 2 * 60_000,
  queryFn: async () => {
    const [i, c, sess] = await Promise.all([
      supabase
        .from("invoices")
        .select("id,client_id,reference_date,uc_number,consumption_kw,price_kw,public_lighting,interest_fine,value_without_plant,client_pays,attachment_url,notes")
        .order("reference_date", { ascending: false }),
      supabase.from("clients").select("id,name,phone,discount_pct,color").order("name"),
      supabase.auth.getSession(),
    ]);
    if (i.error) throw i.error;
    if (c.error) throw c.error;
    let restrictedClientId: string | null = null;
    const uid = sess.data.session?.user?.id;
    if (uid) {
      const [{ data: link }, { data: roles }] = await Promise.all([
        supabase.from("user_clients").select("client_id").eq("user_id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);
      const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
      if (!isAdmin && link?.client_id) restrictedClientId = link.client_id as string;
    }
    return {
      invoices: (i.data ?? []) as Invoice[],
      clients: (c.data ?? []) as Client[],
      restrictedClientId,
    };
  },
});

export const Route = createFileRoute("/_app/relatorio")({
  ssr: false,
  component: Page,
  head: () => ({
    meta: [
      { title: "Controle Cliente — Usina dos Irmãos" },
      { name: "description", content: "Monte, edite e envie a planilha mensal de economia para cada cliente." },
      { property: "og:title", content: "Controle Cliente — Usina dos Irmãos" },
      { property: "og:description", content: "Monte, edite e envie a planilha mensal de economia para cada cliente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Page() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <Relatorio />
    </Suspense>
  );
}

type Row = {
  id: string; mes: string; uc: string; consumo: string; preco: string;
  ilum: string; juros: string; semUsina: string; comDesconto: string;
  attachment_url?: string | null;
  notes?: string | null;
  payment: "pago" | "pendente";
  due: string;
};

const numBR = (n: number, d = 2) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

function toRow(inv: Invoice, client?: Client): Row {
  const discountPct = client?.discount_pct ?? 30;
  const discountFactor = discountPct / 100;
  return {
    id: inv.id,
    mes: monthLabelFromISO(inv.reference_date).toLowerCase(),
    uc: inv.uc_number ?? "",
    consumo: numBR(Number(inv.consumption_kw), 0),
    preco: exactPriceFromNotes(inv.notes, inv.price_kw).toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 10,
    }),
    ilum: brl(Number(inv.public_lighting)),
    juros: brl(Number(inv.interest_fine)),
    semUsina: brl(Number(inv.value_without_plant)),
    comDesconto: brl(Number(inv.value_without_plant) * (1 - discountFactor)),
    attachment_url: inv.attachment_url,
    notes: inv.notes,
    payment: paymentStatus(inv.notes),
    due: dueDateFromNotes(inv.notes),
  };
}

function Relatorio() {
  const { data } = useSuspenseQuery(q);
  const locked = data.restrictedClientId;
  const clients = data.clients.filter((c) => !locked || c.id === locked);
  const [clientId, setClientId] = useState<string>(locked ?? clients[0]?.id ?? "");
  const [months, setMonths] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [section, setSection] = useState<"controle" | "economia">("controle");

  const client = clients.find((c) => c.id === clientId);
  const clientInvoices = useMemo(
    () => data.invoices.filter((i) => i.client_id === clientId),
    [data.invoices, clientId],
  );
  const monthOptions = useMemo(
    () => [...new Set(clientInvoices.map((i) => i.reference_date.slice(0, 7)))].sort().reverse(),
    [clientInvoices],
  );

  useEffect(() => {
    if (months.length === 0 && monthOptions.length > 0) {
      setMonths([monthOptions[0]]);
    }
  }, [monthOptions]);

  const selected = useMemo(
    () => data.invoices.filter((i) => i.client_id === clientId && months.includes(i.reference_date.slice(0, 7))),
    [data.invoices, clientId, months],
  );

  useEffect(() => {
    setRows(selected.map((s) => toRow(s, client)));
  }, [selected, client]);

  const pendingCount = clientInvoices.filter((inv) => paymentStatus(inv.notes) === "pendente").length;

  function edit(id: string, field: keyof Row, value: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="no-print grid gap-3 sm:flex sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Controle Cliente</h1>
          <p className="text-sm font-medium text-muted-foreground">
            Faturas, status de pagamento e economia gerada
          </p>
        </div>
      </div>

      <div className="no-print flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
        <button
          type="button"
          onClick={() => setSection("controle")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            section === "controle"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Controle Mensal
        </button>
        <button
          type="button"
          onClick={() => setSection("economia")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            section === "economia"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          Economia Gerada
        </button>
      </div>

      {section === "controle" ? (
        <>
      <Card className="no-print glass-card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cliente</div>
          <Select value={clientId} onValueChange={setClientId} disabled={!!locked}>
            <SelectTrigger className="bg-accent border-border rounded-lg text-foreground font-semibold"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id} className="font-semibold text-foreground">{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Meses</div>
          <div className="flex flex-wrap gap-2">
            {monthOptions.map((m) => {
              const on = months.includes(m);
              return (
                <button
                  key={m}
                  onClick={() => setMonths((ms) => (on ? ms.filter((x) => x !== m) : [...ms, m]))}
                  className={`rounded-lg border px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                    on ? "bg-primary border-primary text-primary-foreground shadow-sm light:bg-emerald-600 light:border-emerald-600 light:text-white" : "bg-card border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {monthLabelFromISO(`${m}-01`)}
                </button>
              );
            })}
            {monthOptions.length === 0 && <p className="text-sm text-muted-foreground">Sem faturas para este cliente.</p>}
          </div>
        </div>
      </Card>

      {clientInvoices.length > 0 && (
        <div className="no-print grid grid-cols-2 gap-2 sm:gap-3">
          <Card className="glass-card p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border-border">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Clock className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pendentes</p>
              <p className="text-sm font-bold text-amber-700 tabular-nums">{pendingCount} {pendingCount === 1 ? "fatura" : "faturas"}</p>
            </div>
          </Card>
          <Card className="glass-card p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border-border">
            <div className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full ${pendingCount > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
              <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Situação</p>
              <p className={`text-sm font-bold ${pendingCount > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {pendingCount > 0 ? "Há pendências" : "Tudo em dia"}
              </p>
            </div>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden glass-card p-0">
        <div className="px-8 py-2 text-center border-b border-white/10 bg-blue-600/30 relative overflow-hidden light:border-blue-700 light:bg-[#1E3A8A]">
          <div className="relative z-10">
            <div className="text-base font-black uppercase tracking-[0.4em] text-white sm:text-lg">
              {client?.name ?? "—"}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
          <table className="w-full min-w-[780px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-white/5 light:bg-transparent light:border-b light:border-border">
                {["Mês referência", "Consumo (kW)", "Preço kW", "Ilum. pública", "Juros", "Pagamento", "Venc. Fatura", "Valor S/ Usina", `Valor COM ${client?.discount_pct ?? 30}% DESC`, "Baixar"].map((h) => (
                  <th
                    key={h}
                    className="border border-border px-1.5 py-2 text-center font-semibold text-muted-foreground uppercase text-[11px] tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent light:hover:bg-blue-50/50 transition-colors">
                  {(["mes", "consumo", "preco", "ilum", "juros"] as const).map((fld) => (
                    <td
                      key={fld}
                      className={`border border-border p-0 ${
                        fld === "preco" ? "min-w-[5.75rem]" : fld === "ilum" || fld === "juros" ? "min-w-[5.25rem]" : ""
                      }`}
                    >
                      <Input
                        value={r[fld]}
                        onChange={(e) => edit(r.id, fld, e.target.value)}
                        className="num h-9 rounded-none border-0 bg-transparent text-center text-[13px] font-medium text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 w-full whitespace-nowrap overflow-visible px-1"
                      />
                    </td>
                  ))}
                  <td className="border border-border p-1 text-center align-middle">
                    <div className="flex flex-col items-center justify-center gap-0.5 py-1">
                      {r.payment === "pago" ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[13px] font-medium uppercase tracking-wide text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" /> Pago
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[13px] font-medium uppercase tracking-wide text-amber-800">
                          <Clock className="h-3 w-3" /> Pendente
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="border border-border p-0">
                    <Input
                      value={r.due ? formatDueShortBR(r.due) : "—"}
                      readOnly
                      className="num h-9 rounded-none border-0 bg-transparent text-center text-[13px] font-medium text-foreground shadow-none focus-visible:ring-0 w-full whitespace-nowrap overflow-visible px-1"
                    />
                  </td>
                  {(["semUsina", "comDesconto"] as const).map((fld) => (
                    <td key={fld} className="border border-border p-0 min-w-[6.75rem]">
                      <Input
                        value={r[fld]}
                        readOnly
                        className={`num h-9 min-w-[6.5rem] rounded-none border-0 bg-transparent text-center shadow-none focus-visible:ring-0 w-full whitespace-nowrap overflow-visible px-1 text-[13px] font-medium ${
                          fld === "comDesconto"
                            ? "text-primary light:text-emerald-600"
                            : "text-red-400"
                        }`}
                      />
                    </td>
                  ))}
                  <td className="border border-border p-0 text-center align-middle">
                    {r.attachment_url ? (
                      <button
                        onClick={async () => {
                          try {
                            const path = r.attachment_url!;
                            const name = path.split("/").pop() || "fatura.pdf";
                            const blob = await fetchInvoicePdf(path, { name, disposition: "attachment" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = name;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            setTimeout(() => URL.revokeObjectURL(url), 10_000);
                          } catch (err: any) {
                            alert("Erro ao abrir arquivo: " + err.message);
                          }
                        }}
                        className="flex h-9 w-full items-center justify-center gap-2 text-primary hover:bg-primary/5 transition-colors font-medium text-[11px] uppercase tracking-wide"
                      >
                        <Paperclip className="h-3 w-3" />
                        <span className="hidden sm:inline">Baixar</span>
                      </button>
                    ) : (
                      <div className="flex h-9 w-full items-center justify-center text-muted-foreground">
                        <Paperclip className="h-4 w-4 opacity-30" />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-20 text-center text-muted-foreground font-medium italic">
                    Selecione os meses acima para gerar o relatório.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="border-t border-border bg-accent px-8 py-3 flex flex-wrap justify-between items-center gap-2">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {rows.length} {rows.length === 1 ? "mês selecionado" : "meses selecionados"}
            </div>
          </div>
        )}
      </Card>
        </>
      ) : (
        <EconomiaGerada />
      )}
    </div>
  );
}
