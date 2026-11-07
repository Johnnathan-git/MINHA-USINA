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
    },
  },
})
