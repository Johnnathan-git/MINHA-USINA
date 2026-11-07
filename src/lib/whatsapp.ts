import { brl, formatDateBR, monthLabelLong, parseISODateLocal } from "./format";

/**
 * Texto da mensagem de fechamento mensal enviada no WhatsApp, com a tabela
 * e a fatura do mês em anexo. Usado pelo botão "Enviar fechamento" em
 * Faturas e pela rota /api/whatsapp-queue (prepare, para o envio
 * automático mensal).
 *
 * O modelo é editável no app (seção Mensagens WhatsApp, botão
 * "Editar mensagem") e fica em plant_config.whatsapp_message_template.
 * Quando vazio, vale o DEFAULT_WHATSAPP_TEMPLATE abaixo.
 *
 * A chave Pix vem da tabela plant_config (coluna pix_key) e é a mesma para
 * todos os clientes. Enquanto não for informada, a linha do Pix sai da
 * mensagem. Ela NÃO fica no código: o repositório é público.
 */

/** Modelo padrão da mensagem (vale quando não há modelo salvo). */
export const DEFAULT_WHATSAPP_TEMPLATE =
  "Olá, {nome}! Segue o fechamento de energia referente ao mês de {mes}. O valor ficou em {valor}{vencimento}.\nA chave Pix para pagamento é {chave_pix}.\nQualquer dúvida estou à disposição.\nAtt: Financeiro.";

export type TableData = {
  referenceMonth: string; // "yyyy-mm"
  ucNumber: string;
  consumptionKw: number;
  priceKw: string; // exato, como no lançamento (ex.: "1,145752")
  publicLighting: number;
  interestFine: number;
  valueWithoutPlant: number;
  clientPays: number;
  discountPct: number; // 30 ou 25
  color?: string | null; // cor do card do cliente (faixa com o nome na tabela)
};

export function buildWhatsAppMessage(args: {
  clientName: string;
  referenceMonth: string; // "yyyy-mm"
  clientPays: number;
  dueDate: string | null; // "yyyy-mm-dd" ou null
  pixKey?: string;
  template?: string | null; // modelo salvo em plant_config; vazio = padrão
}): string {
  const template = (args.template ?? "").trim() || DEFAULT_WHATSAPP_TEMPLATE;
  const month = monthLabelLong(parseISODateLocal(`${args.referenceMonth}-01`)).toLowerCase();
  const value = brl(args.clientPays);
  // {vencimento} já traz a frase inteira (" com vencimento dia 17/11/2026")
  // ou some quando não há vencimento; {chave_pix} é a chave em monospace.
  const due = args.dueDate ? ` com vencimento dia ${formatDateBR(args.dueDate)}` : "";
  const pix = args.pixKey ? `\`${args.pixKey}\`` : "";
  // A linha com {chave_pix} some quando não há chave Pix cadastrada.
  const lines = template.split("\n").filter((line) => !(line.includes("{chave_pix}") && !pix));
  return lines
    .join("\n")
    .replaceAll("{nome}", args.clientName)
    .replaceAll("{mes}", month)
    .replaceAll("{valor}", value)
    .replaceAll("{vencimento}", due)
    .replaceAll("{chave_pix}", pix);
}

/** Formata o preço do kW como no lançamento (ex.: 1,145752). */
export function formatPriceKw(priceKw: number, exact?: string | null): string {
  if (exact && exact.trim()) {
    const n = Number(exact.replace(",", "."));
    if (Number.isFinite(n)) return n.toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  }
  return Number(priceKw).toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}
