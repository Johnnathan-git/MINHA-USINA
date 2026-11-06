-- Faturas aguardando importação (ponte e-mail -> sistema).
-- Só guarda os dados extraídos do PDF até o usuário importar no Lançar;
-- não aparece como lista na tela: o avatar do cliente pulsa enquanto houver pendente.
CREATE TABLE IF NOT EXISTS public.pending_invoice_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  uc_number text NOT NULL,
  reference_date date NOT NULL,
  consumption_kw numeric NOT NULL,
  price_kw numeric NOT NULL,
  price_kw_exact text,
  public_lighting numeric NOT NULL DEFAULT 0,
  interest_fine numeric NOT NULL DEFAULT 0,
  distributor_invoice numeric NOT NULL DEFAULT 0,
  due_date date,
  attachment_url text,
  source_gmail_message_id text,
  source_pdf_filename text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'imported')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uma pendência por cliente e mês: a mesma fatura nunca vira duas pendências.
CREATE UNIQUE INDEX IF NOT EXISTS pending_invoice_imports_unique_pending
  ON public.pending_invoice_imports (client_id, reference_date)
  WHERE status = 'pending';

ALTER TABLE public.pending_invoice_imports ENABLE ROW LEVEL SECURITY;

-- Mesmo modelo de acesso de invoices: admin vê tudo, usuário vinculado só o próprio cliente.
CREATE POLICY "pending_invoice_imports_select" ON public.pending_invoice_imports FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  OR EXISTS (SELECT 1 FROM public.user_clients uc WHERE uc.user_id = auth.uid() AND uc.client_id = pending_invoice_imports.client_id)
);
CREATE POLICY "pending_invoice_imports_insert" ON public.pending_invoice_imports FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY "pending_invoice_imports_update" ON public.pending_invoice_imports FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY "pending_invoice_imports_delete" ON public.pending_invoice_imports FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

REVOKE ALL ON public.pending_invoice_imports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_invoice_imports TO authenticated;
GRANT ALL ON public.pending_invoice_imports TO service_role;
