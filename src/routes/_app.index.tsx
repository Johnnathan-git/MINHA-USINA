import React, { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { brl, monthLabel, monthLabelLong, monthLabelFromISO, initial } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, Receipt, Users, Trophy, ArrowUpRight, ArrowDownRight, Briefcase, HandCoins } from "lucide-react";


type Invoice = {
  id: string;
  client_id: string;
  reference_date: string;
  client_pays: number;
  distributor_invoice: number;
  value_without_plant: number;
};
type Expense = { id: string; reference_date: string; amount: number; description: string; category: string; notes: string | null };
type Client = { id: string; name: string; color: string };

const DashboardPerformanceChart = React.lazy(() =>
  import("@/components/DashboardCharts").then((module) => ({
    default: module.DashboardPerformanceChart,
  })),
);
const DashboardSparkline = React.lazy(() =>
  import("@/components/DashboardCharts").then((module) => ({
    default: module.DashboardSparkline,
  })),
);

const dashboardQ = queryOptions({
  queryKey: ["dashboard"],
  queryFn: async () => {
    const [inv, exp, cli] = await Promise.all([
      supabase.from("invoices").select("id,client_id,reference_date,client_pays,distributor_invoice,value_without_plant"),
      supabase.from("expenses").select("id,reference_date,amount,description,category,notes"),
      supabase.from("clients").select("id,name,color").eq("active", true),
    ]);
    if (inv.error) throw inv.error;
    if (exp.error) throw exp.error;
    if (cli.error) throw cli.error;
    return {
      invoices: (inv.data ?? []) as Invoice[],
      expenses: (exp.data ?? []) as Expense[],
      clients: (cli.data ?? []) as Client[],
    };
  },
});

export const Route = createFileRoute("/_app/")({
  ssr: false,
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard — Usina dos Irmãos" },
      { name: "description", content: "Visão geral de receitas, despesas e lucro da Usina dos Irmãos." },
    ],
  }),
});

function DashboardPage() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <Dashboard />
    </Suspense>
  );
}

function invoiceProfit(i: Invoice) {
  return Number(i.client_pays) - Number(i.distributor_invoice);
}

// Rendimento do empréstimo das placas (115% do CDI, cofrinho Mercado Pago).
// O empréstimo foi de R$ 11.368,00 em 01/07/2026. O rendimento é
// calculado dia a dia (dias úteis) sobre o saldo devedor: o total
// menos os reembolsos já lançados, cada um abatido na sua data —
// por isso ele cai conforme os repasses. CDI mensal real (Banco
// Central, SGS 4391) nos meses fechados; no mês corrente e nos
// futuros, usa o CDI anual atual.
const CDI_ANNUAL = 0.1365; // 13,65% a.a. (nov/2026)
const MONTHLY_CDI: Record<string, number> = {
  "2026-07": 0.0122,
  "2026-08": 0.0109,
  "2026-09": 0.0108,
  "2026-10": 0.0107,
};
const HOLIDAYS = new Set([
  "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20",
  "2026-12-25", "2027-01-01", "2027-02-15", "2027-02-16", "2027-04-02",
  "2027-04-21", "2027-05-01", "2027-06-03", "2027-09-07", "2027-10-12",
  "2027-11-02", "2027-11-15", "2027-12-25",
]);

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function businessDaysInMonth(year: number, month: number): number {
  let n = 0;
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() !== 0 && d.getDay() !== 6 && !HOLIDAYS.has(isoDate(d))) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

function loanYield(total: number, reembolsos: Expense[], today: Date): number {
  const start = new Date(2026, 6, 1); // 01/07/2026
  const dailyRateCache = new Map<string, number>();
  const dailyRate = (d: Date): number => {
    const key = isoDate(d).slice(0, 7);
    const cached = dailyRateCache.get(key);
    if (cached != null) return cached;
    const monthly = MONTHLY_CDI[key];
    const rate = monthly != null
      ? (1 + monthly) ** (1.15 / businessDaysInMonth(d.getFullYear(), d.getMonth())) - 1
      : (1 + 1.15 * CDI_ANNUAL) ** (1 / 252) - 1;
    dailyRateCache.set(key, rate);
    return rate;
  };
  let balance = total;
  let yield_ = 0;
  let idx = 0;
  const d = new Date(start);
  while (d <= today) {
    while (idx < reembolsos.length && reembolsos[idx].reference_date <= isoDate(d)) {
      balance -= Number(reembolsos[idx].amount);
      idx++;
    }
    balance = Math.max(0, balance);
    if (d.getDay() !== 0 && d.getDay() !== 6 && !HOLIDAYS.has(isoDate(d))) {
      yield_ += balance * dailyRate(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return yield_;
}

function Dashboard() {
  const { data } = useSuspenseQuery(dashboardQ);
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const inMonth = (d: string, key: string) => d.startsWith(key);

  const receitaMes = data.invoices.filter(i => inMonth(i.reference_date, curKey))
    .reduce((a, i) => a + Number(i.client_pays), 0);
  const faturasDistMes = data.invoices.filter(i => inMonth(i.reference_date, curKey))
    .reduce((a, i) => a + Number(i.distributor_invoice), 0);
  const despesasOperMes = data.expenses.filter(e => inMonth(e.reference_date, curKey))
    .reduce((a, e) => a + Number(e.amount), 0);
  const despesasMes = despesasOperMes + faturasDistMes;
  const lucroMes = receitaMes - despesasMes;
  const lucroAno = data.invoices
    .filter(i => {
      const isThisYear = i.reference_date.startsWith(String(now.getFullYear()));
      const [year, month] = i.reference_date.split("-").map(Number);
      const refDate = new Date(year, month - 1, 1);
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      // Considera meses anteriores ou iguais ao mês atual
      return isThisYear && refDate <= currentMonthStart;
    })
    .reduce((a, i) => a + (Number(i.client_pays) - Number(i.distributor_invoice)), 0);

  const despesasOperAno = data.expenses
    .filter(e => {
      const isThisYear = e.reference_date.startsWith(String(now.getFullYear()));
      const [year, month] = e.reference_date.split("-").map(Number);
      const refDate = new Date(year, month - 1, 1);
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return isThisYear && refDate <= currentMonthStart;
    })
    .reduce((a, e) => a + Number(e.amount), 0);
  const lucroAnualReal = lucroAno - despesasOperAno;

  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const receitaPrev = data.invoices.filter(i => inMonth(i.reference_date, prevKey))
    .reduce((a, i) => a + Number(i.client_pays), 0);
  const despesasPrev =
    data.invoices.filter(i => inMonth(i.reference_date, prevKey)).reduce((a, i) => a + Number(i.distributor_invoice), 0) +
    data.expenses.filter(e => inMonth(e.reference_date, prevKey)).reduce((a, e) => a + Number(e.amount), 0);
  const lucroPrev = receitaPrev - despesasPrev;
  const delta = (cur: number, old: number) => (old === 0 ? null : ((cur - old) / Math.abs(old)) * 100);

  // last 12 months for historical context
  const months: { key: string; label: string; date: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: monthLabel(d),
      date: d,
    });
  }
  const allChartData = months.map(m => {
    const receita = data.invoices.filter(i => inMonth(i.reference_date, m.key))
      .reduce((a, i) => a + Number(i.client_pays), 0);
    const distribuidora = data.invoices.filter(i => inMonth(i.reference_date, m.key))
      .reduce((a, i) => a + Number(i.distributor_invoice), 0);
    const operacionais = data.expenses.filter(e => inMonth(e.reference_date, m.key))
      .reduce((a, e) => a + Number(e.amount), 0);
    const despesas = operacionais + distribuidora;
    return {
      month: m.label,
      Receita: receita,
      Despesas: despesas,
      Operacionais: operacionais,
      Concessionária: distribuidora,
      Lucro: receita - despesas,
    };
  });

  // performance chart usually shows last 6
  const chartData = allChartData.slice(-6);

  // ranking
  const profitByClient = new Map<string, number>();
  for (const i of data.invoices) {
    profitByClient.set(i.client_id, (profitByClient.get(i.client_id) ?? 0) + invoiceProfit(i));
  }
  const ranking = data.clients
    .map(c => ({ ...c, profit: profitByClient.get(c.id) ?? 0 }))
    .sort((a, b) => b.profit - a.profit);
  const maxProfit = Math.max(0.1, ...ranking.map(r => r.profit));

  // Reembolso das placas: adiantado em jul/2026 para placas de novos
  // clientes. O restante é o total menos as despesas de reembolso
  // lançadas manualmente todo mês. O reembolso é a despesa de
  // categoria "REEMBOLSO JOHN" (descrição "Pagamento John") — não
  // basta procurar "reembolso" na descrição: a descrição não tem
  // essa palavra, e a linha de sistema "__CATEGORIA_DESPESA__:"
  // (categoria __SISTEMA__, valor R$ 0) cairia na conta.
  const REEMBOLSO_PLACAS_TOTAL = 11368;
  const reembolsos = data.expenses
    .filter((e) => e.category !== "__SISTEMA__" && /reembolso/i.test(`${e.category} ${e.description ?? ""}`))
    .sort((a, b) => a.reference_date.localeCompare(b.reference_date));
  const reembolsado = reembolsos.reduce((a, e) => a + Number(e.amount), 0);
  const reembolsoRestante = Math.max(0, REEMBOLSO_PLACAS_TOTAL - reembolsado);
  const reembolsoPct = REEMBOLSO_PLACAS_TOTAL > 0
    ? Math.min(100, (reembolsado / REEMBOLSO_PLACAS_TOTAL) * 100)
    : 0;
  const rendimento = loanYield(REEMBOLSO_PLACAS_TOTAL, reembolsos, now);

  // monthly summary (last 6)
  const summary = [...chartData].reverse();

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm font-medium text-muted-foreground mt-1">Visão geral — {monthLabelLong(now)}</p>

      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-4 [&>*]:glass-card-interactive">
        <StatCard 
          icon={<TrendingUp className="h-4 w-4" />} 
          label="Receita Mensal" 
          value={receitaMes} 
          tint="leaf" 
          delta={delta(receitaMes, receitaPrev)} 
          sparkData={chartData.map(d => ({ value: d.Receita }))}
          delay={0}
        />
        <StatCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Despesas Mensais"
          value={despesasMes}
          tint="clay"
          invertDelta
          delta={delta(despesasMes, despesasPrev)}
          hint={`Operacionais ${brl(despesasOperMes)} + Concessionária ${brl(faturasDistMes)}`}
          sparkData={chartData.map(d => ({ value: d.Despesas }))}
          delay={60}
        />
        <StatCard 
          icon={<DollarSign className="h-4 w-4" />} 
          label="Lucro do Mês" 
          value={lucroMes} 
          tint="sky" 
          delta={delta(lucroMes, lucroPrev)} 
          sparkData={chartData.map(d => ({ value: d.Lucro }))}
          delay={120}
        />
        <StatCard 
          icon={<Briefcase className="h-4 w-4" />} 
          label="Lucro Acumulado (Ano)" 
          value={lucroAnualReal} 
          tint="amber" 
          sparkData={allChartData.map(d => ({ value: d.Lucro }))}
          delay={180}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="glass-card rounded-2xl p-6">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold text-foreground">Performance Financeira</h2>
              <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {[["Receita", "#2F6F62"], ["Despesas", "#D64545"], ["Lucro", "#2E5C8A"]].map(([k, c]) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                    {k}
                  </span>
                ))}
              </div>
            </div>
            <div className="-mx-2 overflow-x-auto px-2">
              <div className="h-72 min-w-[520px] sm:min-w-0">
                <Suspense
                  fallback={<div className="h-full w-full animate-pulse rounded-xl bg-accent/40" />}
                >
                  <DashboardPerformanceChart data={chartData} />
                </Suspense>
              </div>
            </div>
          </Card>

          <Card className="glass-card rounded-2xl p-6">
            <h2 className="mb-6 text-base font-bold text-foreground text-glow">Resumo de Lançamentos</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-4 text-left font-bold text-muted-foreground uppercase tracking-widest">Mês</th>
                    <th className="pb-4 text-right font-bold text-muted-foreground uppercase tracking-widest">Receita</th>
                    <th className="pb-4 text-right font-bold text-muted-foreground uppercase tracking-widest">Desp. Operacionais</th>
                    <th className="pb-4 text-right font-bold text-muted-foreground uppercase tracking-widest">Concessionária</th>
                    <th className="pb-4 text-right font-bold text-muted-foreground uppercase tracking-widest">Despesas</th>
                    <th className="pb-4 text-right font-bold text-muted-foreground uppercase tracking-widest">Lucro</th>

                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {summary.map(row => (
                    <tr key={row.month} className="hover:bg-accent/30 transition-colors">
                      <td className="py-4 text-foreground font-semibold">{row.month}</td>
                      <td className="num py-4 text-right font-medium text-foreground">{brl(row.Receita)}</td>
                      <td className="num py-4 text-right text-muted-foreground">{brl(row.Operacionais)}</td>
                      <td className="num py-4 text-right text-muted-foreground">{brl(row.Concessionária)}</td>
                      <td className="num py-4 text-right font-medium text-foreground">{brl(row.Despesas)}</td>
                      <td className={cn(
                        "num py-4 text-right font-bold",
                        row.Lucro >= 0 ? "text-[#2F6F62] light:text-emerald-600" : "text-[#D64545]"
                      )}>
                        {brl(row.Lucro)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>


        <div className="space-y-6">
          <Card className="glass-card rounded-2xl p-6">
            <div className="mb-6 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground tracking-tight text-glow">Ranking — Clientes Mais Lucrativos</h2>
            </div>
            <div className="space-y-4">
              {ranking.map((c, idx) => (
                <div 
                  key={c.id} 
                  className="flex items-center gap-3 p-2 rounded-lg transition-colors"
                >
                  <span className="w-5 text-right text-xs text-muted-foreground font-medium">{idx + 1}</span>
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                    style={{ backgroundColor: c.color }}
                  >
                    {initial(c.name)}
                  </div>
                  <div className="flex-1">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground">{c.name}</span>
                      <span className="num text-xs font-bold text-foreground">{brl(c.profit)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent/50">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(0, (c.profit / maxProfit) * 100)}%`, backgroundColor: `${c.color}B3` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {ranking.length === 0 && <p className="text-xs text-muted-foreground">Nenhum cliente cadastrado.</p>}
            </div>
          </Card>

          <Card className="glass-card rounded-2xl p-6">
            <div className="mb-1 flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground tracking-tight text-glow">Reembolso das placas</h2>
            </div>
            <p className="text-xs text-muted-foreground">Adiantado em jul/2026 para placas de novos clientes.</p>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Restante a receber</div>
                <div className="mt-1 text-2xl font-bold text-foreground num-lg">{brl(reembolsoRestante)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rendimento 115% CDI</div>
                <div className="mt-1 text-2xl font-bold text-[#2F6F62] num-lg">{brl(rendimento)}</div>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Desde 01/07/2026, sobre o saldo devedor — cai conforme os repasses.</p>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-accent/50">
              <div
                className="h-full rounded-full bg-[#2F6F62]"
                style={{ width: `${reembolsoPct}%` }}
              />
            </div>
            <div className="mt-4 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total adiantado</span>
                <span className="num font-semibold text-foreground">{brl(REEMBOLSO_PLACAS_TOTAL)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Já reembolsado</span>
                <span className="num font-semibold text-foreground">{brl(reembolsado)}</span>
              </div>
            </div>
            {reembolsos.length > 0 ? (
              <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
                {reembolsos.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-muted-foreground">{monthLabelFromISO(e.reference_date)} — {e.description}</span>
                    <span className="num shrink-0 font-semibold text-foreground">{brl(Number(e.amount))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">Nenhum reembolso lançado ainda.</p>
            )}
          </Card>

          <Card className="glass-card rounded-2xl p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/30 text-muted-foreground">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total de Clientes</div>
                <div className="text-xl font-bold text-foreground">{data.clients.length}</div>
              </div>
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, tint, hint, delta, invertDelta, sparkData, delay
}: {
  icon: React.ReactElement<any>; label: string; value: number; tint: "leaf" | "clay" | "sky" | "amber";
  hint?: string; delta?: number | null; invertDelta?: boolean; sparkData?: { value: number }[]; delay?: number;
}) {
  const semanticColor = 
    tint === "leaf" ? "#2F6F62" : 
    tint === "clay" ? "#D64545" : 
    tint === "sky" ? "#2E5C8A" : 
    tint === "amber" ? "#C98A3E" :
    "#64748B";
  
  const iconBg = 
    tint === "leaf" ? "bg-[#2F6F62]/10" : 
    tint === "clay" ? "bg-[#D64545]/10" : 
    tint === "sky" ? "bg-[#2E5C8A]/10" : 
    tint === "amber" ? "bg-[#C98A3E]/10" :
    "bg-slate-100";
  
  const styledIcon = React.cloneElement(icon, {
    className: cn(icon.props.className),
    style: { color: semanticColor }
  });

  const good = delta == null ? null : invertDelta ? delta <= 0 : delta >= 0;
  
  return (
    <Card 
      className="glass-card relative overflow-hidden rounded-2xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both"
      style={{ 
        animationDelay: `${delay}ms`
      }}
    >
      {sparkData && (
        <div className="absolute inset-0 z-0 opacity-10 pointer-events-none">
          <Suspense fallback={null}>
            <DashboardSparkline data={sparkData} color={semanticColor} />
          </Suspense>
        </div>
      )}

      <div className="relative z-10">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg shadow-sm border border-border/50", iconBg)}>
            {styledIcon}
          </div>
          {delta != null && Number.isFinite(delta) && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold border",
                good ? "bg-[#2F6F62]/10 text-[#2F6F62] border-[#2F6F62]/20" : "bg-[#D64545]/10 text-[#D64545] border-[#D64545]/20"
              )}
            >
              {delta >= 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
              {Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-bold leading-none num-lg text-foreground">
          {brl(value)}
        </div>
        {hint && <div className="mt-3 text-[9px] leading-relaxed text-muted-foreground font-medium line-clamp-1">{hint}</div>}
      </div>
    </Card>
  );
}
