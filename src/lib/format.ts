export const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number.isFinite(n) ? n : 0,
  );

export const monthLabel = (d: Date) => {
  const m = d.toLocaleString("pt-BR", { month: "short" }).replace(".", "");
  const y = d.getFullYear().toString().slice(-2);
  return `${m.charAt(0).toUpperCase()}${m.slice(1)}/${y}`;
};

export const monthLabelLong = (d: Date) => {
  const s = d.toLocaleString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Parses "yyyy-mm-dd" as a LOCAL date (avoids UTC shifting to previous month)
export const parseISODateLocal = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

export const monthLabelFromISO = (iso: string) => monthLabel(parseISODateLocal(iso));

export const formatDateBR = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

// yyyy-mm-01 for a given Date
export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

export const parseMonthKey = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
};

export const initial = (s: string) => (s?.trim()?.[0] ?? "?").toUpperCase();

export const CLIENT_COLORS = [
  "#C97B5E", // Terracotta
  "#5B7C99", // Blue Grey
  "#8B7355", // Sage Brown
  "#6B8A6E", // Muted Green
  "#9B6B8C", // Muted Purple
  "#4A8B8C", // Teal
  "#B08968", // Sand
  "#7B6D8D", // Lavender Grey
  "#2F6F62", // Petrol Green
  "#151B2E", // Navy
  "#C98A3E", // Amber
  "#B5533E", // Dark Terracotta
  "#4F46E5", // Indigo
  "#0891B2", // Cyan
  "#059669", // Emerald
  "#DC2626", // Red
  "#EA580C", // Orange
  "#7C3AED", // Violet
  "#DB2777", // Pink
  "#2563EB", // Blue
];

/** Cor de texto legível sobre um fundo (preto em fundo claro, branco em fundo escuro). */
export const textOnColor = (hex: string) => {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#000000';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#000000' : '#FFFFFF';
};

/** Fundo suave a partir da cor do cliente (visual mais sóbrio). */
export const softBg = (hex: string) => `${hex}20`;

/** Converte a cor principal para um tom pastel claro. */
export const getClientSoftColor = (color: string) => {
  // Retorna apenas a cor de texto branca, pois o fundo agora é sempre o sólido do cliente no avatar
  return 'text-white';
};

/** Retorna o estilo do botão baseada na cor do cliente. */
export const getClientButtonStyles = (color: string) => {
  return {
    backgroundColor: color,
  };
};

export const EXPENSE_CATEGORIES = [
  "Fatura Usina",
  "Manutenção",
  "Compra de Placas",
  "Impostos",
  "Salários",
  "Outros",
];