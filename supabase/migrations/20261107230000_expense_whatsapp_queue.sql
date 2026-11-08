-- Boleto da despesa da usina + fila de envio no WhatsApp.
--
-- A despesa (energia, água, internet da usina) passa a guardar o caminho
-- do boleto/fatura no bucket privado (attachment_path). O botão "Enviar no
-- grupo" no Fluxo de Caixa coloca a despesa na fila
-- (expense_whatsapp_queue); o remetente (Baileys) envia o PDF + mensagem
-- para o grupo USINA FINANCEIRO, para o irmão pagar. Nada é enviado pelo
-- banco: a tabela é só a fila.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS attachment_path text;

CREATE TABLE IF NOT EXISTS public.expense_whatsapp_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses (id) ON DELETE CASCADE,
  message_text text NOT NULL,
  attachment_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma linha ativa por despesa: o mesmo boleto nunca entra duas vezes na fila.
CREATE UNIQUE INDEX IF NOT EXISTS expense_whatsapp_queue_unique_active
  ON public.expense_whatsapp_queue (expense_id)
  WHERE status IN ('pending', 'sent');

ALTER TABLE public.expense_whatsapp_queue ENABLE ROW LEVEL SECURITY;

-- Só admin (o dono, que lança e envia): mesmo modelo do whatsapp_queue.
CREATE POLICY "expense_whatsapp_queue_select" ON public.expense_whatsapp_queue FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY "expense_whatsapp_queue_insert" ON public.expense_whatsapp_queue FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY "expense_whatsapp_queue_update" ON public.expense_whatsapp_queue FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY "expense_whatsapp_queue_delete" ON public.expense_whatsapp_queue FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

REVOKE ALL ON public.expense_whatsapp_queue FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_whatsapp_queue TO authenticated;
GRANT ALL ON public.expense_whatsapp_queue TO service_role;
