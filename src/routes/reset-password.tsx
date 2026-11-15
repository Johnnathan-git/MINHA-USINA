import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({
    meta: [
      { title: "Redefinir senha — Usina dos Irmãos" },
      { name: "description", content: "Defina uma nova senha para acessar o sistema." },
      { property: "og:title", content: "Redefinir senha — Usina dos Irmãos" },
      { property: "og:description", content: "Defina uma nova senha para acessar o sistema." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError("A senha deve ter pelo menos 6 caracteres."); return; }
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    toast.success("Senha redefinida!");
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-white p-4">
      <Card className="w-full max-w-md p-8 shadow-lg">
        <h1 className="mb-2 text-center text-xl font-semibold">Redefinir senha</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          {ready ? "Escolha uma nova senha para sua conta." : "Abra este link a partir do e-mail de redefinição."}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="password">Nova senha</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="••••••••" disabled={!ready} />
          </div>
          <div>
            <Label htmlFor="confirm">Confirmar senha</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm}
              onChange={e => setConfirm(e.target.value)} placeholder="••••••••" disabled={!ready} />
          </div>
          {error && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          <Button type="submit" disabled={loading || !ready} className="w-full">
            {loading ? "Aguarde..." : "Salvar nova senha"}
          </Button>
        </form>
      </Card>
    </div>
  );
}