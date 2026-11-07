import { brl, formatDateBR, monthLabelLong, parseISODateLocal } from "./format";

/**
 * Texto padrão da mensagem de fechamento mensal enviada no WhatsApp.
 * Usado pelo botão "Enviar fechamento" em Faturas e pela rota
 * /api/whatsapp-queue (prepare, para o envio automático mensal).
 * Se o texto mudar, mude aqui: os dois caminhos usam este builder.
 */
export function buildWhatsAppMessage(args: {
  clientName: string;
  referenceMonth: string; // "yyyy-mm"
  clientPays: number;
  dueDate: string | null; // "yyyy-mm-dd" ou null
}): string {
  const month = monthLabelLong(parseISODateLocal(`${args.referenceMonth}-01`)).toLowerCase();
  const value = brl(args.clientPays);
  const due = args.dueDate ? `, com vencimento em ${formatDateBR(args.dueDate)}` : "";
  return `Olá, ${args.clientName}! Aqui é da Minha Usina. Sua fatura de energia referente a ${month} ficou em ${value}${due}. Qualquer dúvida é só chamar por aqui. Obrigado!`;
}
