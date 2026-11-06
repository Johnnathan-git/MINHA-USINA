import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'

/**
 * Recebe uma fatura extraída do PDF da Equatorial e grava como pendente
 * (tabela pending_invoice_imports). O avatar do cliente passa a pulsar
 * em Faturas até o usuário importar no Lançar.
 *
 * Segurança: só aceita chamadas com o segredo PENDING_IMPORT_SECRET
 * (variável de ambiente do servidor, cadastrada no Lovable) no header
 * x-import-secret. Sem ele, nada é gravado. O acesso ao banco usa o
 * client server-side (service role), que já existe no projeto.
 */
export const Route = createFileRoute('/api/import-pending')({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        let body: any
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Corpo inválido.' }, { status: 400 })
        }

        const uc = String(body?.uc_number ?? '').replace(/\D/g, '')
        const referenceDate = String(body?.reference_date ?? '')
        const num = (v: unknown) => {
          const n = Number(v)
          return Number.isFinite(n) ? n : NaN
        }
        const consumption = num(body?.consumption_kw)
        const price = num(body?.price_kw)
        const lighting = num(body?.public_lighting ?? 0)
        const fine = num(body?.interest_fine ?? 0)
        const distributor = num(body?.distributor_invoice ?? 0)

        if (!uc || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
          return Response.json(
            { error: 'uc_number e reference_date (aaaa-mm-dd) são obrigatórios.' },
            { status: 400 },
          )
        }
        if ([consumption, price, lighting, fine, distributor].some((n) => Number.isNaN(n))) {
          return Response.json(
            { error: 'Valores numéricos inválidos.' },
            { status: 400 },
          )
        }

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

        const { data: client, error: clientError } = await supabaseAdmin
          .from('clients')
          .select('id')
          .eq('uc_number', uc)
          .maybeSingle()
        if (clientError) {
          return Response.json({ error: clientError.message }, { status: 500 })
        }
        if (!client) {
          return Response.json(
            { error: `Cliente não encontrado para a UC ${uc}.` },
            { status: 404 },
          )
        }

        // Já lançada? Não duplica.
        const { data: launched } = await supabaseAdmin
          .from('invoices')
          .select('id')
          .eq('client_id', client.id)
          .eq('reference_date', referenceDate)
          .maybeSingle()
        if (launched) return Response.json({ status: 'already_launched' })

        // Já pendente? Não duplica.
        const { data: pending } = await supabaseAdmin
          .from('pending_invoice_imports')
          .select('id')
          .eq('client_id', client.id)
          .eq('reference_date', referenceDate)
          .eq('status', 'pending')
          .maybeSingle()
        if (pending) return Response.json({ status: 'already_pending' })

        let attachmentUrl: string | null = null
        const pdfBase64 = typeof body?.pdf_base64 === 'string' ? body.pdf_base64 : ''
        if (pdfBase64) {
          try {
            const bytes = Buffer.from(pdfBase64, 'base64')
            const filePath = `${client.id}/${Date.now()}.pdf`
            const { error: uploadError } = await supabaseAdmin.storage
              .from('faturas_v3_privado_v2')
              .upload(filePath, bytes, { contentType: 'application/pdf' })
            if (!uploadError) attachmentUrl = filePath
          } catch {
            // Segue sem anexo; a pendência ainda é criada.
          }
        }

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('pending_invoice_imports')
          .insert({
            client_id: client.id,
            uc_number: uc,
            reference_date: referenceDate,
            consumption_kw: consumption,
            price_kw: price,
            price_kw_exact:
              typeof body?.price_kw_exact === 'string' && body.price_kw_exact.trim()
                ? body.price_kw_exact.trim()
                : null,
            public_lighting: lighting,
            interest_fine: fine,
            distributor_invoice: distributor,
            due_date: body?.due_date ?? null,
            attachment_url: attachmentUrl,
            source_gmail_message_id: body?.source_gmail_message_id ?? null,
            source_pdf_filename: body?.source_pdf_filename ?? null,
            status: 'pending',
          })
          .select('id')
          .single()
        if (insertError) {
          return Response.json({ error: insertError.message }, { status: 500 })
        }
        return Response.json(
          { status: 'created', pending_id: inserted.id, attachment_url: attachmentUrl },
          { status: 201 },
        )
      },
    },
  },
})
