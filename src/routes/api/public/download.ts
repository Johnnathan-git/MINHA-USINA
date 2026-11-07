import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/download')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const tokenUrl = url.searchParams.get('token')
        const name = url.searchParams.get('name') || 'fatura.pdf'
        // 'inline' abre o PDF no navegador; o padrão 'attachment' baixa o arquivo.
        const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment'

        if (!tokenUrl) {
          return new Response('Token missing', { status: 400 })
        }

        try {
          // Fetch the file from the signed URL server-side
          const res = await fetch(tokenUrl)
          if (!res.ok) throw new Error('Failed to fetch from storage')

          // Stream the response back to the client
          return new Response(res.body, {
            headers: {
              'Content-Type': res.headers.get('Content-Type') || 'application/pdf',
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
