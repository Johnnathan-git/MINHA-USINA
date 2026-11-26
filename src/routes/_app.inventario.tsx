import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Box, TrendingUp, Hammer, Package, FileText, Eye, Loader2, Paperclip } from "lucide-react";
import { PdfViewer } from "@/components/PdfViewer";
import { fetchInvoicePdf } from "@/lib/invoicePdf";
import { brl, formatDateBR } from "@/lib/format";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Asset = {
  id: string; item: string; location: string | null; category: string;
  brand: string | null; model: string | null; quantity: number; unit_value: number;
  acquired_on: string | null; serial_number: string | null; notes: string | null;
};
type InvExpense = {
  id: string; description: string; amount: number; spent_on: string; notes: string | null;
  responsible: string | null;
};

type PlantDoc = {
  id: string; title: string; doc_type: string; doc_date: string | null; notes: string | null;
  file_path: string; file_name: string | null; file_size: number | null; content_type: string | null;
  created_at: string;
};

const DOC_TYPES = ["Nota fiscal", "Contrato", "Garantia", "Projeto / ART", "Outro"];
const DOC_BUCKET = "faturas_v3_privado_v2";
const DOC_MAX_BYTES = 20 * 1024 * 1024;

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

const BASE_CATEGORIES = ["Placa Solar", "Inversor", "Equipamentos Elétricos"];
const RESPONSIBLES = ["John", "Jehn"];

const q = queryOptions({
  queryKey: ["inventario-page"],
  queryFn: async () => {
    const [a, e, d] = await Promise.all([
      supabase.from("inventory_assets").select("*").order("created_at", { ascending: false }),
      supabase
        .from("investment_expenses")
        .select("*")
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("plant_documents")
        .select("*")
        .order("doc_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ]);
    if (a.error) throw a.error;
    if (e.error) throw e.error;
    return {
      assets: (a.data ?? []) as Asset[],
      expenses: (e.data ?? []) as InvExpense[],
      // Sem a tabela (migration não aplicada) a aba fica vazia em vez de quebrar a página.
      docs: (d.error ? [] : (d.data ?? [])) as PlantDoc[],
    };
  },
});

export const Route = createFileRoute("/_app/inventario")({
  ssr: false,
  component: Page,
  head: () => ({
    meta: [
      { title: "Inventário — Usina dos Irmãos" },
      { name: "description", content: "Patrimônio, equipamentos e gastos de instalação." },
      { property: "og:title", content: "Inventário — Usina dos Irmãos" },
      { property: "og:description", content: "Patrimônio, equipamentos e gastos de instalação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Page() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <Inventario />
    </Suspense>
  );
}

function Inventario() {
  const { data } = useSuspenseQuery(q);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["inventario-page"] });
  const [tab, setTab] = useState("assets");
  const [assetOpen, setAssetOpen] = useState<Asset | true | null>(null);
  const [expenseOpen, setExpenseOpen] = useState<InvExpense | true | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [docOpen, setDocOpen] = useState(false);
  const [docView, setDocView] = useState<PlantDoc | null>(null);

  const totalAtivos = data.assets.reduce((s, a) => s + Number(a.unit_value) * a.quantity, 0);
  const totalGastos = data.expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalInvestido = totalAtivos + totalGastos;

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    data.assets.forEach(a => m.set(a.category, (m.get(a.category) ?? 0) + a.quantity));
    return [...m.entries()];
  }, [data.assets]);

  const filteredAssets = category === "all" ? data.assets : data.assets.filter(a => a.category === category);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h1 className="truncate text-4xl font-bold tracking-tight text-foreground">Inventário</h1>
          <p className="text-sm font-medium text-muted-foreground">Patrimônio, equipamentos e gastos de instalação</p>
        </div>
        {tab === "assets"
          ? <Button onClick={() => setAssetOpen(true)} className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 font-bold shadow-lg shadow-primary/20 sm:w-auto"><Plus className="h-4 w-4" /> Novo Item</Button>
          : tab === "docs"
            ? <Button onClick={() => setDocOpen(true)} className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 font-bold shadow-lg shadow-primary/20 sm:w-auto"><Plus className="h-4 w-4" /> Novo Documento</Button>
            : <Button onClick={() => setExpenseOpen(true)} className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 font-bold shadow-lg shadow-primary/20 sm:w-auto"><Plus className="h-4 w-4" /> Novo Gasto</Button>
        }
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="glass-card p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><TrendingUp className="h-4 w-4 text-primary" /> Total Investido</div>
          <div className="text-2xl font-bold text-foreground num-lg">{brl(totalInvestido)}</div>
          <div className="mt-1 text-[10px] text-muted-foreground font-medium uppercase tracking-tight">Ativos + Gastos</div>
        </Card>
        <Card className="glass-card p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-primary"><Box className="h-4 w-4" /> Valor em Ativos</div>
          <div className="text-2xl font-bold text-primary num-lg">{brl(totalAtivos)}</div>
        </Card>
        <Card className="glass-card p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Hammer className="h-4 w-4 text-muted-foreground" /> Gastos de Investimento</div>
          <div className="text-2xl font-bold text-foreground num-lg">{brl(totalGastos)}</div>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto bg-accent p-1 rounded-lg border border-border">
          <TabsTrigger value="assets" className="gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground font-bold text-muted-foreground"><Package className="h-4 w-4" /> Ativos / Equipamentos</TabsTrigger>
          <TabsTrigger value="expenses" className="gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground font-bold text-muted-foreground"><Hammer className="h-4 w-4" /> Gastos de Investimento</TabsTrigger>
          <TabsTrigger value="docs" className="gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground font-bold text-muted-foreground"><FileText className="h-4 w-4" /> Documentos</TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="mt-4">
          <Card className="glass-card p-6">
            <div className="mb-6 flex flex-wrap gap-2">
              <button onClick={() => setCategory("all")}
                className={`rounded-lg px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${category === "all" ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:bg-accent"}`}>
                Todos
              </button>
              {categories.map(([cat, count]) => (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`rounded-lg px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${category === cat ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:bg-accent"}`}>
                  {cat} ({count})
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Item</th>
                    <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Categoria</th>
                    <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Marca / Modelo</th>
                    <th className="pb-3 text-center font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Qtd</th>
                    <th className="pb-3 text-right font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Valor Unit.</th>
                    <th className="pb-3 text-right font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map(a => (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-accent transition-colors zebra-stripe">
                      <td className="py-4">
                        <div className="font-bold text-foreground">{a.item}</div>
                        {a.location && <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">{a.location}</div>}
                      </td>
                      <td className="py-4"><span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">{a.category}</span></td>
                      <td className="py-4 text-muted-foreground font-medium">{[a.brand, a.model].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="py-4 text-center text-foreground font-bold num">{a.quantity}</td>
                      <td className="py-4 text-right text-foreground font-medium num">{brl(Number(a.unit_value))}</td>
                      <td className="py-4 text-right font-bold text-primary num">{brl(Number(a.unit_value) * a.quantity)}</td>
                      <td className="py-4 pl-4 text-right">
                        <button onClick={() => setAssetOpen(a)} className="mr-3 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => delRow("inventory_assets", a.id, refresh)} className="text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-accent">
                    <td colSpan={5} className="py-4 font-bold text-foreground uppercase text-[10px] tracking-wider px-4">Total Patrimônio</td>
                    <td className="py-4 text-right font-bold text-primary num px-4">{brl(totalAtivos)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <Card className="glass-card p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Descrição</th>
                  <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Data</th>
                  <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Responsável</th>
                  <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Observações</th>
                  <th className="pb-3 text-right font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map(e => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-accent transition-colors zebra-stripe">
                    <td className="py-4 font-bold text-foreground">{e.description}</td>
                    <td className="py-4 text-muted-foreground font-medium num">{formatDateBR(e.spent_on)}</td>
                    <td className="py-4 text-foreground font-bold"><span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">{e.responsible || "—"}</span></td>
                    <td className="py-4 text-muted-foreground italic">{e.notes || "—"}</td>
                    <td className="py-4 text-right font-bold text-foreground num">{brl(Number(e.amount))}</td>
                    <td className="py-4 pl-4 text-right">
                      <button onClick={() => setExpenseOpen(e)} className="mr-3 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => delRow("investment_expenses", e.id, refresh)} className="text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-accent">
                  <td colSpan={4} className="py-4 font-bold text-foreground uppercase text-[10px] tracking-wider px-4">Total Gastos</td>
                  <td className="py-4 text-right font-bold text-foreground num px-4">{brl(totalGastos)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            {data.expenses.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum gasto lançado.</p>}
          </Card>
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          <Card className="glass-card p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Documento</th>
                    <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Tipo</th>
                    <th className="pb-3 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Data</th>
                    <th className="pb-3 text-right font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Tamanho</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.docs.map(d => (
                    <tr key={d.id} className="border-b border-border last:border-0 hover:bg-accent transition-colors zebra-stripe">
                      <td className="py-4">
                        <button onClick={() => setDocView(d)} className="text-left font-bold text-foreground hover:text-primary transition-colors">{d.title}</button>
                        {d.notes && <div className="text-[11px] text-muted-foreground italic">{d.notes}</div>}
                      </td>
                      <td className="py-4"><span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">{d.doc_type}</span></td>
                      <td className="py-4 text-muted-foreground font-medium num">{d.doc_date ? formatDateBR(d.doc_date) : "—"}</td>
                      <td className="py-4 text-right text-muted-foreground font-medium num">{formatSize(d.file_size)}</td>
                      <td className="py-4 pl-4 text-right whitespace-nowrap">
                        <button onClick={() => setDocView(d)} className="mr-3 text-muted-foreground hover:text-foreground transition-colors" title="Ver documento"><Eye className="h-4 w-4" /></button>
                        <button onClick={() => deleteDoc(d, refresh)} className="text-muted-foreground hover:text-red-400 transition-colors" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.docs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum documento anexado. Use "Novo Documento" para guardar notas fiscais, contratos e garantias.</p>}
          </Card>
        </TabsContent>
      </Tabs>

      {docOpen && <DocDialog onClose={() => setDocOpen(false)} onSaved={refresh} />}
      {docView && <DocViewer doc={docView} onClose={() => setDocView(null)} />}
      {assetOpen && <AssetDialog asset={assetOpen === true ? null : assetOpen} onClose={() => setAssetOpen(null)} onSaved={refresh} />}
      {expenseOpen && <InvExpenseDialog expense={expenseOpen === true ? null : expenseOpen} onClose={() => setExpenseOpen(null)} onSaved={refresh} />}
    </div>
  );
}

async function delRow(table: "inventory_assets" | "investment_expenses", id: string, onDone: () => void) {
  if (!confirm("Excluir este registro?")) return;
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return toast.error(error.message);
  toast.success("Registro excluído");
  onDone();
}

function AssetDialog({ asset, onClose, onSaved }: { asset: Asset | null; onClose: () => void; onSaved: () => void }) {
  const [customCats, setCustomCats] = useState<string[]>([]);
  const [newCat, setNewCat] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [f, setF] = useState({
    item: asset?.item ?? "",
    location: asset?.location ?? "Usina",
    category: asset?.category ?? "Placa Solar",
    brand: asset?.brand ?? "",
    model: asset?.model ?? "",
    quantity: asset ? String(asset.quantity) : "1",
    unit_value: asset ? String(asset.unit_value) : "",
    acquired_on: asset?.acquired_on ?? "",
    serial_number: asset?.serial_number ?? "",
    notes: asset?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const categories = [...new Set([...BASE_CATEGORIES, ...customCats, ...(f.category ? [f.category] : [])])];
  async function submit() {
    if (!f.item.trim()) return toast.error("Informe o item");
    setSaving(true);
    const payload = {
      item: f.item.trim(),
      location: f.location || null,
      category: f.category,
      brand: f.brand || null,
      model: f.model || null,
      quantity: Number(f.quantity) || 1,
      unit_value: Number(f.unit_value) || 0,
      acquired_on: f.acquired_on || null,
      serial_number: f.serial_number || null,
      notes: f.notes || null,
    };
    const res = asset
      ? await supabase.from("inventory_assets").update(payload).eq("id", asset.id)
      : await supabase.from("inventory_assets").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success("Item salvo");
    onSaved();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card border-border text-foreground max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="text-foreground text-glow">{asset ? "Editar Item" : "Novo Item"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-muted-foreground">Nome do Item *</Label>
            <Input value={f.item} onChange={e => setF({ ...f, item: e.target.value })} className="bg-accent border-border text-foreground" />
          </div>
          <div>
            <Label className="text-muted-foreground">Categoria *</Label>
            {addingCat ? (
              <div className="flex gap-2">
                <Input autoFocus value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Nova categoria" className="bg-accent border-border text-foreground" />
                <Button type="button" variant="outline" onClick={() => {
                  const v = newCat.trim();
                  if (!v) return setAddingCat(false);
                  setCustomCats(c => [...c, v]);
                  setF({ ...f, category: v });
                  setNewCat(""); setAddingCat(false);
                }} className="border-border text-foreground hover:bg-accent">OK</Button>
              </div>
            ) : (
              <select
                className="flex h-9 w-full rounded-md border border-border bg-accent px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50"
                value={f.category}
                onChange={e => {
                  if (e.target.value === "__new") { setAddingCat(true); return; }
                  setF({ ...f, category: e.target.value });
                }}
              >
                {categories.map(c => <option key={c} value={c} className="bg-popover text-foreground">{c}</option>)}
                <option value="__new" className="bg-popover text-primary">+ Cadastrar nova categoria…</option>
              </select>
            )}
          </div>
          <div><Label className="text-muted-foreground">Localização</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Marca</Label><Input value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Modelo</Label><Input value={f.model} onChange={e => setF({ ...f, model: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Quantidade *</Label><Input type="number" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Valor Unitário (R$) *</Label><Input type="number" step="0.01" value={f.unit_value} onChange={e => setF({ ...f, unit_value: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Data de Aquisição</Label><Input type="date" value={f.acquired_on} onChange={e => setF({ ...f, acquired_on: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Número de Série</Label><Input value={f.serial_number} onChange={e => setF({ ...f, serial_number: e.target.value })} placeholder="Opcional" className="bg-accent border-border text-foreground" /></div>
          <div className="sm:col-span-2"><Label className="text-muted-foreground">Observações</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="Opcional" className="bg-accent border-border text-foreground" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border text-muted-foreground hover:text-foreground hover:bg-accent">Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold">{asset ? "Salvar" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvExpenseDialog({ expense, onClose, onSaved }: { expense: InvExpense | null; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    description: expense?.description ?? "",
    amount: expense ? String(expense.amount) : "",
    spent_on: expense?.spent_on ?? today,
    notes: expense?.notes ?? "",
    responsible: expense?.responsible ?? "",
  });
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!f.description.trim() || !f.amount || !f.spent_on) return toast.error("Preencha os campos obrigatórios");
    setSaving(true);
    const payload = {
      description: f.description.trim(),
      amount: Number(f.amount),
      spent_on: f.spent_on,
      notes: f.notes || null,
      responsible: f.responsible || null,
    };
    const res = expense
      ? await supabase.from("investment_expenses").update(payload).eq("id", expense.id)
      : await supabase.from("investment_expenses").insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success("Gasto salvo");
    onSaved();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card border-border text-foreground max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="text-foreground text-glow">{expense ? "Editar Gasto" : "Novo Gasto de Investimento"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label className="text-muted-foreground">Descrição *</Label><Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Ex: Cimento, Arame, Mão de obra..." className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Valor (R$) *</Label><Input type="number" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div><Label className="text-muted-foreground">Data *</Label><Input type="date" value={f.spent_on} onChange={e => setF({ ...f, spent_on: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div className="sm:col-span-2">
            <Label className="text-muted-foreground">Responsável</Label>
            <select
              className="flex h-9 w-full rounded-md border border-border bg-accent px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50"
              value={f.responsible}
              onChange={e => setF({ ...f, responsible: e.target.value })}
            >
              <option value="" className="bg-popover text-foreground">Selecione…</option>
              {RESPONSIBLES.map(r => <option key={r} value={r} className="bg-popover text-foreground">{r}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><Label className="text-muted-foreground">Observações</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="Opcional" className="bg-accent border-border text-foreground" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border text-muted-foreground hover:text-foreground hover:bg-accent">Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold">{expense ? "Salvar" : "Cadastrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
async function deleteDoc(d: PlantDoc, onDone: () => void) {
  if (!confirm(`Excluir o documento "${d.title}"? O arquivo também será apagado.`)) return;
  const { error } = await supabase.from("plant_documents").delete().eq("id", d.id);
  if (error) return toast.error(error.message);
  await supabase.storage.from(DOC_BUCKET).remove([d.file_path]);
  toast.success("Documento excluído");
  onDone();
}

function DocDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: "", doc_type: "Nota fiscal", doc_date: "", notes: "" });
  const [saving, setSaving] = useState(false);

  function pickFile(next: File | null) {
    if (next && next.size > DOC_MAX_BYTES) {
      toast.error("Arquivo muito grande (máximo 20 MB).");
      return;
    }
    setFile(next);
    if (next && !f.title.trim()) setF((v) => ({ ...v, title: next.name.replace(/\.[^.]+$/, "") }));
  }

  async function submit() {
    if (!file) return toast.error("Escolha o arquivo");
    if (!f.title.trim()) return toast.error("Informe o nome do documento");
    setSaving(true);
    const ext = (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "pdf").toLowerCase();
    const path = `documentos/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const up = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (up.error) {
      setSaving(false);
      return toast.error(`Arquivo não subiu: ${up.error.message}`);
    }
    const { error } = await supabase.from("plant_documents").insert({
      title: f.title.trim(),
      doc_type: f.doc_type,
      doc_date: f.doc_date || null,
      notes: f.notes.trim() || null,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type || null,
    });
    setSaving(false);
    if (error) {
      await supabase.storage.from(DOC_BUCKET).remove([path]);
      return toast.error(error.message);
    }
    toast.success("Documento salvo");
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card border-border text-foreground max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="text-foreground text-glow">Novo Documento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-muted-foreground">Arquivo (PDF ou foto) *</Label>
            <Button variant="outline" type="button" className="mt-1 w-full justify-start gap-2 border-border" asChild>
              <label className="cursor-pointer">
                <Paperclip className="h-4 w-4" />
                <span className="truncate">{file ? `${file.name} (${formatSize(file.size)})` : "Selecionar arquivo"}</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                />
              </label>
            </Button>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-muted-foreground">Nome do documento *</Label>
            <Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Ex.: NF compra de 20 placas" className="bg-accent border-border text-foreground" />
          </div>
          <div>
            <Label className="text-muted-foreground">Tipo</Label>
            <select
              className="flex h-9 w-full rounded-md border border-border bg-accent px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50"
              value={f.doc_type}
              onChange={e => setF({ ...f, doc_type: e.target.value })}
            >
              {DOC_TYPES.map(t => <option key={t} value={t} className="bg-popover text-foreground">{t}</option>)}
            </select>
          </div>
          <div><Label className="text-muted-foreground">Data do documento</Label><Input type="date" value={f.doc_date} onChange={e => setF({ ...f, doc_date: e.target.value })} className="bg-accent border-border text-foreground" /></div>
          <div className="sm:col-span-2"><Label className="text-muted-foreground">Observações</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="Opcional" className="bg-accent border-border text-foreground" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border text-muted-foreground hover:text-foreground hover:bg-accent">Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocViewer({ doc, onClose }: { doc: PlantDoc; onClose: () => void }) {
  const [state, setState] = useState<{ url: string | null; type: string; error: string | null }>({ url: null, type: "", error: null });
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await fetchInvoicePdf(doc.file_path, { name: doc.file_name ?? undefined });
        url = URL.createObjectURL(blob);
        if (!cancelled) setState({ url, type: doc.content_type || blob.type, error: null });
      } catch (e) {
        if (!cancelled) setState({ url: null, type: "", error: "Não foi possível abrir o documento. " + ((e as Error)?.message || "") });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc]);
  const isImage = state.type.startsWith("image/");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="glass-card border-border text-foreground max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>{doc.title}</DialogTitle></DialogHeader>
        {state.error ? (
          <p className="text-sm text-red-500">{state.error}</p>
        ) : state.url ? (
          <div className="space-y-3">
            {isImage
              ? <img src={state.url} alt={doc.title} className="max-h-[70vh] w-full rounded border border-border object-contain bg-white" />
              : <PdfViewer url={state.url} />}
            <a href={state.url} download={doc.file_name || "documento"} className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
              <Paperclip className="h-3.5 w-3.5" /> Baixar arquivo
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando documento...
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
