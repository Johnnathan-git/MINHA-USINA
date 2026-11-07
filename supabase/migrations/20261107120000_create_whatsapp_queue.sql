-- Fila de mensagens de WhatsApp (fechamento mensal para os clientes).
-- O botão "Enviar fechamento" em Faturas prepara uma linha por cliente
-- com fatura lançada no mês (texto já montado). O remetente (Baileys,
-- número da usina) lê as pendentes e marca enviado/falha.
-- Nada é enviado pelo banco: a tabela é só a fila.
CREATE TABLE IF NOT EXISTS public.whatsapp_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  client_name text NOT NULL,
  phone text NOT NULL,
  reference_month text NOT NULL,
  message_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma linha ativa por cliente e mês: o mesmo fechamento nunca entra duas vezes na fila.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_queue_unique_active
  ON public.whatsapp_queue (client_id, reference_month)
  WHERE status IN ('pending', 'sent');

ALTER TABLE public.whatsapp_queue ENABLE ROW LEVEL SECURITY;

-- Mesmo modelo de acesso de invoices e pending_invoice_imports:
-- admin vê tudo, usuário vinculado só o próprio cliente.
CREATE POLICY "whatsapp_queue_select" ON public.whatsapp_queue FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  OR EXISTS (SELECT 1 FROM public.user_clients uc WHERE uc.user_id = auth.uid() AND uc.client_id = whatsapp_queue.client_id)
);
CREATE POLICY "whatsapp_queue_insert" ON public.whatsapp_queue FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY "whatsapp_queue_update" ON public.whatsapp_queue FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY "whatsapp_queue_delete" ON public.whatsapp_queue FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

REVOKE ALL ON public.whatsapp_queue FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_queue TO authenticated;
GRANT ALL ON public.whatsapp_queue TO service_role;
