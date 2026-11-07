import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Renderiza um PDF em canvas (PDF.js), sem depender do visualizador do
 * navegador: o Chrome do usuário não abre PDFs (nem em iframe, nem em aba).
 * As páginas são desenhadas uma abaixo da outra, com rolagem.
 */
export function PdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let doc: pdfjsLib.PDFDocumentProxy | null = null;
    (async () => {
      try {
        doc = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled) return;
        setPages(doc.numPages);
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "mb-2 rounded border border-border bg-white";
          container.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
        }
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message || "Não foi possível abrir o PDF.");
      }
    })();
    return () => {
      cancelled = true;
      try {
        const d = doc as unknown as { destroy?: () => unknown; cleanup?: () => unknown } | null;
        if (d && typeof d.destroy === "function") void d.destroy();
        else if (d && typeof d.cleanup === "function") void d.cleanup();
      } catch {
        /* ignore */
      }
    };
  }, [url]);

  return (
    <div className="max-h-[70vh] overflow-y-auto">
      {pages === 0 && !error ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando páginas...</p>
      ) : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <div ref={containerRef} />
    </div>
  );
}
