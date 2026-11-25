import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutGrid, Users, Wallet, Gauge, Package, ShieldCheck, FileSpreadsheet, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccess } from "@/lib/acessos.functions";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { BrandLockup } from "@/components/BrandMark";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { changeMyPassword } from "@/lib/acessos.functions";
import { toast } from "sonner";
import { initial } from "@/lib/format";


type NavItem = { to: string; label: string; shortLabel: string; icon: typeof LayoutGrid; module: string; adminOnly?: boolean };
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", shortLabel: "Home", icon: LayoutGrid, module: "dashboard" },
  { to: "/faturas", label: "Faturas", shortLabel: "Faturas", icon: Users, module: "faturas" },
  { to: "/fluxo-caixa", label: "Fluxo de Caixa", shortLabel: "Fluxo", icon: Wallet, module: "fluxo-caixa" },
  { to: "/relatorio", label: "Controle Cliente", shortLabel: "Controle", icon: FileSpreadsheet, module: "relatorio" },
  { to: "/controle", label: "Controle ADM", shortLabel: "ADM", icon: Gauge, module: "controle" },
  { to: "/inventario", label: "Inventário", shortLabel: "Estoque", icon: Package, module: "inventario" },
  { to: "/acessos", label: "Acessos", shortLabel: "Acessos", icon: ShieldCheck, module: "acessos", adminOnly: true },
];

function AppShellSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-0 z-0 pointer-events-none bg-background" />
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          <div className="p-6">
            <div className="h-9 w-36 animate-pulse rounded-lg bg-accent" />
          </div>
          <div className="flex-1 space-y-2 px-4 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-accent" style={{ opacity: 1 - i * 0.08 }} />
            ))}
          </div>
        </aside>
        <main className="min-h-screen min-w-0 flex-1 relative z-10">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 md:px-8">
            <div className="mb-6 h-8 w-48 animate-pulse rounded-lg bg-accent" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

const ACCESS_CACHE_KEY = "usina:my-access";
type AccessData = Awaited<ReturnType<typeof getMyAccess>>;

function readCachedAccess(userId: string): AccessData | undefined {
  try {
    const raw = localStorage.getItem(ACCESS_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { userId: string; data: AccessData };
    return parsed.userId === userId ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedAccess(userId: string, data: AccessData) {
  try {
    localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ userId, data }));
  } catch {
    /* armazenamento indisponível: segue sem cache */
  }
}

function clearCachedAccess() {
  try {
    localStorage.removeItem(ACCESS_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("light");
    document.documentElement.classList.remove("dark");
    localStorage.setItem("theme", "light");
  }, []);

  // Mobile: posiciona o badge do Lovable sem observar cada mutação do DOM.
  // A versão anterior usava MutationObserver no body inteiro + timer permanente,
  // causando recalculo de layout durante praticamente toda interação da interface.
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;

    let frame = 0;
    const timers: number[] = [];

    const moveBadge = () => {
      if (window.innerWidth >= 768) return;
      const badge = document.querySelector('a[href*="lovable"]') as HTMLElement | null;
      if (!badge) return;
      const controle =
        (document.querySelector('a[href="/relatorio"]') as HTMLElement | null) ||
        (document.querySelector('nav a[href*="relatorio"]') as HTMLElement | null);

      badge.style.setProperty("position", "fixed", "important");
      badge.style.setProperty("z-index", "45", "important");
      badge.style.setProperty("right", "auto", "important");
      badge.style.setProperty("transform", "translateX(-50%)", "important");

      if (controle) {
        const r = controle.getBoundingClientRect();
        badge.style.setProperty("left", `${r.left + r.width / 2}px`, "important");
        badge.style.setProperty("bottom", `${Math.max(0, window.innerHeight - r.top + 6)}px`, "important");
      } else {
        badge.style.setProperty("bottom", "calc(3.5rem + env(safe-area-inset-bottom, 0px))", "important");
        badge.style.setProperty("left", "42%", "important");
      }
    };

    const scheduleMove = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(moveBadge);
    };

    scheduleMove();
    // O badge é injetado pelo ambiente; algumas tentativas curtas cobrem carregamento tardio
    // sem manter um observer/timer rodando para sempre.
    timers.push(window.setTimeout(scheduleMove, 250));
    timers.push(window.setTimeout(scheduleMove, 900));
    timers.push(window.setTimeout(scheduleMove, 2000));
    window.addEventListener("resize", scheduleMove);

    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", scheduleMove);
    };
  }, [pathname]);

  // Mobile: puxar para atualizar no container de scroll (sem tela branca no body)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = () => document.getElementById("app-scroll");
    let startY = 0;
    let armed = false;
    const onStart = (e: TouchEvent) => {
      const main = el();
      if (!main || window.innerWidth >= 768) return;
      if (main.scrollTop <= 0) {
        startY = e.touches[0].clientY;
        armed = true;
      } else {
        armed = false;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!armed) return;
      const main = el();
      if (!main || main.scrollTop > 0) {
        armed = false;
        return;
      }
      const dy = e.touches[0].clientY - startY;
      if (dy > 90) {
        armed = false;
        window.location.reload();
      }
    };
    const onEnd = () => {
      armed = false;
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!sess.session) {
        navigate({ to: "/auth", replace: true });
        return;
      }

      // Libera a consulta de permissões imediatamente. A validação remota do usuário
      // continua acontecendo em paralelo, em vez de bloquear o carregamento inicial.
      setUserId(sess.session.user.id);
      setReady(true);

      const { data: userData, error } = await supabase.auth.getUser();
      if (!mounted) return;
      if (error || !userData.user) {
        setReady(false);
        await supabase.auth.signOut();
        navigate({ to: "/auth", replace: true });
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) {
        clearCachedAccess();
        setReady(false);
        navigate({ to: "/auth", replace: true });
      } else if (session) {
        setUserId(session.user.id);
        setReady(true);
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [navigate]);

  const accessFn = useServerFn(getMyAccess);
  // Permissões da última abertura: a tela abre na hora e a consulta ao servidor
  // (~1 s) atualiza em segundo plano. Os dados continuam protegidos no banco (RLS).
  const cachedAccess = userId ? readCachedAccess(userId) : undefined;
  const access = useQuery({
    queryKey: ["my-access", userId],
    queryFn: async () => {
      const result = await accessFn();
      if (userId) writeCachedAccess(userId, result);
      return result;
    },
    enabled: ready && Boolean(userId),
    initialData: cachedAccess,
    initialDataUpdatedAt: 0,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const acc = access.data ?? undefined;
  const visibleNav = acc
    ? nav.filter(
        (n) =>
          acc.effective_admin ||
          (!n.adminOnly &&
            (acc.permissions.includes(n.module) ||
              (n.module === "relatorio" && acc.permissions.includes("resultado")))),
      )
    : [];
  const current = nav.find((n) => n.to === "/" ? pathname === "/" : pathname.startsWith(n.to));
  const blocked = Boolean(acc && current && !visibleNav.some((n) => n.to === current.to));

  useEffect(() => {
    if (blocked && visibleNav.length > 0) {
      navigate({ to: visibleNav[0].to, replace: true });
    }
  }, [blocked, visibleNav.length, navigate]);

  async function signOut() {
    clearCachedAccess();
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.replace("/auth?manual=1");
  }

  if (!ready || access.isLoading) {
    return <AppShellSkeleton />;
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-background text-foreground selection:bg-primary/30 md:h-auto md:min-h-screen md:overflow-visible">
      <div className="fixed inset-0 z-0 pointer-events-none bg-background" />

      <header className="no-print sticky top-0 z-50 flex h-16 items-center justify-between border-b border-border bg-background/40 px-4 backdrop-blur-xl md:hidden">
        <BrandLockup />
        <div className="flex items-center gap-2">
          <ChangeOwnPasswordDialog />
          <Button size="icon" variant="ghost" onClick={signOut} className="h-9 w-9 text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex h-[calc(100dvh-4rem)] md:h-auto">
        <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          <div className="p-6">
            <BrandLockup onSidebar />
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <nav className="space-y-1">
              {visibleNav.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    preload="intent"
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary shadow-[0_0_20px_rgba(201,138,62,0.1)]"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <Icon className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )} strokeWidth={2} />
                    <span className="truncate">{item.label}</span>
                    {active && <div className="ml-auto h-1 w-1 rounded-full bg-primary" />}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="mt-auto border-t border-border p-4 light:border-white/10">
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-accent p-2.5 border border-border shadow-sm light:bg-white/10 light:border-white/15">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground uppercase">
                {initial((acc as any)?.display_name || 'U')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-foreground leading-tight light:text-white">
                  {(acc as any)?.display_name || 'Usuário'}
                </div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider light:text-white/60">
                  {acc?.effective_admin ? "Administrador" : "Cliente"}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <ChangeOwnPasswordDialog />
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={signOut} 
                className="flex-1 h-8 gap-2 rounded-lg bg-accent text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 border-border border transition-all light:bg-white/10 light:border-white/15 light:text-white/80"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="text-[10px] font-bold uppercase">Sair</span>
              </Button>
            </div>
          </div>
        </aside>

        <main id="app-scroll" className="min-w-0 flex-1 relative z-10 h-full overflow-y-auto overflow-x-hidden overscroll-y-none md:h-auto md:overflow-visible md:overscroll-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:px-6 md:px-8 md:pb-10">
            {blocked ? (
              <div className="mx-auto mt-20 max-w-md rounded-2xl border border-border bg-card p-10 text-center shadow-xl">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent text-muted-foreground">
                  <ShieldCheck className="h-10 w-10" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Acesso Restrito</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Sua conta não possui permissões para visualizar este módulo.
                </p>
                <Button 
                  onClick={() => navigate({ to: "/", replace: true })}
                  className="mt-8 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Voltar ao Início
                </Button>
              </div>
            ) : children}
          </div>
        </main>

        <nav className="no-print fixed inset-x-0 bottom-0 z-50 flex items-center justify-start gap-0.5 border-t border-border bg-card/95 px-1 pt-1 backdrop-blur-xl md:hidden shadow-[0_-4px_24px_rgba(0,0,0,0.08)] overflow-x-auto scrollbar-hide"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {visibleNav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                preload="intent"
                className={cn(
                  "relative flex min-w-[3.25rem] flex-1 flex-col items-center gap-0.5 px-1.5 py-1.5 transition-all flex-shrink-0",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                  active ? "bg-primary/10" : "bg-transparent"
                )}>
                  <Icon className={cn("h-4 w-4 transition-transform", active && "scale-110")} strokeWidth={2} />
                </div>
                <span className="max-w-[4.5rem] truncate text-[9px] font-bold uppercase tracking-tight leading-tight text-center">
                  {item.shortLabel}
                </span>
                {active && <div className="absolute bottom-0.5 h-0.5 w-4 rounded-full bg-primary" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function ChangeOwnPasswordDialog() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const changeFn = useServerFn(changeMyPassword);
  
  const m = useMutation({
    mutationFn: () => changeFn({ data: { password } }),
    onSuccess: () => {
      toast.success("Senha alterada com sucesso.");
      setOpen(false);
      setPassword("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao alterar senha."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 px-3 rounded-lg border border-border bg-accent text-muted-foreground hover:text-foreground light:bg-white/10 light:text-white/80 light:hover:text-white light:border-white/15">
          <KeyRound className="h-3.5 w-3.5 sm:mr-2" />
          <span className="hidden text-[10px] font-bold uppercase sm:inline">Senha</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar Minha Senha</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label>Nova Senha</Label>
            <Input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="Mínimo 6 caracteres" 
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button 
            onClick={() => m.mutate()} 
            disabled={m.isPending || password.length < 6}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
          >
            {m.isPending ? "Alterando..." : "Confirmar Alteração"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
