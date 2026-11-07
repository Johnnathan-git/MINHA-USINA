-- Estado da sessão do WhatsApp do remetente (número da usina).
-- O poller grava aqui a cada verificação (a cada 15 min e após cada envio):
-- linked = sessão vinculada e ativa; checked_at = quando foi verificado.
-- A página Faturas lê e mostra o selo Conectado/Desconectado.
CREATE TABLE IF NOT EXISTS public.whatsapp_status (
  id int PRIMARY KEY DEFAULT 1,
  linked boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now(),
  error text,
  CHECK (id = 1)
);

ALTER TABLE public.whatsapp_status ENABLE ROW LEVEL SECURITY;

-- Só admin lê (mesmo modelo das outras tabelas do WhatsApp).
CREATE POLICY "whatsapp_status_select" ON public.whatsapp_status FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
);

REVOKE ALL ON public.whatsapp_status FROM anon;
GRANT SELECT ON public.whatsapp_status TO authenticated;
GRANT ALL ON public.whatsapp_status TO service_role;
