import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'

/**
 * Fila de envio das despesas da usina no WhatsApp (energia, água e
 * internet — o irmão paga os boletos).
 *
 * - GET ?status=pending — lista a fila com os dados da despesa
 *   (o remetente Baileys lê as pendentes e envia para o grupo).
 * - POST { action: "ack", id, status: "sent" | "failed", error? } — o
 *   remetente marca o resultado de cada envio.
 * - POST { action: "retry", id } — volta uma falha para pendente.
 *
 * Segurança: mesmo segredo PENDING_IMPORT_SECRET do /api/import-pending,
 * no header x-import-secret. O botão em Fluxo de Caixa não usa esta rota
 * (o navegador não tem o segredo): ele grava na fila direto pelo Supabase.
 * O download do PDF usa a ação "download" de /api/whatsapp-queue, que já
 * baixa qualquer caminho do bucket privado.
 */
export const Route = createFileRoute('/api/expense-whatsapp-queue')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = checkSecret(request)
        if (auth) return auth

        const url = new URL(request.url)
        const status = url.searchParams.get('status') ?? 'pending'

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        let q = supabaseAdmin
          .from('expense_whatsapp_queue')
          .select(
            'id,expense_id,message_text,attachment_path,status,error,created_at,sent_at,expenses(description,amount,reference_date)',
          )
          .order('created_at', { ascending: true })
        if (status) q = q.eq('status', status)
        const { data, error } = await q
        if (error) return Response.json({ error: error.message }, { status: 500 })
        const rows = (data ?? []).map((r: any) => ({
          id: r.id,
          expense_id: r.expense_id,
          message_text: r.message_text,
          attachment_path: r.attachment_path,
          status: r.status,
          error: r.error,
          created_at: r.created_at,
          sent_at: r.sent_at,
          description: r.expenses?.description ?? '',
          amount: r.expenses?.amount ?? null,
          reference_date: r.expenses?.reference_date ?? '',
        }))
        return Response.json({ rows })
      },

      POST: async ({ request }) => {
        const auth = checkSecret(request)
        if (auth) return auth

        let body: any
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Corpo inválido.' }, { status: 400 })
        }

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        const action = String(body?.action ?? '')

        if (action === 'ack') {
          const id = String(body?.id ?? '')
          const status = String(body?.status ?? '')
          if (!id || (status !== 'sent' && status !== 'failed')) {
            return Response.json({ error: 'id e status (sent|failed) são obrigatórios.' }, { status: 400 })
          }
          const { error } = await supabaseAdmin
            .from('expense_whatsapp_queue')
            .update({
              status,
              error: status === 'failed' ? String(body?.error ?? 'falha no envio').slice(0, 500) : null,
              sent_at: status === 'sent' ? new Date().toISOString() : null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)
          if (error) return Response.json({ error: error.message }, { status: 500 })
          return Response.json({ status: 'ok' })
        }

        if (action === 'retry') {
          const id = String(body?.id ?? '')
          if (!id) return Response.json({ error: 'id é obrigatório.' }, { status: 400 })
          const { error } = await supabaseAdmin
            .from('expense_whatsapp_queue')
            .update({ status: 'pending', error: null, sent_at: null, updated_at: new Date().toISOString() })
            .eq('id', id)
          if (error) return Response.json({ error: error.message }, { status: 500 })
          return Response.json({ status: 'ok' })
        }

        return Response.json({ error: 'action inválida (ack|retry).' }, { status: 400 })
      },
    },
  },
})

function checkSecret(request: Request): Response | null {
  const secret = process.env.PENDING_IMPORT_SECRET
  if (!secret) {
    return Response.json(
      { error: 'Importação não configurada no servidor.' },
      { status: 503 },
    )
  }
  const provided = request.headers.get('x-import-secret') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: 'Não autorizado.' }, { status: 401 })
  }
  return null
}
