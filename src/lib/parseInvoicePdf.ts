import * as pdfjsLib from "pdfjs-dist";

/**
 * Leitura de fatura em PDF no navegador (Equatorial GO e Demae Caldas Novas).
 * Port fiel dos parsers Python de automação (parse_fatura.py e parse_demae.py),
 * validados nos PDFs reais; aqui o texto vem do pdf.js em vez do pdftotext.
 *
 * Uso: extractPdfText(arrayBuffer) -> parseInvoiceText(texto, nomeDoArquivo).
 * A detecção é pelo conteúdo: "Matrícula:" = Demae; UC no cabeçalho = Equatorial.
 */

export type EquatorialParsed = {
  kind: "equatorial";
  uc_number: string; // só dígitos
  referenceMonth: string; // "2026-11"
  due_date: string | null; // "2026-11-19"
  consumption_kw: number | null;
  consumption_non_compensated_kw: number | null;
  price_kw: number | null;
  consumption_scee_kw: number | null;
  price_scee: number | null;
  public_lighting: number | null;
  interest_fine: number;
  distributor_invoice: number | null;
  generation_uc: string | null;
  source_pdf_filename: string;
};

export type DemaeParsed = {
  kind: "demae";
  matricula: string;
  invoice_number: string;
  referenceMonth: string; // "2026-11"
  due_date: string; // "2026-11-25"
  total: number;
  source_pdf_filename: string;
};

export type ParsedInvoicePdf = EquatorialParsed | DemaeParsed;

const MONTHS: Record<string, string> = {
  JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06",
  JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12",
};

/** "1.146,179" / "2.147,34" / "154" -> número. Igual ao num() do parser Python. */
function num(s: string): number {
  return Number(s.replace(/\./g, "").replace(",", "."));
}

/** "19/11/2026" -> "2026-11-19". */
function brDateToISO(s: string): string {
  const [d, m, y] = s.split("/");
  return `${y}-${m}-${d}`;
}

type TextItem = { str: string; transform: number[]; width: number; height: number };

/** Junta os itens do pdf.js em linhas (agrupa por Y com tolerância, ordena por X). */
function pageToLines(items: TextItem[]): string[] {
  const sorted = items
    .filter((it) => it.str)
    .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const lines: string[] = [];
  let current: TextItem[] = [];
  let currentY: number | null = null;
  const flush = () => {
    if (current.length === 0) return;
    const row = [...current].sort((a, b) => a.transform[4] - b.transform[4]);
    let line = "";
    let cursorX: number | null = null;
    for (const it of row) {
      const x = it.transform[4];
      if (cursorX !== null && x - cursorX > 2) line += " ";
      line += it.str;
      cursorX = x + (it.width || 0);
    }
    lines.push(line);
    current = [];
  };
  for (const it of sorted) {
    const y = it.transform[5];
    if (currentY === null || Math.abs(y - currentY) <= 3) {
      current.push(it);
      if (currentY === null) currentY = y;
    } else {
      flush();
      currentY = y;
      current.push(it);
    }
  }
  flush();
  return lines;
}

/** Extrai o texto de um PDF (todas as páginas, uma linha por linha visual). */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  // No navegador o pdf.js usa o worker (igual ao PdfViewer); no Node usa o fake worker.
  if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      const mod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjsLib.GlobalWorkerOptions.workerSrc = mod.default;
    } catch {
      // Sem worker: segue no fake worker.
    }
  }
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    const allLines: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      allLines.push(...pageToLines(content.items as TextItem[]));
    }
    return allLines.join("\n");
  } finally {
    // pdf.js 6.x: cleanup() no lugar do antigo destroy().
    const d = doc as unknown as { cleanup?: () => unknown; destroy?: () => unknown };
    if (typeof d.cleanup === "function") d.cleanup();
    else if (typeof d.destroy === "function") await d.destroy();
  }
}

function parseEquatorial(text: string, filename: string): EquatorialParsed | { error: string } {
  const ucMatch = text.match(/(\d\.\d{3}\.\d{3}\.\d{3}-\d{2})/);
  const uc = ucMatch ? ucMatch[1].replace(/\D/g, "") : null;
  const refMatch = text.match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4})\b/);
  const referenceMonth = refMatch ? `${refMatch[2]}-${MONTHS[refMatch[1]]}` : null;
  const totalMatch = text.match(/R\$\s*\*+\s*([\d.,]+)\s+(\d{2}\/\d{2}\/\d{4})/);
  const distributor_invoice = totalMatch ? num(totalMatch[1]) : null;
  const due_date = totalMatch ? brDateToISO(totalMatch[2]) : null;
  const ncMatch = text.match(/CONSUMO N[AÃ]O COMPENSADO\s+kWh\s+([\d.,]+)\s+([\d.,]+)/i);
  let cons_nc = ncMatch ? num(ncMatch[1]) : null;
  let price_kw = ncMatch ? num(ncMatch[2]) : null;
  // Sem compensação a linha vem só como "CONSUMO kWh kWh <qtd> <preço>".
  if (ncMatch === null) {
    const bareMatch = text.match(/^CONSUMO\s+kWh\s+(?:kWh\s+)?([\d.,]+)\s+([\d.,]+)/im);
    if (bareMatch) {
      cons_nc = num(bareMatch[1]);
      price_kw = num(bareMatch[2]);
    }
  }
  const sceeMatch = text.match(/CONSUMO SCEE\s+kWh\s+([\d.,]+)\s+([\d.,]+)/i);
  const cons_scee = sceeMatch ? num(sceeMatch[1]) : null;
  const price_scee = sceeMatch ? num(sceeMatch[2]) : null;
  // Consumo total: na linha "ENERGIA ATIVA - KWH ... <anterior> <atual> <mult> <consumo>".
  const energiaMatch = text.match(/ENERGIA ATIVA - KWH.*?([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/is);
  const totalConsMatch = text.match(/ENERGIA ATIVA - KWH.*?([\d.,]+)\s+\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/is);
  const cons_total = energiaMatch
    ? num(energiaMatch[4])
    : totalConsMatch
      ? num(totalConsMatch[1])
      : cons_nc !== null && cons_scee !== null
        ? Math.round((cons_nc + cons_scee) * 100) / 100
        : null;
  const ilumMatch = text.match(/CONTRIB\. ILUM\. P[UÚ]BLICA - MUNICIPAL\s+([\d.,]+)/i);
  const public_lighting = ilumMatch ? num(ilumMatch[1]) : null;
  const jurosMatch = text.match(/JUROS MORAT[OÓ]RIA\.\s+([\d.,]+)/i);
  const multaMatch = text.match(/MULTA - \d{2}\/\d{4}\.\s+([\d.,]+)/i);
  const interest_fine = Math.round(((jurosMatch ? num(jurosMatch[1]) : 0) + (multaMatch ? num(multaMatch[1]) : 0)) * 100) / 100;
  const genMatch = text.match(/GERA[CÇ][AÃ]O CICLO.*?UC 0*(\d{12})/is);
  const generation_uc = genMatch ? genMatch[1] : null;

  const missing: string[] = [];
  if (!uc) missing.push("UC");
  if (!referenceMonth) missing.push("mês de referência");
  if (cons_total === null) missing.push("consumo");
  if (distributor_invoice === null) missing.push("valor total da distribuidora");
  if (missing.length > 0) {
    return { error: `Não consegui ler: ${missing.join(", ")}.` };
  }
  return {
    kind: "equatorial",
    uc_number: uc!,
    referenceMonth: referenceMonth!,
    due_date,
    consumption_kw: cons_total,
    consumption_non_compensated_kw: cons_nc,
    price_kw,
    consumption_scee_kw: cons_scee,
    price_scee,
    public_lighting,
    interest_fine,
    distributor_invoice,
    generation_uc,
    source_pdf_filename: filename,
  };
}

function parseDemae(text: string, filename: string): DemaeParsed | { error: string } {
  const matricula = text.match(/Matr[íi]cula:\s*([\d-]+)/i);
  const invoice = text.match(/Fatura n[ºo]:\s*(\d+)/i);
  const reference = text.match(/Refer[êe]ncia:\s*(\d{2}\/\d{4})/i);
  const due = text.match(/Data de Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const headerValue = text.match(/Valor:\s*R\$\s*([\d.,]+)/i);
  const total = text.match(/TOTAL A PAGAR\s+([\d.,]+)/i);
  const missing: string[] = [];
  if (!matricula) missing.push("matrícula");
  if (!invoice) missing.push("nº da fatura");
  if (!reference) missing.push("referência");
  if (!due) missing.push("vencimento");
  if (!headerValue) missing.push("valor");
  if (!total) missing.push("total a pagar");
  if (missing.length > 0) {
    return { error: `Não consegui ler: ${missing.join(", ")}.` };
  }
  const headerTotal = num(headerValue![1]);
  const totalValue = num(total![1]);
  if (Math.abs(headerTotal - totalValue) > 0.005) {
    return { error: "Valor do cabeçalho diverge do TOTAL A PAGAR." };
  }
  const [mm, yyyy] = reference![1].split("/");
  return {
    kind: "demae",
    matricula: matricula![1],
    invoice_number: invoice![1],
    referenceMonth: `${yyyy}-${mm}`,
    due_date: brDateToISO(due![1]),
    total: totalValue,
    source_pdf_filename: filename,
  };
}

/** Detecta o tipo pelo conteúdo e extrai os campos. Erro em texto legível. */
export function parseInvoiceText(text: string, filename: string): ParsedInvoicePdf | { error: string } {
  if (/Matr[íi]cula:/i.test(text)) return parseDemae(text, filename);
  if (/(\d\.\d{3}\.\d{3}\.\d{3}-\d{2})/.test(text) || /EQUATORIAL/i.test(text)) {
    return parseEquatorial(text, filename);
  }
  return { error: "Não reconheci o formato: não é fatura da Equatorial nem do Demae." };
}
