import { createFileRoute } from '@tanstack/react-router'
import { timingSafeEqual } from 'node:crypto'

/**
 * Recebe uma despesa da usina (energia, água ou internet) e grava direto
 * na tabela expenses, como pendente ([[status:pendente]]), sem filtro de
 * revisão — é o mesmo comportamento do lançamento manual no Fluxo de Caixa.
 *
 * Segurança: só aceita chamadas com o segredo PENDING_IMPORT_SECRET
 * (variável de ambiente do servidor, cadastrada no Lovable) no header
 * x-import-secret. Sem ele, nada é gravado. O acesso ao banco usa o
 * client server-side (service role), que já existe no projeto.
 *
 * Dedupe: mesma categoria + descrição + reference_date não duplica.
 */
export const Route = createFileRoute('/api/import-expense')({
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

        const category = String(body?.category ?? '').trim()
        const description = String(body?.description ?? '').trim()
        const referenceDate = String(body?.reference_date ?? '')
        const amount = Number(body?.amount)

        if (!category || !description || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
          return Response.json(
            { error: 'category, description e reference_date (aaaa-mm-dd) são obrigatórios.' },
            { status: 400 },
          )
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          return Response.json(
            { error: 'amount deve ser um número maior que zero.' },
            { status: 400 },
          )
        }

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

        // Já lançada? Não duplica.
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('expenses')
          .select('id')
          .eq('category', category)
          .eq('description', description)
          .eq('reference_date', referenceDate)
          .maybeSingle()
        if (existingError) {
          return Response.json({ error: existingError.message }, { status: 500 })
        }
        if (existing) return Response.json({ status: 'already_exists' })

        const notes =
          typeof body?.notes === 'string' && body.notes.trim()
            ? body.notes.trim()
            : '[[status:pendente]]'

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('expenses')
          .insert({
            category,
            description,
            amount,
            reference_date: referenceDate,
            notes,
          })
          .select('id')
          .single()
        if (insertError) {
          return Response.json({ error: insertError.message }, { status: 500 })
        }
        return Response.json(
          { status: 'created', expense_id: inserted.id },
          { status: 201 },
        )
      },
    },
  },
})
