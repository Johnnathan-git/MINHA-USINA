-- Documentos da usina (notas fiscais, contratos, garantias...).
-- Arquivos no bucket privado faturas_v3_privado_v2, pasta "documentos/".
CREATE TABLE IF NOT EXISTS public.plant_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  doc_type text NOT NULL DEFAULT 'Nota fiscal',
  doc_date date,
  notes text,
  file_path text NOT NULL,
  file_name text,
  file_size bigint,
  content_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plant_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plant_documents_admin_all ON public.plant_documents;
CREATE POLICY plant_documents_admin_all ON public.plant_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
