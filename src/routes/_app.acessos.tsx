import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ShieldCheck, Trash2, Pencil, KeyRound } from "lucide-react";
import { MODULES } from "@/lib/permissions";
import {
  listManagedUsers, createManagedUser, updateManagedUser, deleteManagedUser, changeMyPassword
} from "@/lib/acessos.functions";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDateBR } from "@/lib/format";

export const Route = createFileRoute("/_app/acessos")({
  ssr: false,
  component: AcessosPage,
  head: () => ({
    meta: [
      { title: "Acessos — Usina dos Irmãos" },
      { name: "description", content: "Gerencie usuários e permissões do sistema." },
      { property: "og:title", content: "Acessos — Usina dos Irmãos" },
      { property: "og:description", content: "Gerencie usuários e permissões do sistema." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const MODULE_OPTIONS = MODULES.filter((m) => m.key !== "acessos");

function AcessosPage() {
  return <AcessosContent />;
}

function AcessosContent() {
  const listFn = useServerFn(listManagedUsers);
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
  }, []);
  const q = useQuery({
    queryKey: ["managed-users"],
    queryFn: () => listFn(),
    enabled: hasSession,
  });
  const clientsQ = useQuery({
    queryKey: ["clients-simple"],
    enabled: hasSession,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,name").order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });
  const clients = clientsQ.data ?? [];
  const clientName = (id: string | null) => id ? (clients.find(c => c.id === id)?.name ?? "—") : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">Acessos</h1>
          <p className="text-sm font-medium text-muted-foreground">Gerencie usuários e permissões do sistema.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UserFormDialog mode="create" clients={clients} />
        </div>
      </div>

      {q.data?.bootstrap && (
        <div className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-primary">
          Nenhum administrador cadastrado ainda — todos os usuários autenticados têm acesso total até o primeiro admin ser marcado.
        </div>
      )}

      <Card className="glass-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-accent">
                <th className="px-6 py-4 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">E-mail</th>
                <th className="px-6 py-4 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Nome</th>
                <th className="px-6 py-4 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Papel</th>
                <th className="px-6 py-4 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Permissões</th>
                <th className="px-6 py-4 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Cliente</th>
                <th className="px-6 py-4 text-left font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Criado em</th>
                <th className="px-6 py-4 text-right font-bold text-muted-foreground uppercase text-[10px] tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-accent transition-colors zebra-stripe">
                  <td className="px-6 py-4 font-bold text-foreground">{u.email}</td>
                  <td className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{u.display_name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-6 py-4">
                    {u.is_admin ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/20">
                        <ShieldCheck className="h-3 w-3" /> Administrador
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Usuário</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {u.is_admin ? (
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Todos os módulos</span>
                    ) : u.permissions.length === 0 ? (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.permissions.map((p) => (
                          <span key={p} className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {MODULE_OPTIONS.find((m) => m.key === p)?.label ?? p}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    {clientName(u.client_id) ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-6 py-4 text-[10px] font-bold text-muted-foreground uppercase tracking-wider num">{formatDateBR(u.created_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex gap-2">
                      <UserFormDialog mode="edit" user={u} clients={clients} />
                      <ResetPasswordDialog user={u} />
                      <DeleteUserButton userId={u.id} email={u.email} />
                    </div>
                  </td>
                </tr>
              ))}
              {q.data && q.data.users.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-muted-foreground font-medium">Nenhum usuário cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

type UserRow = { id: string; email: string; is_admin: boolean; permissions: string[]; client_id: string | null; display_name: string | null };

function UserFormDialog({ mode, user, clients }: { mode: "create" | "edit"; user?: UserRow; clients: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const createFn = useServerFn(createManagedUser);
  const updateFn = useServerFn(updateManagedUser);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(user?.is_admin ?? false);
  const [perms, setPerms] = useState<string[]>(user?.permissions ?? []);
  const [clientId, setClientId] = useState<string>(user?.client_id ?? "none");
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");

  const m = useMutation({
    mutationFn: async () => {
      const client_id = clientId === "none" ? null : clientId;
      if (mode === "create") {
        const mail = email.trim();
        if (!mail || !/^\S+@\S+\.\S+$/.test(mail)) throw new Error("Informe um e-mail válido.");
        if (password.length < 6) throw new Error("A senha deve ter no mínimo 6 caracteres.");
        return createFn({ data: { email: mail, password, is_admin: isAdmin, permissions: isAdmin ? [] : perms, client_id, display_name: displayName } });
      }
      if (password && password.length < 6) throw new Error("A senha deve ter no mínimo 6 caracteres.");
      return updateFn({ data: { user_id: user!.id, is_admin: isAdmin, permissions: isAdmin ? [] : perms, password: password || undefined, client_id, display_name: displayName } });
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Usuário criado." : "Usuário atualizado.");
      qc.invalidateQueries({ queryKey: ["managed-users"] });
      setOpen(false);
      setPassword("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 font-bold shadow-lg shadow-primary/20"><Plus className="mr-2 h-4 w-4" /> Novo usuário</Button>
        ) : (
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></Button>
        )}
      </DialogTrigger>
      <DialogContent className="glass-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground text-glow">{mode === "create" ? "Novo usuário" : `Editar ${user?.email}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {mode === "create" ? (
              <div>
                <Label className="text-muted-foreground">E-mail</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@exemplo.com" className="bg-accent border-border text-foreground" />
              </div>
            ) : (
              <div className="flex flex-col justify-center">
                <Label className="text-muted-foreground">E-mail</Label>
                <div className="text-sm font-semibold text-foreground">{user?.email}</div>
              </div>
            )}
            <div>
              <Label className="text-muted-foreground">Nome de Boas-vindas</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ex: João Silva" className="bg-accent border-border text-foreground" />
            </div>
          </div>
          <div>
            <Label className="text-muted-foreground">{mode === "create" ? "Senha" : "Nova senha (opcional)"}</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" className="bg-accent border-border text-foreground" />
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-border bg-accent p-3">
            <Checkbox checked={isAdmin} onCheckedChange={(v) => setIsAdmin(Boolean(v))} className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">Administrador</div>
              <div className="text-xs text-muted-foreground">Acesso total, incluindo gerenciamento de usuários.</div>
            </div>
          </label>
          {!isAdmin && (
            <div>
              <Label className="text-muted-foreground">Módulos liberados</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {MODULE_OPTIONS.map((mod) => {
                  const checked = perms.includes(mod.key);
                  return (
                    <label key={mod.key} className="flex items-center gap-2 rounded-lg border border-border bg-accent p-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setPerms((prev) => v ? [...prev, mod.key] : prev.filter((p) => p !== mod.key));
                        }}
                        className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                      />
                      <span className="text-muted-foreground">{mod.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {!isAdmin && (
            <div>
              <Label className="text-muted-foreground">Cliente vinculado (Resultado)</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="mt-1 bg-accent border-border text-foreground"><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                <SelectContent className="bg-popover border-border text-foreground">
                  <SelectItem value="none">Nenhum (vê todos)</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Se selecionado, no módulo Resultado o usuário verá apenas as faturas deste cliente.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground hover:bg-accent">Cancelar</Button>
          <Button
            onClick={() => m.mutate()}
            disabled={m.isPending || (mode === "create" && (!email.trim() || password.length < 6))}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
          >
            {m.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteManagedUser);
  const m = useMutation({
    mutationFn: () => delFn({ data: { user_id: userId } }),
    onSuccess: () => {
      toast.success("Usuário excluído.");
      qc.invalidateQueries({ queryKey: ["managed-users"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao excluir."),
  });
  return (
    <Button size="sm" variant="ghost" onClick={() => {
      if (confirm(`Excluir ${email}? Esta ação não pode ser desfeita.`)) m.mutate();
    }}>
      <Trash2 className="h-4 w-4 text-[#D64545]" />
    </Button>
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
        <Button variant="outline" className="bg-card border-border text-muted-foreground hover:bg-accent font-bold rounded-lg">Alterar Minha Senha</Button>
      </DialogTrigger>
      <DialogContent className="glass-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground text-glow">Alterar Minha Senha</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label className="text-muted-foreground">Nova Senha</Label>
            <Input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="Mínimo 6 caracteres" 
              className="bg-accent border-border text-foreground"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground hover:bg-accent">Cancelar</Button>
          <Button 
            onClick={() => m.mutate()} 
            disabled={m.isPending || password.length < 6}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
          >
            {m.isPending ? "Alterando..." : "Confirmar Alteração"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const updateFn = useServerFn(updateManagedUser);
  const qc = useQueryClient();
  
  const m = useMutation({
    mutationFn: () => updateFn({ data: { user_id: user.id, password, is_admin: user.is_admin, permissions: user.permissions, client_id: user.client_id, display_name: user.display_name || undefined } }),
    onSuccess: () => {
      toast.success(`Senha de ${user.email} resetada.`);
      setOpen(false);
      setPassword("");
      qc.invalidateQueries({ queryKey: ["managed-users"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao resetar senha."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary">
          <KeyRound className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground text-glow">Resetar Senha: {user.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label className="text-muted-foreground">Nova Senha Temporária</Label>
            <Input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="Mínimo 6 caracteres" 
              className="bg-accent border-border text-foreground"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground hover:bg-accent">Cancelar</Button>
          <Button 
            onClick={() => m.mutate()} 
            disabled={m.isPending || password.length < 6}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
          >
            {m.isPending ? "Resetando..." : "Confirmar Novo Acesso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}