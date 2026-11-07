import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/download')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const tokenUrl = url.searchParams.get('token')
        const path = url.searchParams.get('path')
        const name = url.searchParams.get('name') || 'fatura.pdf'
        // 'inline' abre o PDF no navegador; o padrão 'attachment' baixa o arquivo.
        const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment'

        if (!tokenUrl && !path) {
          return new Response('Token missing', { status: 400 })
        }

        try {
          let body: BodyInit | null = null
          let contentType = 'application/pdf'
          if (path) {
            // Baixa direto do bucket privado com service_role: nada do
            // Supabase aparece na URL, então o navegador não bloqueia.
            const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
            const { data, error } = await supabaseAdmin.storage
              .from('faturas_v3_privado_v2')
              .download(path)
            if (error || !data) throw new Error(error?.message ?? 'Failed to fetch from storage')
            body = data
            contentType = data.type || 'application/pdf'
          } else {
            // Compat: o relatório passa a URL assinada como token.
            const res = await fetch(tokenUrl!)
            if (!res.ok) throw new Error('Failed to fetch from storage')
            body = res.body
            contentType = res.headers.get('Content-Type') || 'application/pdf'
          }

          // Stream the response back to the client
          return new Response(body, {
            headers: {
              'Content-Type': contentType,
              'Content-Disposition': `${disposition}; filename="${encodeURIComponent(name)}"`,
              'Cache-Control': 'no-cache',
            },
          })
        } catch (err: any) {
          return new Response(`Download error: ${err.message}`, { status: 500 })
        }
      },
      // POST { path } — devolve o PDF para o visualizador dentro do app.
      // O caminho vai no corpo, não na URL: o Chrome do usuário bloqueia
      // navegação para URLs com ".pdf" (ERR_BLOCKED_BY_CLIENT), então o
      // PDF é buscado por fetch e exibido num iframe com blob URL.
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const path = String(body?.path ?? '')
          if (!path) return new Response('path é obrigatório.', { status: 400 })
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
          const { data, error } = await supabaseAdmin.storage
            .from('faturas_v3_privado_v2')
            .download(path)
          if (error || !data) throw new Error(error?.message ?? 'Failed to fetch from storage')
          return new Response(data, {
            headers: {
              'Content-Type': data.type || 'application/pdf',
              'Content-Disposition': `inline; filename="${encodeURIComponent(path.split('/').pop() || 'fatura.pdf')}"`,
              'Cache-Control': 'no-cache',
            },
          })
        } catch (err: any) {
          return new Response(`Download error: ${err.message}`, { status: 500 })
        }
      },
    },
  },
})
