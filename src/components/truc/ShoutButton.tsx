import { ShoutKind } from "@/game/types";
import { cn } from "@/lib/utils";

const LABEL: Record<ShoutKind, string> = {
  envit: "Envit!",
  renvit: "Torne a envidar!",
  "falta-envit": "Falta envit!",
  vull: "Vull!",
  "no-vull": "No vull",
  truc: "Truc!",
  retruc: "Retruc!",
  quatre: "Quatre val!",
  "joc-fora": "Joc fora!",
  passe: "Passe",
  "so-meues": "So meues",
};

const STYLE: Record<ShoutKind, string> = {
  envit: "bg-accent text-accent-foreground border-accent/60",
  renvit: "bg-accent text-accent-foreground border-accent/60",
  "falta-envit": "bg-destructive text-destructive-foreground border-destructive/60",
  vull: "bg-primary text-primary-foreground border-primary/60",
  "no-vull": "bg-muted text-muted-foreground border-border",
  truc: "bg-secondary text-secondary-foreground border-secondary/60",
  retruc: "bg-secondary text-secondary-foreground border-secondary/60",
  quatre: "bg-secondary text-secondary-foreground border-secondary/60",
  "joc-fora": "bg-destructive text-destructive-foreground border-destructive/60",
  passe: "bg-muted text-muted-foreground border-border",
  "so-meues": "bg-muted text-muted-foreground border-border",
};

export function ShoutLabel({ what }: { what: ShoutKind }) {
  return LABEL[what];
}

interface ShoutButtonProps {
  what: ShoutKind;
  onClick: () => void;
  size?: "sm" | "md";
}

export function ShoutButton({ what, onClick, size = "md" }: ShoutButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "font-display font-bold rounded-lg border-2 transition-all active:scale-95 shadow-md",
        size === "md" ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-xs",
        STYLE[what],
        "hover:scale-105 hover:gold-glow"
      )}
    >
      {LABEL[what]}
    </button>
  );
}

interface ShoutBubbleProps {
  what: ShoutKind;
  className?: string;
  labelOverride?: string;
}

export function ShoutBubble({ what, className, labelOverride }: ShoutBubbleProps) {
  return (
    <div
      className={cn(
        "absolute pointer-events-none z-30 px-4 py-2 rounded-2xl rounded-bl-sm",
        "font-display font-black text-lg border-2 animate-shout origin-bottom-left",
        STYLE[what],
        className
      )}
    >
      {labelOverride ?? LABEL[what]}
    </div>
  );
}

interface ShoutBadgeProps {
  what: ShoutKind;
  className?: string;
  labelOverride?: string;
  /** Si està a true, no anima el pulse daurat (usat quan ja s'ha respost al cant). */
  quiet?: boolean;
}

export function ShoutBadge({ what, className, labelOverride, quiet }: ShoutBadgeProps) {
  return (
    <div
      className={cn(
        "pointer-events-none z-30 px-2 py-0.5 rounded-md",
        "font-display font-bold text-[10px] uppercase tracking-wider border shadow-md",
        !quiet && "animate-pulse-gold",
        STYLE[what],
        className
      )}
    >
      {labelOverride ?? LABEL[what]}
    </div>
  );
}
