import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Zap, TrendingUp, BarChart3, Pencil, X, Save, RefreshCw, Trash2, ShieldAlert } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { CLIENT_COLORS, monthLabelFromISO } from "@/lib/format";

type RateioClient = {
  id: string;
  name: string;
  uc_number: string;
  color: string;
  allocation_pct: number;
  avg_consumption: number;
};

// Últimos consumos lançados de um cliente (mais recente primeiro).
type InvoiceHistoryItem = { month: string; consumption: number };
type InvoiceHistory = Record<string, InvoiceHistoryItem[]>;

const digits = (s: string) => (s || "").replace(/\D/g, "");

type Config = { panels_count: number; kw_per_panel: number };

const CONTROL_STATE_CATEGORY = "__SISTEMA__";
const CONTROL_STATE_DESCRIPTION = "__CONTROLE_ADM_RATEIO__";

function parseRateioState(notes: string | null | undefined): RateioClient[] | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as { clients?: RateioClient[] };
    if (!Array.isArray(parsed.clients)) return null;
    return parsed.clients.map((client, index) => ({
      id: String(client.id || crypto.randomUUID()),
      name: String(client.name || ""),
      uc_number: String(client.uc_number || ""),
      color: String(client.color || CLIENT_COLORS[index % CLIENT_COLORS.length]),
      allocation_pct: Number(client.allocation_pct || 0),
      avg_consumption: Number(client.avg_consumption || 0),
    }));
  } catch {
    return null;
  }
}

const q = queryOptions({
  queryKey: ["controle-page"],
  queryFn: async () => {
    const [stateRes, cfgRes] = await Promise.all([
      supabase
        .from("expenses")
        .select("id,notes")
        .eq("category", CONTROL_STATE_CATEGORY)
        .eq("description", CONTROL_STATE_DESCRIPTION)
        .limit(1),
      supabase
        .from("plant_config")
        .select("panels_count,kw_per_panel")
        .eq("id", 1)
        .maybeSingle(),
    ]);

    if (stateRes.error) throw stateRes.error;
    if (cfgRes.error) throw cfgRes.error;

    const savedClients = parseRateioState(stateRes.data?.[0]?.notes);
    const config = (cfgRes.data ?? { panels_count: 0, kw_per_panel: 0 }) as Config;
    let clients: RateioClient[];

    if (savedClients) {
      clients = savedClients;
    } else {
      // Migração inicial: copia o cenário atual apenas uma vez.
      // Depois de salvo, o Controle ADM deixa de depender de clients/client_allocations.
      const [clientsRes, allocRes] = await Promise.all([
        supabase.from("clients").select("id,name,uc_number,color,active").eq("active", true),
        supabase.from("client_allocations").select("client_id,allocation_pct,avg_consumption"),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      if (allocRes.error) throw allocRes.error;

      const allocMap = new Map(
        (allocRes.data ?? []).map((a: any) => [
          a.client_id,
          {
            allocation_pct: Number(a.allocation_pct || 0),
            avg_consumption: Number(a.avg_consumption || 0),
          },
        ]),
      );

      clients = (clientsRes.data ?? []).map((client: any, index: number) => {
        const alloc = allocMap.get(client.id) ?? { allocation_pct: 0, avg_consumption: 0 };
        return {
          id: crypto.randomUUID(),
          name: client.name,
          uc_number: client.uc_number || "",
          color: client.color || CLIENT_COLORS[index % CLIENT_COLORS.length],
          allocation_pct: alloc.allocation_pct,
          avg_consumption: alloc.avg_consumption,
        };
      });
    }

    // Histórico: últimos 3 consumos lançados de cada cliente (casado pela UC),
    // para escolher o consumo médio sem digitar na mão. Clientes sem UC ou
    // sem fatura lançada (ex.: prospectos) ficam sem histórico e seguem
    // com o consumo médio manual.
    const history: InvoiceHistory = {};
    const clientIdByUc = new Map<string, string>();
    const allClientsRes = await supabase.from("clients").select("id,uc_number");
    if (!allClientsRes.error) {
      for (const row of allClientsRes.data ?? []) {
        const d = digits(String((row as any).uc_number || ""));
        if (d) clientIdByUc.set(d, String((row as any).id));
      }
    }
    const wantedIds = [
      ...new Set(
        clients
          .map((c) => clientIdByUc.get(digits(c.uc_number)))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (wantedIds.length > 0) {
      const invRes = await supabase
        .from("invoices")
        .select("client_id,reference_date,consumption_kw")
        .in("client_id", wantedIds)
        .order("reference_date", { ascending: false });
      if (!invRes.error) {
        const byClient = new Map<string, InvoiceHistoryItem[]>();
        for (const row of invRes.data ?? []) {
          const consumption = Number((row as any).consumption_kw || 0);
          if (consumption <= 0) continue;
          const list = byClient.get(String((row as any).client_id)) ?? [];
          if (list.length < 3) {
            list.push({
              month: monthLabelFromISO(String((row as any).reference_date)),
              consumption,
            });
            byClient.set(String((row as any).client_id), list);
          }
        }
        for (const [uc, clientId] of clientIdByUc) {
          const list = byClient.get(clientId);
          if (list && list.length > 0) history[uc] = list;
        }
      }
    }

    return { clients, config, history };
  },
});

export const Route = createFileRoute("/_app/controle")({
  ssr: false,
  component: Page,
  head: () => ({
    meta: [
      { title: "Controle ADM — Usina dos Irmãos" },
      { name: "description", content: "Geração x consumo e rateio por cliente." },
    ],
  }),
});

function Page() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <Controle />
    </Suspense>
  );
}

function Controle() {
  const { data, refetch } = useSuspenseQuery(q);
  const [cfg, setCfg] = useState(data.config);
  const [clients, setClients] = useState<RateioClient[]>(data.clients);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    setCfg(data.config);
    setClients(data.clients);
  }, [data]);

  const totalKw = Number(cfg.panels_count) * Number(cfg.kw_per_panel);
  const totalPct = clients.reduce((sum, client) => sum + Number(client.allocation_pct || 0), 0);
  const totalAvg = clients.reduce((sum, client) => sum + Number(client.avg_consumption || 0), 0);
  const history = data.history ?? {};
  const histFor = (client: RateioClient) => history[digits(client.uc_number)] ?? [];
  const avgOf = (list: InvoiceHistoryItem[]) =>
    list.length > 0
      ? Math.round(list.reduce((sum, item) => sum + item.consumption, 0) / list.length)
      : 0;

  // Planejamento de placas: quantas faltam (ou sobram) para a demanda atual.
  const kwPerPanel = Number(cfg.kw_per_panel) || 0;
  const panelsNeeded =
    kwPerPanel > 0 && totalAvg > 0 ? Math.ceil(totalAvg / kwPerPanel) : 0;
  const panelsToAdd = Math.max(0, panelsNeeded - Number(cfg.panels_count || 0));
  const surplusKw = totalKw - totalAvg;

  // % de rateio é sempre a proporção do consumo médio: ao mudar um consumo
  // (ou ao entrar/sair um cliente), as % são sugeridas de novo sozinhas.
  // Maior resto: cada % vai para baixo em centésimos e os centésimos que
  // faltam para fechar 100% exatos vão para quem tem o maior resto
  // fracionário — a soma dá sempre 100,00%.
  function withRecalculatedPercentages(list: RateioClient[]): RateioClient[] {
    const total = list.reduce((sum, client) => sum + Number(client.avg_consumption || 0), 0);
    if (total <= 0) return list;
    const exact = list.map((client) => (Number(client.avg_consumption || 0) / total) * 100);
    const hundredths = exact.map((pct) => Math.floor(pct * 100));
    const remaining = 10000 - hundredths.reduce((sum, v) => sum + v, 0);
    const order = exact
      .map((pct, i) => ({ i, frac: pct * 100 - Math.floor(pct * 100) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < remaining && order.length > 0; k++) {
      hundredths[order[k % order.length].i] += 1;
    }
    return list.map((client, i) => ({ ...client, allocation_pct: hundredths[i] / 100 }));
  }

  function updateClient(id: string, patch: Partial<RateioClient>) {
    setClients((current) => {
      const next = current.map((client) =>
        client.id === id ? { ...client, ...patch } : client,
      );
      // Só recalcula as % quando o consumo médio muda; ajuste manual de %
      // (ou de nome/UC) não mexe nas demais.
      return "avg_consumption" in patch ? withRecalculatedPercentages(next) : next;
    });
  }

  function recalcRateio() {
    if (totalAvg <= 0) return toast.error("Informe consumos médios antes de recalcular");
    setClients((current) => withRecalculatedPercentages(current));
    toast.success("Rateio recalculado pelo consumo médio");
  }

  function addClient(name: string, uc: string, avg: number) {
    setClients((current) =>
      withRecalculatedPercentages([
        ...current,
        {
          id: crypto.randomUUID(),
          name,
          uc_number: uc,
          color: CLIENT_COLORS[current.length % CLIENT_COLORS.length],
          allocation_pct: 0,
          avg_consumption: avg,
        },
      ]),
    );
  }

  function deleteRow(id: string) {
    setClients((current) =>
      withRecalculatedPercentages(current.filter((client) => client.id !== id)),
    );
  }

  async function saveAll() {
    setSaving(true);

    const { error: configError } = await supabase.from("plant_config").upsert({
      id: 1,
      panels_count: Number(cfg.panels_count),
      kw_per_panel: Number(cfg.kw_per_panel),
    });
    if (configError) {
      setSaving(false);
      return toast.error(configError.message);
    }

    const statePayload = {
      reference_date: new Date().toISOString().slice(0, 10),
      category: CONTROL_STATE_CATEGORY,
      description: CONTROL_STATE_DESCRIPTION,
      amount: 0,
      notes: JSON.stringify({ clients }),
    };

    const { data: existingRows, error: findError } = await supabase
      .from("expenses")
      .select("id")
      .eq("category", CONTROL_STATE_CATEGORY)
      .eq("description", CONTROL_STATE_DESCRIPTION)
      .limit(1);

    if (findError) {
      setSaving(false);
      return toast.error(findError.message);
    }

    const existingId = existingRows?.[0]?.id;
    const result = existingId
      ? await supabase.from("expenses").update(statePayload).eq("id", existingId)
      : await supabase.from("expenses").insert(statePayload);

    setSaving(false);
    if (result.error) return toast.error(result.error.message);

    toast.success("Controle ADM salvo");
    setEditing(false);
    await refetch();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="truncate text-4xl font-bold tracking-tight text-foreground">Controle ADM</h1>
          <ol className="mt-2 space-y-1 text-sm font-medium text-muted-foreground">
            <li>1º Altere a média de consumo de cada um.</li>
            <li>2º Altere a qtd. de painéis e kW por painel.</li>
            <li>3º Por último, recalcule o rateio.</li>
          </ol>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <Button onClick={() => setEditing(true)} className="gap-2 font-bold">
              <Pencil className="h-4 w-4" /> Editar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => { setEditing(false); setClients(data.clients); setCfg(data.config); }} className="gap-2">
                <X className="h-4 w-4" /> Cancelar
              </Button>
              <Button variant="outline" onClick={recalcRateio} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Recalcular rateio
              </Button>
              <Button onClick={() => setNewOpen(true)} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Adicionar cliente
              </Button>
              <Button onClick={saveAll} disabled={saving} className="gap-2 font-bold bg-primary">
                <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar"}
              </Button>
            </>
          )}
        </div>
      </div>

      {totalPct > 100.5 || totalPct < 99.5 ? (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          Soma do rateio está em {totalPct.toFixed(2)}%. Idealmente 100%.
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="glass-card p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Zap className="h-4 w-4" /> Painéis
          </div>
          {editing ? (
            <Input type="number" value={cfg.panels_count} onChange={(e) => setCfg({ ...cfg, panels_count: Number(e.target.value) })} />
          ) : (
            <div className="text-2xl font-bold">{cfg.panels_count}</div>
          )}
        </Card>
        <Card className="glass-card p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-4 w-4" /> kW / painel
          </div>
          {editing ? (
            <Input type="number" step="0.01" value={cfg.kw_per_panel} onChange={(e) => setCfg({ ...cfg, kw_per_panel: Number(e.target.value) })} />
          ) : (
            <div className="text-2xl font-bold">{cfg.kw_per_panel}</div>
          )}
        </Card>
        <Card className="glass-card p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-4 w-4" /> Geração total (kW)
          </div>
          <div className="text-2xl font-bold text-primary">
            {totalKw.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
          </div>
        </Card>
      </div>

      <Card className="glass-card p-6">
        <h2 className="text-lg font-bold">Planejamento de placas</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Calculado com {kwPerPanel.toLocaleString("pt-BR")} kWh por placa/mês e{" "}
          {Number(cfg.panels_count || 0)} placas atuais. Atualiza sozinho quando você
          muda o consumo médio de um cliente.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Demanda total
            </div>
            <div className="text-2xl font-bold">
              {totalAvg.toLocaleString("pt-BR")} kWh/mês
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Geração atual
            </div>
            <div className="text-2xl font-bold">
              {totalKw.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kWh/mês
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Saldo
            </div>
            <div
              className={`text-2xl font-bold ${surplusKw >= 0 ? "text-emerald-600" : "text-rose-600"}`}
            >
              {surplusKw >= 0 ? "+" : ""}
              {surplusKw.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kWh/mês
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Placas necessárias
            </div>
            <div className="text-2xl font-bold">{kwPerPanel > 0 ? panelsNeeded : "—"}</div>
          </div>
        </div>
        <div
          className={`mt-4 rounded-xl border p-4 text-center ${
            panelsToAdd > 0
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-emerald-300 bg-emerald-50 text-emerald-900"
          }`}
        >
          {panelsToAdd > 0 ? (
            <div className="text-lg font-bold">
              Faltam {panelsToAdd} placa{panelsToAdd > 1 ? "s" : ""} para atender a
              demanda
            </div>
          ) : (
            <div className="text-lg font-bold">
              Nenhuma placa a mais — sobra{" "}
              {surplusKw.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kWh/mês
            </div>
          )}
        </div>
      </Card>

      <Card className="glass-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Rateio por cliente</h2>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Total %:{" "}
            <span className={totalPct > 100.01 || totalPct < 99.99 ? "text-rose-600" : "text-emerald-600"}>
              {totalPct.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {clients.map((client) => {
            const shareKw = (totalKw * Number(client.allocation_pct || 0)) / 100;
            return (
              <div
                key={client.id}
                className="grid grid-cols-1 gap-3 rounded-xl border border-border p-4 sm:grid-cols-[1fr_120px_140px_120px_40px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: client.color || CLIENT_COLORS[0] }}
                  >
                    {(client.name || "?")[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="space-y-2">
                        <Input
                          value={client.name}
                          onChange={(e) => updateClient(client.id, { name: e.target.value })}
                          placeholder="Nome"
                        />
                        <Input
                          value={client.uc_number}
                          onChange={(e) => updateClient(client.id, { uc_number: e.target.value })}
                          placeholder="UC (opcional)"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="font-bold truncate">{client.name}</div>
                        <div className="text-xs text-muted-foreground">UC {client.uc_number || "—"}</div>
                      </>
                    )}
                    {(() => {
                      const hist = histFor(client);
                      if (hist.length === 0) {
                        return editing ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Sem faturas lançadas — informe o consumo médio manualmente.
                          </div>
                        ) : null;
                      }
                      const mean = avgOf(hist);
                      return (
                        <div className="mt-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Últimas faturas
                          </div>
                          {editing ? (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {hist.map((h, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() =>
                                    updateClient(client.id, { avg_consumption: h.consumption })
                                  }
                                  className="rounded-full border border-border px-2 py-1 text-xs font-bold hover:border-primary hover:text-primary"
                                >
                                  {h.month} · {h.consumption.toLocaleString("pt-BR")}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  updateClient(client.id, { avg_consumption: mean })
                                }
                                className="rounded-full bg-primary px-2 py-1 text-xs font-bold text-primary-foreground"
                              >
                                Média dos {hist.length}: {mean.toLocaleString("pt-BR")}
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {hist
                                .map(
                                  (h) =>
                                    `${h.month} ${h.consumption.toLocaleString("pt-BR")}`,
                                )
                                .join(" · ")}{" "}
                              (média {mean.toLocaleString("pt-BR")})
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div>
                  <Label className="text-[10px] uppercase">% Rateio</Label>
                  {editing ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={client.allocation_pct}
                      onChange={(e) => updateClient(client.id, { allocation_pct: Number(e.target.value) })}
                    />
                  ) : (
                    <div className="font-bold">{Number(client.allocation_pct).toFixed(2)}%</div>
                  )}
                </div>

                <div>
                  <Label className="text-[10px] uppercase">Consumo médio</Label>
                  {editing ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={client.avg_consumption}
                      onChange={(e) => updateClient(client.id, { avg_consumption: Number(e.target.value) })}
                    />
                  ) : (
                    <div className="font-bold">{Number(client.avg_consumption).toLocaleString("pt-BR")}</div>
                  )}
                </div>

                <div>
                  <Label className="text-[10px] uppercase">kW alocado</Label>
                  <div className="font-bold text-primary">
                    {shareKw.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                  </div>
                </div>

                {editing ? (
                  <button
                    type="button"
                    aria-label="Excluir do rateio"
                    onClick={() => deleteRow(client.id)}
                    className="text-muted-foreground hover:text-rose-600 self-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <div />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {newOpen && (
        <NewRateioClientDialog onClose={() => setNewOpen(false)} onAdd={addClient} />
      )}
    </div>
  );
}

function NewRateioClientDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (n: string, u: string, a: number) => void;
}) {
  const [name, setName] = useState("");
  const [uc, setUc] = useState("");
  const [avg, setAvg] = useState("");

  function submit() {
    if (!name.trim()) return toast.error("Informe o nome");
    onAdd(name.trim(), uc.trim(), Number(avg) || 0);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Adicionar cliente ao rateio</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: John" />
          </div>
          <div>
            <Label>UC (opcional)</Label>
            <Input value={uc} onChange={(e) => setUc(e.target.value)} />
          </div>
          <div>
            <Label>Consumo médio</Label>
            <Input type="number" value={avg} onChange={(e) => setAvg(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">
              A % de rateio é calculada sozinha a partir do consumo médio.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
