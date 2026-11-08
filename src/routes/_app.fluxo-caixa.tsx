import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Pencil,
  Trash2,
  Landmark,
  History,
  Search,
} from "lucide-react";
import { brl, monthLabel, monthLabelLong, formatDateBR, EXPENSE_CATEGORIES, initial } from "@/lib/format";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Invoice = {
  id: string;
  client_id: string;
  reference_date: string;
  client_pays: number;
  distributor_invoice: number;
  notes: string | null;
};

type Expense = {
  id: string;
  reference_date: string;
  category: string;
  description: string;
  amount: number;
  notes: string | null;
  installment_group?: string | null;
  installment_no?: number | null;
  installment_total?: number | null;
  attachment_path?: string | null;
};

/** Envio de uma despesa da usina no WhatsApp (tabela expense_whatsapp_queue). */
type ExpenseWhatsAppQueue = {
  id: string;
  expense_id: string;
  message_text: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
};

type Client = { id: string; name: string; color: string };

type BankHistoryEntry = {
  id: string;
  at: string;
  kind: "ajuste" | "entrada" | "saida";
  description: string;
  amount: number;
  balanceAfter: number;
};

type BankState = {
  initialized: boolean;
  balance: number;
  invoiceSnapshot: Record<string, number>;
  expenseSnapshot: Record<string, number>;
  adjustedAt: string | null;
  history: BankHistoryEntry[];
};

type BankMovement = {
  kind: "entrada" | "saida";
  description: string;
  amount: number;
};

const BANK_STORAGE_KEY = "usinadosirmaos:bank-account:v1";
const BANK_EXPENSE_CATEGORY = "__SISTEMA__";
const BANK_EXPENSE_DESCRIPTION = "__CONTA_BANCARIA__";
const EXPENSE_CATEGORY_DESCRIPTION_PREFIX = "__CATEGORIA_DESPESA__:";
const EMPTY_BANK_STATE: BankState = {
  initialized: false,
  balance: 0,
  invoiceSnapshot: {},
  expenseSnapshot: {},
  adjustedAt: null,
  history: [],
};

function isInvoicePaid(notes: string | null | undefined): boolean {
  return !notes?.includes("[[status:pendente]]");
}

function withInvoicePaymentStatus(
  notes: string | null | undefined,
  status: "pago" | "pendente",
): string | null {
  const cleaned = (notes || "")
    .replace(/\[\[status:(pago|pendente)\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tag = status === "pendente" ? "[[status:pendente]]" : "";
  const out = [cleaned, tag].filter(Boolean).join(" ").trim();
  return out || null;
}

function expensePaymentStatus(notes: string | null | undefined): "pago" | "pendente" {
  return notes?.includes("[[status:pendente]]") ? "pendente" : "pago";
}

function stripExpensePaymentTag(notes: string | null | undefined): string {
  return (notes || "").replace(/\[\[status:(pago|pendente)\]\]/g, "").trim();
}

function withExpensePaymentTag(
  notes: string | null | undefined,
  status: "pago" | "pendente",
): string | null {
  const cleaned = stripExpensePaymentTag(notes);
  const tag = status === "pendente" ? "[[status:pendente]]" : "";
  const out = [cleaned, tag].filter(Boolean).join(" ").trim();
  return out || null;
}

function getPaidInvoiceMap(invoices: Invoice[]): Record<string, number> {
  return Object.fromEntries(
    invoices
      .filter((invoice) => isInvoicePaid(invoice.notes))
      .map((invoice) => [
        invoice.id,
        Number(invoice.client_pays) - Number(invoice.distributor_invoice),
      ]),
  );
}

function getPaidExpenseMap(expenses: Expense[]): Record<string, number> {
  return Object.fromEntries(
    expenses
      .filter((expense) => expensePaymentStatus(expense.notes) === "pago")
      .map((expense) => [expense.id, Number(expense.amount)]),
  );
}

function mapTotal(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + Number(value || 0), 0);
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function isBankStateExpense(expense: Expense): boolean {
  return expense.category === BANK_EXPENSE_CATEGORY && expense.description === BANK_EXPENSE_DESCRIPTION;
}

function isExpenseCategoryRecord(expense: Expense): boolean {
  return expense.category === BANK_EXPENSE_CATEGORY &&
    expense.description.startsWith(EXPENSE_CATEGORY_DESCRIPTION_PREFIX);
}

function isSystemExpense(expense: Expense): boolean {
  return expense.category === BANK_EXPENSE_CATEGORY;
}

function expenseCategoryNameFromRecord(expense: Expense): string | null {
  if (!isExpenseCategoryRecord(expense)) return null;
  const name = expense.description.slice(EXPENSE_CATEGORY_DESCRIPTION_PREFIX.length).trim();
  return name || null;
}

function bankStateFromExpense(expense: Pick<Expense, "amount" | "notes"> | null): BankState | null {
  if (!expense) return null;
  try {
    const meta = JSON.parse(expense.notes || "{}") as Partial<BankState>;
    return {
      initialized: Boolean(meta.initialized),
      balance: Number(expense.amount || 0),
      invoiceSnapshot: meta.invoiceSnapshot ?? {},
      expenseSnapshot: meta.expenseSnapshot ?? {},
      adjustedAt: meta.adjustedAt ?? null,
      history: Array.isArray(meta.history) ? meta.history as BankHistoryEntry[] : [],
    };
  } catch {
    return null;
  }
}

function bankStateNotes(state: BankState): string {
  return JSON.stringify({
    initialized: state.initialized,
    invoiceSnapshot: state.invoiceSnapshot,
    expenseSnapshot: state.expenseSnapshot,
    adjustedAt: state.adjustedAt,
    history: state.history,
  });
}

function readBankState(): BankState {
  if (typeof window === "undefined") return EMPTY_BANK_STATE;
  try {
    const raw = window.localStorage.getItem(BANK_STORAGE_KEY);
    if (!raw) return EMPTY_BANK_STATE;
    const parsed = JSON.parse(raw) as Partial<BankState>;
    return {
      initialized: Boolean(parsed.initialized),
      balance: Number(parsed.balance || 0),
      invoiceSnapshot: parsed.invoiceSnapshot ?? {},
      expenseSnapshot: parsed.expenseSnapshot ?? {},
      adjustedAt: parsed.adjustedAt ?? null,
      history: Array.isArray(parsed.history) ? parsed.history as BankHistoryEntry[] : [],
    };
  } catch {
    return EMPTY_BANK_STATE;
  }
}

const fluxoQ = queryOptions({
  queryKey: ["fluxo-page"],
  staleTime: 30_000,
  queryFn: async () => {
    const [i, c, w] = await Promise.all([
      supabase.from("invoices").select("id,client_id,reference_date,client_pays,distributor_invoice,notes"),
      supabase.from("clients").select("id,name,color"),
      supabase
        .from("expense_whatsapp_queue")
        .select("id,expense_id,message_text,status,error,created_at,sent_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (i.error) throw i.error;
    if (c.error) throw c.error;
    // attachment_path só existe após aplicar a migration; sem ela, a página
    // segue sem o botão de envio (mesmo cuidado da página Faturas).
    let e = await supabase
      .from("expenses")
      .select("id,reference_date,category,description,amount,notes,installment_group,installment_no,installment_total,attachment_path")
      .order("reference_date", { ascending: false });
    if (e.error) {
      e = await supabase
        .from("expenses")
        .select("id,reference_date,category,description,amount,notes,installment_group,installment_no,installment_total")
        .order("reference_date", { ascending: false });
    }
    if (e.error) throw e.error;
    return {
      invoices: (i.data ?? []) as Invoice[],
      expenses: (e.data ?? []).map((x: any) => ({
        ...x,
        attachment_path: x.attachment_path ?? null,
      })) as Expense[],
      clients: (c.data ?? []) as Client[],
      expenseWaQueue: (w.error ? [] : (w.data ?? [])) as ExpenseWhatsAppQueue[],
    };
  },
});

export const Route = createFileRoute("/_app/fluxo-caixa")({
  ssr: false,
  component: Page,
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa — Usina dos Irmãos" },
      { name: "description", content: "Controle mensal de receitas e despesas." },
    ],
  }),
});

function Page() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <Fluxo />
    </Suspense>
  );
}

function Fluxo() {
  const { data } = useSuspenseQuery(fluxoQ);
  const qc = useQueryClient();
  const now = new Date();
  const [monthKey, setMonthKey] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [newOpen, setNewOpen] = useState(false);
  const [edit, setEdit] = useState<Expense | null>(null);
  const [invoiceEdit, setInvoiceEdit] = useState<Invoice | null>(null);
  const [invoiceStatusSaving, setInvoiceStatusSaving] = useState(false);
  const [bank, setBank] = useState<BankState>(() => readBankState());
  const [bankOpen, setBankOpen] = useState(false);
  const [bankHistoryOpen, setBankHistoryOpen] = useState(false);
  const [bankValue, setBankValue] = useState("0.00");
  const [bankSaving, setBankSaving] = useState(false);
  const [expenseSearchOpen, setExpenseSearchOpen] = useState(false);
  const [expenseSearchName, setExpenseSearchName] = useState("");
  const [expenseSearchCategory, setExpenseSearchCategory] = useState("all");
  const [expenseSearchValue, setExpenseSearchValue] = useState("");
  const [expenseSearchStatus, setExpenseSearchStatus] = useState<"all" | "pago" | "pendente">("all");

  useEffect(() => {
    let active = true;

    async function loadBankState() {
      const local = readBankState();
      const { data: savedRows, error } = await supabase
        .from("expenses")
        .select("id,amount,notes")
        .eq("category", BANK_EXPENSE_CATEGORY)
        .eq("description", BANK_EXPENSE_DESCRIPTION)
        .limit(1);

      if (!active || error) return;

      const saved = bankStateFromExpense((savedRows?.[0] as Pick<Expense, "amount" | "notes"> | undefined) ?? null);
      if (saved) {
        try {
          window.localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(saved));
        } catch {
          // O banco continua sendo a fonte principal.
        }
        setBank(saved);
        return;
      }

      if (local.initialized) {
        const { error: syncError } = await supabase.from("expenses").insert({
          reference_date: new Date().toISOString().slice(0, 10),
          category: BANK_EXPENSE_CATEGORY,
          description: BANK_EXPENSE_DESCRIPTION,
          amount: local.balance,
          notes: bankStateNotes(local),
        });
        if (!syncError && active) {
          setBank(local);
          void qc.invalidateQueries({ queryKey: ["fluxo-page"] });
        }
      }
    }

    void loadBankState();
    return () => {
      active = false;
    };
  }, [qc]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (let i = -6; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    data.invoices.forEach((inv) => set.add(inv.reference_date.slice(0, 7)));
    data.expenses.filter((e) => !isSystemExpense(e)).forEach((e) => set.add(e.reference_date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [data]);

  const normalExpenses = data.expenses.filter((e) => !isSystemExpense(e));
  const expenseCategories = useMemo(() => {
    const names = new Map<string, string>();
    const add = (name: string | null | undefined) => {
      const trimmed = (name || "").trim();
      if (!trimmed) return;
      const key = trimmed.toLocaleLowerCase("pt-BR");
      if (!names.has(key)) names.set(key, trimmed);
    };

    EXPENSE_CATEGORIES.forEach(add);
    normalExpenses.forEach((expense) => add(expense.category));
    data.expenses.forEach((expense) => add(expenseCategoryNameFromRecord(expense)));

    return [...names.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [data.expenses]);
  const monthInvoices = data.invoices.filter((i) => i.reference_date.startsWith(monthKey));
  const monthExpenses = normalExpenses.filter((e) => e.reference_date.startsWith(monthKey));

  /** Último envio no WhatsApp de cada despesa (a fila vem ordenada por criação). */
  const expenseWaByExpense = useMemo(() => {
    const map = new Map<string, ExpenseWhatsAppQueue>();
    for (const row of data.expenseWaQueue) {
      if (!map.has(row.expense_id)) map.set(row.expense_id, row);
    }
    return map;
  }, [data.expenseWaQueue]);

  /** Mensagem que acompanha o boleto no grupo (o irmão paga a despesa). */
  function buildExpenseWhatsAppMessage(e: Expense): string {
    const isInternet = /internet/i.test(e.description);
    const label = isInternet
      ? "internet"
      : /agua|água/i.test(e.description)
        ? "água"
        : "energia";
    const noun = isInternet ? "o boleto" : "a fatura";
    const attachWord = isInternet ? "Boleto" : "Fatura";
    const [y, m] = e.reference_date.slice(0, 7).split("-").map(Number);
    const month = monthLabelLong(new Date(y, (m ?? 1) - 1, 1)).toLowerCase();
    const due = e.notes?.match(/\[\[due:(\d{4}-\d{2}-\d{2})\]\]/)?.[1] ?? null;
    const dueLine = due ? `\nVencimento: ${formatDateBR(due)}` : "";
    return `Segue ${noun} de ${label} da usina referente a ${month}.\nValor: ${brl(Number(e.amount))}${dueLine}\n${attachWord} em anexo para pagamento.`;
  }

  /** Coloca o boleto da despesa na fila para o grupo (o irmão paga). */
  async function queueExpenseWhatsApp(e: Expense) {
    if (!e.attachment_path) return toast.error("Esta despesa não tem boleto anexado.");
    const { error } = await supabase.from("expense_whatsapp_queue").insert({
      expense_id: e.id,
      message_text: buildExpenseWhatsAppMessage(e),
      attachment_path: e.attachment_path,
      status: "pending",
    });
    if (error) return toast.error(error.message);
    toast.success("Boleto na fila para envio no grupo.");
    qc.invalidateQueries({ queryKey: ["fluxo-page"] });
  }

  /** Volta um envio que falhou para a fila. */
  async function retryExpenseWhatsApp(id: string) {
    const { error } = await supabase
      .from("expense_whatsapp_queue")
      .update({ status: "pending", error: null, sent_at: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Envio voltou para a fila");
    qc.invalidateQueries({ queryKey: ["fluxo-page"] });
  }

  const normalizedExpenseSearchName = normalizeSearch(expenseSearchName);
  const parsedExpenseSearchValue = Number(expenseSearchValue.replace(",", "."));
  const hasExpenseSearchValue = expenseSearchValue.trim() !== "" && Number.isFinite(parsedExpenseSearchValue);
  const searchedExpenses = normalExpenses.filter((expense) => {
    const matchesName = !normalizedExpenseSearchName ||
      normalizeSearch(expense.description).includes(normalizedExpenseSearchName);
    const matchesCategory = expenseSearchCategory === "all" ||
      expense.category === expenseSearchCategory;
    const matchesValue = !hasExpenseSearchValue ||
      Math.abs(Number(expense.amount) - parsedExpenseSearchValue) < 0.005;
    const matchesStatus = expenseSearchStatus === "all" ||
      expensePaymentStatus(expense.notes) === expenseSearchStatus;
    return matchesName && matchesCategory && matchesValue && matchesStatus;
  });
  const searchedExpensesTotal = searchedExpenses.reduce(
    (sum, expense) => sum + Number(expense.amount),
    0,
  );
  const searchedExpensesPaidTotal = searchedExpenses
    .filter((expense) => expensePaymentStatus(expense.notes) === "pago")
    .reduce((sum, expense) => sum + Number(expense.amount), 0);

  const paidInvoices = monthInvoices.filter((i) => isInvoicePaid(i.notes));
  const lucroBruto = paidInvoices.reduce(
    (a, i) => a + (Number(i.client_pays) - Number(i.distributor_invoice)),
    0,
  );
  const paidMonthExpenses = monthExpenses.filter(
    (expense) => expensePaymentStatus(expense.notes) === "pago",
  );
  const totalDespesasPagas = paidMonthExpenses.reduce(
    (a, e) => a + Number(e.amount),
    0,
  );
  const lucro = lucroBruto - totalDespesasPagas;

  const currentPaidInvoices = getPaidInvoiceMap(data.invoices);
  const currentPaidExpenses = getPaidExpenseMap(normalExpenses);
  const receivedSinceAdjustment = bank.initialized
    ? mapTotal(currentPaidInvoices) - mapTotal(bank.invoiceSnapshot)
    : 0;
  const paidSinceAdjustment = bank.initialized
    ? mapTotal(currentPaidExpenses) - mapTotal(bank.expenseSnapshot)
    : 0;
  const bankBalance = bank.initialized
    ? bank.balance + receivedSinceAdjustment - paidSinceAdjustment
    : 0;

  async function persistBankState(next: BankState): Promise<boolean> {
    const { data: existingRows, error: findError } = await supabase
      .from("expenses")
      .select("id")
      .eq("category", BANK_EXPENSE_CATEGORY)
      .eq("description", BANK_EXPENSE_DESCRIPTION)
      .limit(1);

    if (findError) return false;

    const existingId = existingRows?.[0]?.id;
    const payload = {
      reference_date: new Date().toISOString().slice(0, 10),
      category: BANK_EXPENSE_CATEGORY,
      description: BANK_EXPENSE_DESCRIPTION,
      amount: next.balance,
      notes: bankStateNotes(next),
    };
    const result = existingId
      ? await supabase.from("expenses").update(payload).eq("id", existingId)
      : await supabase.from("expenses").insert(payload);

    if (result.error) return false;

    try {
      window.localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // O banco continua sendo a fonte principal.
    }
    setBank(next);
    return true;
  }

  async function appendBankMovement(movement: BankMovement) {
    if (!bank.initialized || !movement.amount) return;

    const signed = movement.kind === "entrada"
      ? Math.abs(movement.amount)
      : -Math.abs(movement.amount);
    const nextBalance = bankBalance + signed;
    const next: BankState = {
      ...bank,
      history: [
        ...bank.history,
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: movement.kind,
          description: movement.description,
          amount: signed,
          balanceAfter: nextBalance,
        },
      ],
    };
    await persistBankState(next);
  }

  const monthDate = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1);

  async function saveInvoicePaymentStatus(status: "pago" | "pendente") {
    if (!invoiceEdit || invoiceStatusSaving) return;
    const currentStatus = isInvoicePaid(invoiceEdit.notes) ? "pago" : "pendente";
    if (currentStatus === status) {
      setInvoiceEdit(null);
      return;
    }

    setInvoiceStatusSaving(true);
    const { error } = await supabase
      .from("invoices")
      .update({ notes: withInvoicePaymentStatus(invoiceEdit.notes, status) })
      .eq("id", invoiceEdit.id);
    setInvoiceStatusSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    if (bank.initialized) {
      const profit = Number(invoiceEdit.client_pays) - Number(invoiceEdit.distributor_invoice);
      const clientName = data.clients.find((client) => client.id === invoiceEdit.client_id)?.name ?? "Cliente";
      const movement: BankMovement = status === "pago"
        ? { kind: "entrada", description: `Fatura paga — ${clientName}`, amount: profit }
        : { kind: "saida", description: `Fatura voltou para pendente — ${clientName}`, amount: profit };
      await appendBankMovement(movement);
    }

    toast.success(status === "pago" ? "Fatura marcada como paga" : "Fatura marcada como pendente");
    setInvoiceEdit(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["fluxo-page"] }),
      qc.invalidateQueries({ queryKey: ["faturas-page"] }),
      qc.invalidateQueries({ queryKey: ["relatorio-page"] }),
      qc.invalidateQueries({ queryKey: ["client-invoices", invoiceEdit.client_id] }),
    ]);
  }

  function openBankAdjustment() {
    setBankValue((bank.initialized ? bankBalance : 0).toFixed(2));
    setBankOpen(true);
  }

  async function saveBankAdjustment() {
    const normalized = bankValue.trim().replace(/\./g, "").replace(",", ".");
    const directValue = Number(bankValue.replace(",", "."));
    const parsed = Number.isFinite(directValue) ? directValue : Number(normalized);
    if (!Number.isFinite(parsed)) {
      toast.error("Informe um saldo válido");
      return;
    }

    const nowIso = new Date().toISOString();
    const next: BankState = {
      initialized: true,
      balance: parsed,
      invoiceSnapshot: currentPaidInvoices,
      expenseSnapshot: currentPaidExpenses,
      adjustedAt: nowIso,
      history: [
        ...bank.history,
        {
          id: crypto.randomUUID(),
          at: nowIso,
          kind: "ajuste",
          description: "Ajuste manual de saldo",
          amount: parsed - bankBalance,
          balanceAfter: parsed,
        },
      ],
    };

    setBankSaving(true);
    const saved = await persistBankState(next);
    setBankSaving(false);

    if (!saved) {
      toast.error("Não foi possível salvar o saldo no banco. Tente novamente.");
      return;
    }

    setBankOpen(false);
    void qc.invalidateQueries({ queryKey: ["fluxo-page"] });
    toast.success("Saldo da conta bancária ajustado e salvo");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Fluxo de Caixa</h1>
          <p className="text-sm text-muted-foreground">Gestão de receitas e despesas operacionais</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={monthKey} onValueChange={setMonthKey}>
            <SelectTrigger className="w-36 bg-accent border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => {
                const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
                return (
                  <SelectItem key={m} value={m}>{monthLabel(d)}</SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => setExpenseSearchOpen(true)}
            className="gap-2"
          >
            <Search className="h-4 w-4" /> Buscar despesas
          </Button>
          <Button
            onClick={() => setNewOpen(true)}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            <Plus className="h-4 w-4" /> Nova Despesa
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="glass-card p-4" style={{ borderTop: "3px solid #2F6F62" }}>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-[#2F6F62]" /> Lucro bruto
          </div>
          <div className="text-2xl font-bold text-foreground num">{brl(lucroBruto)}</div>
        </Card>
        <Card className="glass-card p-4" style={{ borderTop: "3px solid #D64545" }}>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingDown className="h-3.5 w-3.5 text-[#D64545]" /> Total Despesas Pagas
          </div>
          <div className="text-2xl font-bold text-foreground num">{brl(totalDespesasPagas)}</div>
        </Card>
        <Card className="glass-card p-4" style={{ borderTop: "3px solid #2E5C8A" }}>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5 text-[#2E5C8A]" /> Lucro líquido do mês
          </div>
          <div className="text-2xl font-bold text-foreground num">{brl(lucro)}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Lucro bruto − Despesas pagas</div>
        </Card>
      </div>

      <Card className="glass-card p-4" style={{ borderTop: "3px solid #2563EB" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Landmark className="h-4 w-4 text-blue-600" /> Conta Bancária
            </div>
            <div className="text-3xl font-bold text-foreground num">{brl(bankBalance)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {bank.initialized
                ? `Saldo ajustado ${brl(bank.balance)} + recebidos ${brl(receivedSinceAdjustment)} − despesas pagas ${brl(paidSinceAdjustment)}`
                : "Saldo inicial zerado. Ajuste o saldo para começar a contabilizar a partir de agora."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBankHistoryOpen(true)} className="gap-2">
              <History className="h-4 w-4" /> Histórico
            </Button>
            <Button variant="outline" onClick={openBankAdjustment}>Ajustar saldo</Button>
          </div>
        </div>
      </Card>

      <Card className="glass-card p-4">
        <h2 className="mb-3 text-base font-semibold text-foreground">Faturas dos clientes</h2>
        {monthInvoices.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma fatura neste mês.</p>
        )}
        <div className="divide-y divide-border">
          {monthInvoices.map((inv) => {
            const profit = Number(inv.client_pays) - Number(inv.distributor_invoice);
            const client = data.clients.find((c) => c.id === inv.client_id);
            const paid = isInvoicePaid(inv.notes);
            return (
              <div
                key={inv.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: client?.color ?? "#64748B" }}
                  >
                    {initial(client?.name ?? "?")}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">
                        {client?.name ?? "—"}
                      </span>
                      {paid ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-emerald-800">Pago</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-800">Pendente</span>
                      )}
                      <button
                        aria-label="Editar fatura"
                        onClick={() => setInvoiceEdit(inv)}
                        className="p-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-xs text-muted-foreground">{monthLabel(monthDate)}</div>
                  </div>
                </div>
                <div className="text-left sm:text-right text-sm">
                  <div className="text-muted-foreground">
                    Lucro bruto: <span className="font-semibold text-primary num">{brl(profit)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Recebido: <span className="num">{brl(Number(inv.client_pays))}</span>
                    {" · "}
                    Conc.: <span className="num">{brl(Number(inv.distributor_invoice))}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="glass-card p-4">
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Despesas lançadas — {monthLabel(monthDate)}
        </h2>
        {monthExpenses.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma despesa neste mês.</p>
        )}
        <div className="space-y-2">
          {monthExpenses.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-accent/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-foreground truncate">{e.description}</div>
                  {expensePaymentStatus(e.notes) === "pago" ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-emerald-800">Pago</span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-800">Pendente</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                    {e.category}
                  </span>
                  {e.installment_total ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
                      Parcela {e.installment_no}/{e.installment_total}
                    </span>
                  ) : null}
                  {e.category === "Fatura Usina" && (
                    <>
                      {!e.attachment_path ? (
                        <span title="Sem boleto anexado" className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Sem boleto</span>
                      ) : expenseWaByExpense.get(e.id)?.status === "pending" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Na fila</span>
                      ) : expenseWaByExpense.get(e.id)?.status === "sent" ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Enviado no grupo</span>
                      ) : expenseWaByExpense.get(e.id)?.status === "failed" ? (
                        <button
                          onClick={() => retryExpenseWhatsApp(expenseWaByExpense.get(e.id)!.id)}
                          className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 hover:bg-red-200"
                          title={expenseWaByExpense.get(e.id)?.error ?? "Falha no envio"}
                        >
                          Falhou — Reenviar
                        </button>
                      ) : (
                        <button
                          onClick={() => queueExpenseWhatsApp(e)}
                          title="Enviar o boleto no grupo do WhatsApp para pagamento"
                          className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent"
                        >
                          <img src="/whatsapp-logo.svg" alt="" className="h-3 w-3" />
                          Enviar no grupo
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-red-500 num whitespace-nowrap">{brl(Number(e.amount))}</span>
                <button
                  aria-label="Editar"
                  onClick={() => setEdit(e)}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Excluir"
                  onClick={() => deleteExpense(
                    e,
                    () => qc.invalidateQueries({ queryKey: ["fluxo-page"] }),
                    appendBankMovement,
                  )}
                  className="p-1.5 text-muted-foreground hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {expenseSearchOpen && (
        <Dialog open onOpenChange={(open) => !open && setExpenseSearchOpen(false)}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Buscar despesas</DialogTitle>
            </DialogHeader>

            <Card className="border-border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Nome / descrição</Label>
                  <Input
                    value={expenseSearchName}
                    onChange={(event) => setExpenseSearchName(event.target.value)}
                    placeholder="Ex: Fatura energia, Reembolso John..."
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Categoria</Label>
                  <Select value={expenseSearchCategory} onValueChange={setExpenseSearchCategory}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as categorias</SelectItem>
                      {expenseCategories.map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Valor exato (R$)</Label>
                  <Input
                    value={expenseSearchValue}
                    onChange={(event) => setExpenseSearchValue(event.target.value)}
                    inputMode="decimal"
                    placeholder="Ex: 350,00"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Status</Label>
                  <Select
                    value={expenseSearchStatus}
                    onValueChange={(value) => setExpenseSearchStatus(value as "all" | "pago" | "pendente")}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="pago">Pago</SelectItem>
                      <SelectItem value="pendente">Pendente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <div className="text-xs text-muted-foreground">
                  A busca considera todo o histórico de despesas.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setExpenseSearchName("");
                    setExpenseSearchCategory("all");
                    setExpenseSearchValue("");
                    setExpenseSearchStatus("all");
                  }}
                >
                  Limpar filtros
                </Button>
              </div>
            </Card>

            <div className="space-y-2">
              {searchedExpenses.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma despesa encontrada com esses filtros.
                </p>
              ) : (
                searchedExpenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-foreground">
                          {expense.description}
                        </div>
                        {expensePaymentStatus(expense.notes) === "pago" ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-emerald-800">Pago</span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-800">Pendente</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                          {expense.category}
                        </span>
                        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {monthLabel(new Date(
                            Number(expense.reference_date.slice(0, 4)),
                            Number(expense.reference_date.slice(5, 7)) - 1,
                            1,
                          ))}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-red-500 num">
                      {brl(Number(expense.amount))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {searchedExpenses.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-accent/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground">
                  {searchedExpenses.length} {searchedExpenses.length === 1 ? "lançamento" : "lançamentos"}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span className="text-muted-foreground">
                    Somatória: <strong className="num text-foreground">{brl(searchedExpensesTotal)}</strong>
                  </span>
                  <span className="text-muted-foreground">
                    Total pago: <strong className="num text-emerald-700">{brl(searchedExpensesPaidTotal)}</strong>
                  </span>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setExpenseSearchOpen(false)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {(newOpen || edit) && (
        <ExpenseDialog
          expense={edit}
          categories={expenseCategories}
          onMovement={appendBankMovement}
          onClose={() => {
            setNewOpen(false);
            setEdit(null);
          }}
        />
      )}

      {invoiceEdit && (
        <Dialog open onOpenChange={(open) => !open && setInvoiceEdit(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Editar fatura</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {data.clients.find((c) => c.id === invoiceEdit.client_id)?.name ?? "Cliente"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {monthLabel(new Date(Number(invoiceEdit.reference_date.slice(0, 4)), Number(invoiceEdit.reference_date.slice(5, 7)) - 1, 1))}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-accent/40 p-4">
                <Label className="font-semibold text-foreground">Status de pagamento</Label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={invoiceStatusSaving}
                    onClick={() => saveInvoicePaymentStatus("pago")}
                    className={`h-9 rounded-lg border px-4 text-[11px] font-bold uppercase tracking-wider transition-all ${
                      isInvoicePaid(invoiceEdit.notes)
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-border bg-background text-muted-foreground hover:border-emerald-500"
                    }`}
                  >
                    Pago
                  </button>
                  <button
                    type="button"
                    disabled={invoiceStatusSaving}
                    onClick={() => saveInvoicePaymentStatus("pendente")}
                    className={`h-9 rounded-lg border px-4 text-[11px] font-bold uppercase tracking-wider transition-all ${
                      !isInvoicePaid(invoiceEdit.notes)
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-border bg-background text-muted-foreground hover:border-amber-500"
                    }`}
                  >
                    Pendente
                  </button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInvoiceEdit(null)}>Cancelar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {bankHistoryOpen && (
        <Dialog open onOpenChange={(open) => !open && setBankHistoryOpen(false)}>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Histórico — Conta Bancária</DialogTitle>
            </DialogHeader>
            {bank.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
            ) : (
              <div className="space-y-2">
                {[...bank.history].reverse().map((entry) => (
                  <div key={entry.id} className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{entry.description}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${
                          entry.kind === "entrada"
                            ? "bg-emerald-100 text-emerald-800"
                            : entry.kind === "saida"
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-700"
                        }`}>
                          {entry.kind}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {new Date(entry.at).toLocaleString("pt-BR")} · Saldo após: {brl(entry.balanceAfter)}
                      </div>
                    </div>
                    <div className={`shrink-0 text-sm font-semibold num ${
                      entry.amount > 0 ? "text-emerald-600" : entry.amount < 0 ? "text-red-500" : "text-muted-foreground"
                    }`}>
                      {entry.amount > 0 ? "+" : ""}{brl(entry.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setBankHistoryOpen(false)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {bankOpen && (
        <Dialog open onOpenChange={(open) => !open && setBankOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Ajustar saldo — Conta Bancária</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Informe o saldo real da conta agora. Tudo que já está pago antes deste ajuste será usado apenas como referência e não será contado novamente.
              </p>
              <div>
                <Label>Saldo atual (R$)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={bankValue}
                  onChange={(event) => setBankValue(event.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBankOpen(false)}>Cancelar</Button>
              <Button onClick={saveBankAdjustment} disabled={bankSaving}>
                {bankSaving ? "Salvando..." : "Confirmar saldo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

async function deleteExpense(
  e: Expense,
  onDone: () => void,
  onMovement: (movement: BankMovement) => Promise<void>,
) {
  const isParcel = Boolean(e.installment_group && (e.installment_total ?? 0) > 1);
  let refundedAmount = expensePaymentStatus(e.notes) === "pago" ? Number(e.amount) : 0;

  if (isParcel) {
    const all = confirm(
      `Esta é a parcela ${e.installment_no}/${e.installment_total}.\n\nOK = excluir TODAS as parcelas desta compra.\nCancelar = excluir somente esta parcela.`,
    );

    if (all) {
      const { data: groupRows, error: groupError } = await supabase
        .from("expenses")
        .select("amount,notes")
        .eq("installment_group", e.installment_group!);
      if (groupError) return toast.error(groupError.message);
      refundedAmount = (groupRows ?? []).reduce(
        (sum, row) => sum + (expensePaymentStatus(row.notes) === "pago" ? Number(row.amount) : 0),
        0,
      );
    }

    const q = all
      ? supabase.from("expenses").delete().eq("installment_group", e.installment_group!)
      : supabase.from("expenses").delete().eq("id", e.id);
    const { error } = await q;
    if (error) return toast.error(error.message);
    if (refundedAmount > 0) {
      await onMovement({
        kind: "entrada",
        description: all
          ? `Exclusão de parcelas pagas — ${e.description}`
          : `Exclusão de despesa paga — ${e.description}`,
        amount: refundedAmount,
      });
    }
    toast.success(all ? "Parcelas excluídas" : "Parcela excluída");
  } else {
    if (!confirm("Excluir esta despesa?")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", e.id);
    if (error) return toast.error(error.message);
    if (refundedAmount > 0) {
      await onMovement({
        kind: "entrada",
        description: `Exclusão de despesa paga — ${e.description}`,
        amount: refundedAmount,
      });
    }
    toast.success("Despesa excluída");
  }
  onDone();
}

function ExpenseDialog({
  expense,
  onClose,
  onMovement,
  categories,
}: {
  expense: Expense | null;
  onClose: () => void;
  onMovement: (movement: BankMovement) => Promise<void>;
  categories: string[];
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    reference_date: expense?.reference_date ?? today,
    category: expense?.category ?? categories[0] ?? EXPENSE_CATEGORIES[0],
    description: expense?.description ?? "",
    amount: expense ? String(expense.amount) : "",
    notes: stripExpensePaymentTag(expense?.notes),
    payment_status: expensePaymentStatus(expense?.notes),
  });
  const [installments, setInstallments] = useState(false);
  const [parcels, setParcels] = useState("2");
  const [mode, setMode] = useState<"parcela" | "total">("parcela");
  const [saving, setSaving] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [localCategories, setLocalCategories] = useState(categories);

  useEffect(() => {
    setLocalCategories(categories);
  }, [categories]);

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) {
      toast.error("Informe o nome da categoria");
      return;
    }

    const existing = localCategories.find(
      (category) => category.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
    );
    if (existing) {
      setF((prev) => ({ ...prev, category: existing }));
      setNewCategory("");
      setAddingCategory(false);
      return;
    }

    const { error } = await supabase.from("expenses").insert({
      reference_date: today,
      category: BANK_EXPENSE_CATEGORY,
      description: `${EXPENSE_CATEGORY_DESCRIPTION_PREFIX}${name}`,
      amount: 0,
      notes: "[[status:pendente]]",
    });
    if (error) {
      toast.error(error.message);
      return;
    }

    const nextCategories = [...localCategories, name].sort((a, b) => a.localeCompare(b, "pt-BR"));
    setLocalCategories(nextCategories);
    setF((prev) => ({ ...prev, category: name }));
    setNewCategory("");
    setAddingCategory(false);
    void qc.invalidateQueries({ queryKey: ["fluxo-page"] });
    toast.success("Categoria adicionada");
  }

  async function submit() {
    if (!f.description.trim() || !f.amount) {
      toast.error("Preencha descrição e valor");
      return;
    }
    setSaving(true);
    const previousStatus = expense ? expensePaymentStatus(expense.notes) : null;
    const previousAmount = expense ? Number(expense.amount) : 0;
    const payload = {
      reference_date: f.reference_date,
      category: f.category,
      description: f.description.trim(),
      amount: Number(f.amount),
      notes: withExpensePaymentTag(f.notes, f.payment_status),
    };
    let res;
    if (expense) {
      res = await supabase.from("expenses").update(payload).eq("id", expense.id);
    } else if (installments && Number(parcels) > 1) {
      const n = Math.min(120, Math.max(2, Math.round(Number(parcels))));
      const total = mode === "total" ? Number(f.amount) : Number(f.amount) * n;
      const base = Math.floor((total / n) * 100) / 100;
      const group = crypto.randomUUID();
      const [y, m] = f.reference_date.slice(0, 7).split("-").map(Number);
      const rows = Array.from({ length: n }, (_, i) => {
        const d = new Date(y, m - 1 + i, 1);
        const amount = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
        return {
          ...payload,
          amount,
          reference_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
          installment_group: group,
          installment_no: i + 1,
          installment_total: n,
        };
      });
      res = await supabase.from("expenses").insert(rows);
    } else {
      res = await supabase.from("expenses").insert(payload);
    }
    setSaving(false);
    if (res.error) return toast.error(res.error.message);

    const currentStatus = f.payment_status;
    let currentAmount = Number(f.amount);
    if (!expense && installments && Number(parcels) > 1) {
      const n = Math.min(120, Math.max(2, Math.round(Number(parcels))));
      currentAmount = mode === "total" ? Number(f.amount) : Number(f.amount) * n;
    }
    const previousEffect = previousStatus === "pago" ? -previousAmount : 0;
    const currentEffect = currentStatus === "pago" ? -currentAmount : 0;
    const movementDelta = currentEffect - previousEffect;
    if (movementDelta !== 0) {
      await onMovement({
        kind: movementDelta > 0 ? "entrada" : "saida",
        description: movementDelta > 0
          ? `Estorno/ajuste de despesa — ${f.description.trim()}`
          : `Despesa paga — ${f.description.trim()}`,
        amount: Math.abs(movementDelta),
      });
    }

    toast.success(
      expense
        ? "Despesa atualizada"
        : installments
          ? `${parcels} parcelas lançadas`
          : "Despesa lançada",
    );
    qc.invalidateQueries({ queryKey: ["fluxo-page"] });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{expense ? "Editar Despesa" : "Nova Despesa"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>{installments ? "Mês da 1ª parcela *" : "Mês de Referência *"}</Label>
            <Input
              type="month"
              value={f.reference_date.slice(0, 7)}
              onChange={(e) => setF({ ...f, reference_date: `${e.target.value}-01` })}
            />
          </div>
          <div>
            <Label>Categoria *</Label>
            <Select
              value={f.category}
              onValueChange={(v) => {
                if (v === "__ADD_CATEGORY__") {
                  setAddingCategory(true);
                  return;
                }
                setF({ ...f, category: v });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {localCategories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                <SelectItem value="__ADD_CATEGORY__">+ Adicionar categoria</SelectItem>
              </SelectContent>
            </Select>
            {addingCategory && (
              <div className="mt-2 flex gap-2">
                <Input
                  autoFocus
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addCategory();
                    }
                    if (e.key === "Escape") {
                      setAddingCategory(false);
                      setNewCategory("");
                    }
                  }}
                  placeholder="Nome da nova categoria"
                />
                <Button type="button" variant="outline" onClick={() => void addCategory()}>
                  Adicionar
                </Button>
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label>Descrição *</Label>
            <Input
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="Ex: Fatura CEMIG maio/25"
            />
          </div>
          {!expense && (
            <div className="rounded-xl border bg-muted/40 p-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-rose-500"
                  checked={installments}
                  onChange={(e) => setInstallments(e.target.checked)}
                />
                Compra parcelada (lançar parcelas futuras)
              </label>
              {installments && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Nº de parcelas *</Label>
                    <Input
                      type="number"
                      min={2}
                      max={120}
                      inputMode="numeric"
                      value={parcels}
                      onChange={(e) => setParcels(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>O valor informado é</Label>
                    <Select value={mode} onValueChange={(v) => setMode(v as "parcela" | "total")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="parcela">Valor de cada parcela</SelectItem>
                        <SelectItem value="total">Valor total da compra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Serão criados {parcels || 0} lançamentos mensais a partir do mês escolhido.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2">
            <Label>
              {installments
                ? mode === "total"
                  ? "Valor total (R$) *"
                  : "Valor da parcela (R$) *"
                : "Valor (R$) *"}
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </div>
          <div className="rounded-xl border border-border bg-accent/40 p-4 sm:col-span-2">
            <Label className="font-semibold text-foreground">Status de pagamento</Label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setF((prev) => ({ ...prev, payment_status: "pago" }))}
                className={`h-9 rounded-lg border px-4 text-[11px] font-bold uppercase tracking-wider transition-all ${
                  f.payment_status === "pago"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-border bg-background text-muted-foreground hover:border-emerald-500"
                }`}
              >
                Pago
              </button>
              <button
                type="button"
                onClick={() => setF((prev) => ({ ...prev, payment_status: "pendente" }))}
                className={`h-9 rounded-lg border px-4 text-[11px] font-bold uppercase tracking-wider transition-all ${
                  f.payment_status === "pendente"
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-border bg-background text-muted-foreground hover:border-amber-500"
                }`}
              >
                Pendente
              </button>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label>Observações</Label>
            <Textarea
              value={f.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
              placeholder="Opcional"
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-destructive hover:bg-destructive/90">
            {expense ? "Salvar" : installments ? "Lançar parcelas" : "Lançar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
