-- Fila do WhatsApp: anexos do fechamento (tabela + fatura do mês).
-- table_data: os números da tabela que vai em anexo (consumo, preço do kW,
-- iluminação, juros/multa, valor sem usina, valor com desconto, desconto %).
-- attachment_path: caminho do PDF da fatura no bucket faturas_v3_privado_v2
-- (o remetente pede uma URL assinada na hora do envio).
ALTER TABLE public.whatsapp_queue
  ADD COLUMN IF NOT EXISTS table_data jsonb,
  ADD COLUMN IF NOT EXISTS attachment_path text;
