-- Modelo da mensagem de fechamento do WhatsApp, editável no app
-- (seção Mensagens WhatsApp em Faturas, botão "Editar mensagem").
-- Quando vazio, vale o padrão embutido no código
-- (DEFAULT_WHATSAPP_TEMPLATE em src/lib/whatsapp.ts).
ALTER TABLE public.plant_config ADD COLUMN IF NOT EXISTS whatsapp_message_template text;
