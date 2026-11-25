import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'faturas_v3_privado_v2'

/**
 * Entrega o PDF de uma fatura do bucket privado para o visualizador do app.
 *
 * POST { path, name?, disposition? } com o token do usuário logado no header
 * Authorization. O arquivo é lido COM as permissões do próprio usuário (a
 * regra do storage "faturas_v2_select_owner_or_admin": admin vê tudo, cliente
 * só as faturas da própria pasta). Sem login, ou sem permissão, nada sai.
 *
 * O PDF passa pelo servidor (em vez de abrir direto do Supabase) porque o
 * Chrome do usuário bloqueia URLs com ".pdf" e o domínio do Supabase.
 */
export const Route = createFileRoute('/api/public/download')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get('authorization') ?? ''
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (!token || token.split('.').length !== 3) {
          return new Response('Faça login para ver a fatura.', { status: 401 })
        }

        let body: any
        try {
          body = await request.json()
        } catch {
          return new Response('Corpo inválido.', { status: 400 })
        }
        const path = String(body?.path ?? '')
        if (!path || path.includes('..')) return new Response('path é obrigatório.', { status: 400 })
        const disposition = body?.disposition === 'attachment' ? 'attachment' : 'inline'
        const name = String(body?.name || path.split('/').pop() || 'fatura.pdf')

        const SUPABASE_URL = process.env.SUPABASE_URL
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response('Configuração do servidor incompleta.', { status: 500 })
        }

        // Cliente com o token do usuário: as regras de acesso do banco valem.
        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        })

        const { data, error } = await supabase.storage.from(BUCKET).download(path)
        if (error || !data) {
          return new Response('Fatura não encontrada ou sem permissão.', { status: 404 })
        }
        return new Response(data, {
          headers: {
            'Content-Type': data.type || 'application/pdf',
            'Content-Disposition': `${disposition}; filename="${encodeURIComponent(name)}"`,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
