import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'
import { buildWhatsAppMessage, formatPriceKw } from '@/lib/whatsapp'

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
 * - POST { action: "sign", path } — URL assinada (1h) do PDF da fatura no
 *   bucket privado, para o remetente baixar o anexo.
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
          .select('id,client_id,client_name,phone,reference_month,message_text,table_data,attachment_path,status,error,created_at,sent_at,clients(color)')
          .order('created_at', { ascending: true })
        if (status) q = q.eq('status', status)
        if (referenceMonth) q = q.eq('reference_month', referenceMonth)
        const { data, error } = await q
        if (error) return Response.json({ error: error.message }, { status: 500 })
        // Cor do card do cliente (faixa com o nome na tabela): da ficha do
        // cliente quando disponível, senão a que já estava em table_data.
        const rows = (data ?? []).map((r: any) => ({
          ...r,
          color: r.clients?.color ?? r.table_data?.color ?? null,
          clients: undefined,
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

        if (action === 'download') {
          // Baixa o PDF da fatura pelo servidor e devolve em base64. O
          // remetente baixa por aqui em vez da URL assinada: o download
          // direto do storage a partir da VM é instável (timeout /
          // IncompleteRead), enquanto o canal remetente -> app é confiável.
          const path = String(body?.path ?? '')
          if (!path) return Response.json({ error: 'path é obrigatório.' }, { status: 400 })
          const { data, error } = await supabaseAdmin.storage
            .from('faturas_v3_privado_v2')
            .download(path)
          if (error || !data) return Response.json({ error: error?.message ?? 'download falhou' }, { status: 500 })
          const buf = Buffer.from(await data.arrayBuffer())
          return Response.json({ pdf_base64: buf.toString('base64') })
        }

        if (action === 'sign') {
          const path = String(body?.path ?? '')
          if (!path) return Response.json({ error: 'path é obrigatório.' }, { status: 400 })
          const { data, error } = await supabaseAdmin.storage
            .from('faturas_v3_privado_v2')
            .createSignedUrl(path, 3600)
          if (error) return Response.json({ error: error.message }, { status: 500 })
          return Response.json({ signed_url: data.signedUrl })
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
            .select('id,client_id,reference_date,consumption_kw,price_kw,public_lighting,interest_fine,value_without_plant,client_pays,notes,attachment_url,clients(id,name,phone,active,uc_number,discount_pct)')
            .gte('reference_date', start)
            .lt('reference_date', end)
          if (invError) return Response.json({ error: invError.message }, { status: 500 })

          const { data: existing } = await supabaseAdmin
            .from('whatsapp_queue')
            .select('client_id')
            .eq('reference_month', referenceMonth)
          const alreadyQueued = new Set((existing ?? []).map((r: any) => r.client_id))

          // Chave Pix do fechamento (plant_config.pix_key, mesma para todos)
          // e o modelo da mensagem (plant_config.whatsapp_message_template).
          const { data: cfg } = await supabaseAdmin
            .from('plant_config')
            .select('pix_key, whatsapp_message_template')
            .eq('id', 1)
            .maybeSingle()
          const pixKey = (cfg?.pix_key as string | null) ?? undefined
          const waTemplate = (cfg?.whatsapp_message_template as string | null) ?? undefined

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
            const exact = String(inv.notes ?? '').match(/\[\[price_kw_exact:([^\]]+)\]\]/)?.[1] ?? null
            const messageText = buildWhatsAppMessage({
              clientName: client.name,
              referenceMonth,
              clientPays: Number(inv.client_pays),
              dueDate: due,
              pixKey,
              template: waTemplate,
            })
            const { error: insertError } = await supabaseAdmin.from('whatsapp_queue').insert({
              client_id: client.id,
              client_name: client.name,
              phone,
              reference_month: referenceMonth,
              message_text: messageText,
              status: 'pending',
              table_data: {
                referenceMonth,
                ucNumber: client.uc_number,
                consumptionKw: Number(inv.consumption_kw),
                priceKw: formatPriceKw(Number(inv.price_kw), exact),
                publicLighting: Number(inv.public_lighting),
                interestFine: Number(inv.interest_fine),
                valueWithoutPlant: Number(inv.value_without_plant),
                clientPays: Number(inv.client_pays),
                discountPct: Number(client.discount_pct),
                color: client.color ?? null,
              },
              attachment_path: inv.attachment_url ?? null,
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

        if (action === 'heartbeat') {
          // O remetente avisa se a sessão do WhatsApp está vinculada.
          // A página Faturas mostra o selo Conectado/Desconectado.
          const linked = body?.linked === true
          const { error } = await supabaseAdmin
            .from('whatsapp_status')
            .upsert({
              id: 1,
              linked,
              checked_at: new Date().toISOString(),
              error: linked ? null : String(body?.error ?? '').slice(0, 500) || null,
            })
          if (error) return Response.json({ error: error.message }, { status: 500 })
          return Response.json({ status: 'ok' })
        }

        return Response.json({ error: 'action inválida (prepare|ack|retry|heartbeat).' }, { status: 400 })
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
