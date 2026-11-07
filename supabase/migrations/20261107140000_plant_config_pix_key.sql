-- Chave Pix do fechamento mensal (recebimento dos clientes).
-- Só a coluna: o valor NÃO vai neste arquivo (o repositório é público).
-- Depois de aplicar, rodar no editor SQL:
--   UPDATE public.plant_config SET pix_key = '64992738589' WHERE id = 1;
ALTER TABLE public.plant_config
  ADD COLUMN IF NOT EXISTS pix_key text;
