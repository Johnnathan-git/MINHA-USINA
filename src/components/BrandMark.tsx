import { cn } from "@/lib/utils";

/** Logotipo da Usina dos Irmãos. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img 
      src="/usina-logo-256.webp"
      width={256}
      height={256}
      decoding="async"
      alt="Logo Usina dos Irmãos"
      className={cn("h-full w-full object-contain rounded-full", className)}
    />
  );
}

export function BrandLockup({ compact = false, onSidebar = false }: { compact?: boolean; onSidebar?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-transparent">
        <BrandMark />
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className={cn("font-sans text-[15px] font-bold tracking-tight text-foreground dark:text-glow", onSidebar && "light:text-white")}>
            Usina dos Irmãos
          </div>
          <div className={cn("text-[7px] font-semibold uppercase tracking-[0.22em] text-muted-foreground -mt-0.5", onSidebar && "light:text-white/60")}>
            Gestão de energia
          </div>

        </div>
      )}
    </div>
  );
}
