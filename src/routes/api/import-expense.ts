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

/**
 * Renomeação de 2026-11-07: as despesas da usina passaram a se chamar
 * "Fatura Energia Usina", "Fatura Agua Usina" e "Boleto Internet Usina"
 * (antes "Fatura de Energia Usina", "Fatura de Agua Usina" e
 * "Fatura de Internet Usina"). A dedupe e o attach aceitam o nome antigo
 * até a renomeação ser aplicada no banco, para não duplicar a despesa do mês.
 */
const OLD_DESCRIPTION: Record<string, string> = {
  'Fatura Energia Usina': 'Fatura de Energia Usina',
  'Fatura Agua Usina': 'Fatura de Agua Usina',
  'Boleto Internet Usina': 'Fatura de Internet Usina',
}

function descriptionsFor(description: string): string[] {
  const old = OLD_DESCRIPTION[description]
  return old ? [description, old] : [description]
}

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

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

        // Ação "attach": anexa o boleto/fatura a uma despesa que já existe
        // (ex.: a internet de novembro, lançada antes de o boleto chegar).
        // Localiza pela mesma chave da dedupe (categoria + descrição + mês).
        if (String(body?.action ?? '') === 'attach') {
          const referenceMonth = String(body?.reference_month ?? '')
          const pdfBase64 = typeof body?.pdf_base64 === 'string' ? body.pdf_base64 : ''
          if (!category || !description || !/^\d{4}-\d{2}$/.test(referenceMonth)) {
            return Response.json(
              { error: 'category, description e reference_month (aaaa-mm) são obrigatórios.' },
              { status: 400 },
            )
          }
          if (!pdfBase64) {
            return Response.json({ error: 'pdf_base64 é obrigatório.' }, { status: 400 })
          }
          const path = await uploadExpensePdf(supabaseAdmin, pdfBase64)
          if (!path) {
            return Response.json({ error: 'Falha ao subir o boleto.' }, { status: 500 })
          }
          const [y, m] = referenceMonth.split('-').map(Number)
          const monthStart = `${referenceMonth}-01`
          const next = new Date(y, m, 1)
          const monthEnd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
          const { data: target, error: targetError } = await supabaseAdmin
            .from('expenses')
            .select('id')
            .eq('category', category)
            .in('description', descriptionsFor(description))
            .gte('reference_date', monthStart)
            .lt('reference_date', monthEnd)
            .maybeSingle()
          if (targetError) {
            return Response.json({ error: targetError.message }, { status: 500 })
          }
          if (!target) {
            return Response.json({ error: 'Despesa não encontrada nesse mês.' }, { status: 404 })
          }
          const { error: updateError } = await supabaseAdmin
            .from('expenses')
            .update({ attachment_path: path })
            .eq('id', target.id)
          if (updateError) {
            return Response.json({ error: updateError.message }, { status: 500 })
          }
          return Response.json({ status: 'attached', expense_id: target.id, attachment_path: path })
        }

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

        // Vencimento do boleto (aaaa-mm-dd): vai para notes como
        // [[due:aaaa-mm-dd]], igual às faturas — o Fluxo de Caixa usa
        // para montar a mensagem que vai ao grupo.
        const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.due_date ?? ''))
          ? String(body.due_date)
          : null
        const pdfBase64 = typeof body?.pdf_base64 === 'string' ? body.pdf_base64 : ''
        const attachmentPath = pdfBase64 ? await uploadExpensePdf(supabaseAdmin, pdfBase64) : null

        // Já lançada? Não duplica. A comparação é pelo mês, não pelo dia:
        // o lançamento manual guarda o dia em que foi criado, e o Fluxo
        // de Caixa agrupa despesas por mês (reference_date yyyy-mm).
        const monthStart = `${referenceDate.slice(0, 7)}-01`
        const [y, m] = referenceDate.slice(0, 7).split('-').map(Number)
        const next = new Date(y, m, 1)
        const monthEnd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('expenses')
          .select('id')
          .eq('category', category)
          .in('description', descriptionsFor(description))
          .gte('reference_date', monthStart)
          .lt('reference_date', monthEnd)
          .maybeSingle()
        if (existingError) {
          return Response.json({ error: existingError.message }, { status: 500 })
        }
        if (existing) return Response.json({ status: 'already_exists' })

        const notesBase =
          typeof body?.notes === 'string' && body.notes.trim()
            ? body.notes.trim()
            : '[[status:pendente]]'
        const notes = dueDate
          ? /\[\[due:\d{4}-\d{2}-\d{2}\]\]/.test(notesBase)
            ? notesBase.replace(/\[\[due:\d{4}-\d{2}-\d{2}\]\]/, `[[due:${dueDate}]]`)
            : `${notesBase} [[due:${dueDate}]]`
          : notesBase

        const insertRow: Record<string, unknown> = {
          category,
          description,
          amount,
          reference_date: referenceDate,
          notes,
        }
        if (attachmentPath) insertRow.attachment_path = attachmentPath
        let inserted: { id: string } | null = null
        let insertError: { message: string } | null = null
        ;({ data: inserted, error: insertError } = await supabaseAdmin
          .from('expenses')
          .insert(insertRow)
          .select('id')
          .single())
        if (insertError && attachmentPath && /attachment_path/i.test(insertError.message)) {
          // Coluna ainda não existe (migration não aplicada): grava a
          // despesa sem o anexo; o boleto pode ser anexado depois.
          ;({ data: inserted, error: insertError } = await supabaseAdmin
            .from('expenses')
            .insert({ category, description, amount, reference_date: referenceDate, notes })
            .select('id')
            .single())
        }
        if (insertError || !inserted) {
          return Response.json({ error: insertError?.message ?? 'falha ao gravar' }, { status: 500 })
        }
        return Response.json(
          { status: 'created', expense_id: inserted.id, attachment_path: attachmentPath },
          { status: 201 },
        )
      },
    },
  },
})

/** Sobe o boleto/fatura (base64) no bucket privado e devolve o caminho. */
async function uploadExpensePdf(supabaseAdmin: any, pdfBase64: string): Promise<string | null> {
  try {
    const bytes = Buffer.from(pdfBase64, 'base64')
    if (bytes.length === 0) return null
    const filePath = `expenses/${Date.now()}.pdf`
    const { error } = await supabaseAdmin.storage
      .from('faturas_v3_privado_v2')
      .upload(filePath, bytes, { contentType: 'application/pdf' })
    if (error) return null
    return filePath
  } catch {
    return null
  }
}
