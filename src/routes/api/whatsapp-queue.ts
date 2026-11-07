import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { buildWhatsAppMessage } from '@/lib/whatsapp'

/**
 * Fila de mensagens de WhatsApp (fechamento mensal).
 *
 * - GET ?status=pending&reference_month=yyyy-mm — lista a fila (o remetente
 *   Baileys lê as pendentes e envia).
 * - POST { action: "prepare", reference_month } — monta a fila do mês a
 *   partir das faturas lançadas (uso futuro: envio automático mensal).
 * - POST { action: "ack", id, status: "sent" | "failed", error? } — o
 *   remetente marca o resultado de cada envio.
 * - POST { action: "retry", id } — volta uma falha para pendente.
 *
 * Segurança: mesmo segredo PENDING_IMPORT_SECRET do /api/import-pending,
 * no header x-import-secret. O botão em Faturas não usa esta rota (o
 * navegador não tem o segredo): ele grava na fila direto pelo Supabase.
 */
export const Route = createFileRoute('/api/whatsapp-queue')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = checkSecret(request)
        if (auth) return auth

        const url = new URL(request.url)
        const status = url.searchParams.get('status') ?? 'pending'
        const referenceMonth = url.searchParams.get('reference_month') ?? ''

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        let q = supabaseAdmin
          .from('whatsapp_queue')
          .select('id,client_id,client_name,phone,reference_month,message_text,status,error,created_at,sent_at')
          .order('created_at', { ascending: true })
        if (status) q = q.eq('status', status)
        if (referenceMonth) q = q.eq('reference_month', referenceMonth)
        const { data, error } = await q
        if (error) return Response.json({ error: error.message }, { status: 500 })
        return Response.json({ rows: data ?? [] })
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
            .from('whatsapp_queue')
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
            .from('whatsapp_queue')
            .update({ status: 'pending', error: null, sent_at: null, updated_at: new Date().toISOString() })
            .eq('id', id)
          if (error) return Response.json({ error: error.message }, { status: 500 })
          return Response.json({ status: 'ok' })
        }

        if (action === 'prepare') {
          const referenceMonth = String(body?.reference_month ?? '')
          if (!/^\d{4}-\d{2}$/.test(referenceMonth)) {
            return Response.json({ error: 'reference_month (aaaa-mm) é obrigatório.' }, { status: 400 })
          }
          const [y, m] = referenceMonth.split('-').map(Number)
          const start = `${referenceMonth}-01`
          const end = new Date(y, m, 1).toISOString().slice(0, 10)

          const { data: invoices, error: invError } = await supabaseAdmin
            .from('invoices')
            .select('id,client_id,reference_date,client_pays,notes,clients(id,name,phone,active)')
            .gte('reference_date', start)
            .lt('reference_date', end)
          if (invError) return Response.json({ error: invError.message }, { status: 500 })

          const { data: existing } = await supabaseAdmin
            .from('whatsapp_queue')
            .select('client_id')
            .eq('reference_month', referenceMonth)
          const alreadyQueued = new Set((existing ?? []).map((r: any) => r.client_id))

          const created: string[] = []
          const skippedNoPhone: string[] = []
          const skippedAlready: string[] = []
          const skippedInactive: string[] = []
          for (const inv of invoices ?? []) {
            const client: any = (inv as any).clients
            if (!client) continue
            if (!client.active) { skippedInactive.push(client.name); continue }
            if (alreadyQueued.has(client.id)) { skippedAlready.push(client.name); continue }
            const phone = String(client.phone ?? '').trim()
            if (!phone) { skippedNoPhone.push(client.name); continue }
            const due = String(inv.notes ?? '').match(/\[\[due:(\d{4}-\d{2}-\d{2})\]\]/)?.[1] ?? null
            const messageText = buildWhatsAppMessage({
              clientName: client.name,
              referenceMonth,
              clientPays: Number(inv.client_pays),
              dueDate: due,
            })
            const { error: insertError } = await supabaseAdmin.from('whatsapp_queue').insert({
              client_id: client.id,
              client_name: client.name,
              phone,
              reference_month: referenceMonth,
              message_text: messageText,
              status: 'pending',
            })
            if (insertError) return Response.json({ error: insertError.message }, { status: 500 })
            created.push(client.name)
          }
          return Response.json({
            status: 'prepared',
            reference_month: referenceMonth,
            created,
            skipped_no_phone: skippedNoPhone,
            skipped_already_queued: skippedAlready,
            skipped_inactive: skippedInactive,
          })
        }

        return Response.json({ error: 'action inválida (prepare|ack|retry).' }, { status: 400 })
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
