import { brl, formatDateBR, monthLabelLong, parseISODateLocal } from "./format";

/**
 * Texto da mensagem de fechamento mensal enviada no WhatsApp, com a tabela
 * e a fatura do mês em anexo. Usado pelo botão "Enviar fechamento" em
 * Faturas e pela rota /api/whatsapp-queue (prepare, para o envio
 * automático mensal). Se o texto mudar, mude aqui.
 *
 * A chave Pix vem da tabela plant_config (coluna pix_key) e é a mesma para
 * todos os clientes. Enquanto não for informada, a linha do Pix sai da
 * mensagem. Ela NÃO fica no código: o repositório é público.
 */

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
}): string {
  const month = monthLabelLong(parseISODateLocal(`${args.referenceMonth}-01`)).toLowerCase();
  const value = brl(args.clientPays);
  const due = args.dueDate ? ` com vencimento dia ${formatDateBR(args.dueDate)}` : "";
  const pix = args.pixKey
    ? `\nA chave Pix para pagamento é \`${args.pixKey}\`.`
    : "";
  return `Olá, ${args.clientName}! Segue o fechamento de energia referente ao mês de ${month}. O valor ficou em ${value}${due}.${pix}\nQualquer dúvida estou à disposição.\nAtt: Financeiro.`;
}

/** Formata o preço do kW como no lançamento (ex.: 1,145752). */
export function formatPriceKw(priceKw: number, exact?: string | null): string {
  if (exact && exact.trim()) {
    const n = Number(exact.replace(",", "."));
    if (Number.isFinite(n)) return n.toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  }
  return Number(priceKw).toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}
