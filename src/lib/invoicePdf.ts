import { supabase } from "@/integrations/supabase/client";

/**
 * Busca o PDF de uma fatura (bucket privado) pelo servidor do app, com o
 * login do usuário — o servidor só entrega o que o usuário pode ver.
 */
export async function fetchInvoicePdf(
  path: string,
  opts: { name?: string; disposition?: "inline" | "attachment" } = {},
): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/api/public/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, name: opts.name, disposition: opts.disposition }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}
