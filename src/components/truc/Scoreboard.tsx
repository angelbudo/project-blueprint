import { useEffect, useRef, useState } from "react";
import { MatchState, RoundSummary, TeamId } from "@/game/types";
import { cn } from "@/lib/utils";

export type ToastKind =
  // Envit guanyat (querit)
  | "envit" | "renvit" | "falta-envit"
  // Envit no querit
  | "envit-nq" | "renvit-nq" | "falta-envit-nq"
  // Truc guanyat (querit)
  | "truc" | "retruc" | "quatre" | "joc-fora"
  // Truc no querit
  | "truc-nq" | "retruc-nq" | "quatre-nq" | "joc-fora-nq";

export interface PointToast {
  id: string | number;
  team: TeamId;
  points: number;
  label: string;
  kind: ToastKind;
}

let toastIdCounter = 0;
export function nextToastId() { return ++toastIdCounter; }

export const TOAST_LABEL: Record<ToastKind, string> = {
  envit: "Envit",
  renvit: "Torne a envidar",
  "falta-envit": "Falta",
  "envit-nq": "Envit no Volgut",
  "renvit-nq": "Torne a envidar no Volgut",
  "falta-envit-nq": "Falta no Volgut",
  truc: "Truc",
  retruc: "Retruc",
  quatre: "Quatre val",
  "joc-fora": "Joc fora",
  "truc-nq": "Truc no Volgut",
  "retruc-nq": "Retruc no Volgut",
  "quatre-nq": "Quatre val no Volgut",
  "joc-fora-nq": "Joc fora no Volgut",
};

// Estils inspirats en ShoutBubble: fons saturats, vora gruixuda i animació shout.
export const TOAST_STYLE: Record<ToastKind, string> = {
  envit: "bg-accent text-accent-foreground border-accent",
  renvit: "bg-accent text-accent-foreground border-accent",
  "falta-envit": "bg-destructive text-destructive-foreground border-destructive",
  "envit-nq": "bg-accent/70 text-accent-foreground border-accent/80 border-dashed",
  "renvit-nq": "bg-accent/70 text-accent-foreground border-accent/80 border-dashed",
  "falta-envit-nq": "bg-destructive/70 text-destructive-foreground border-destructive/80 border-dashed",
  truc: "bg-secondary text-secondary-foreground border-secondary",
  retruc: "bg-secondary text-secondary-foreground border-secondary",
  quatre: "bg-secondary text-secondary-foreground border-secondary",
  "joc-fora": "bg-destructive text-destructive-foreground border-destructive",
  "truc-nq": "bg-secondary/70 text-secondary-foreground border-secondary/80 border-dashed",
  "retruc-nq": "bg-secondary/70 text-secondary-foreground border-secondary/80 border-dashed",
  "quatre-nq": "bg-secondary/70 text-secondary-foreground border-secondary/80 border-dashed",
  "joc-fora-nq": "bg-destructive/70 text-destructive-foreground border-destructive/80 border-dashed",
};

export function toastFamily(kind: ToastKind): "envit" | "truc" {
  return kind.includes("envit") ? "envit" : "truc";
}

export function pointToastKey(roundIndex: number, toast: Pick<PointToast, "kind">): string {
  return `${roundIndex}-${toastFamily(toast.kind)}`;
}

function envitKind(level: 2 | 4 | "falta" | undefined, rejected: boolean): ToastKind {
  if (level === 4) return rejected ? "renvit-nq" : "renvit";
  if (level === "falta") return rejected ? "falta-envit-nq" : "falta-envit";
  return rejected ? "envit-nq" : "envit";
}

function trucKind(level: 0 | 2 | 3 | 4 | 24 | undefined, rejected: boolean): ToastKind {
  if (level === 24) return rejected ? "joc-fora-nq" : "joc-fora";
  if (level === 4) return rejected ? "quatre-nq" : "quatre";
  if (level === 3) return rejected ? "retruc-nq" : "retruc";
  if (level === 2) return rejected ? "truc-nq" : "truc";
  // Sense cant: 1 punt "natural"
  return "truc";
}

export function buildToastsFromSummary(summary: RoundSummary): Omit<PointToast, "id">[] {
  const out: Omit<PointToast, "id">[] = [];
  const addToast = (toast: Omit<PointToast, "id">) => {
    const family = toastFamily(toast.kind);
    if (out.some((existing) => toastFamily(existing.kind) === family)) return;
    out.push(toast);
  };
  if (summary.envitWinner && summary.envitPoints > 0) {
    const kind = envitKind(summary.envitLevel, !!summary.envitRejected);
    addToast({
      team: summary.envitWinner,
      points: summary.envitPoints,
      label: TOAST_LABEL[kind],
      kind,
    });
  }
  if (summary.trucWinner && summary.trucPoints > 0) {
    // Sempre mostrem cartell del truc al final de la mà, hi haja hagut cant
    // o no (punt natural). Si no hi va haver cant, usem el "truc" base com
    // a etiqueta amb el text "+1 Truc" perquè es vegen els punts sumats.
    const kind = trucKind(summary.trucLevel ?? 2, !!summary.trucRejected);
    addToast({
      team: summary.trucWinner,
      points: summary.trucPoints,
      label: TOAST_LABEL[kind],
      kind,
    });
  }
  return out;
}

export function Scoreboard({ match }: { match: MatchState }) {
  const { scores, camesWon, targetCama, targetCames } = match;

  const [toasts, setToasts] = useState<PointToast[]>([]);
  const lastHistoryLenRef = useRef(match.history.length);

  useEffect(() => {
    const prevLen = lastHistoryLenRef.current;
    const curLen = match.history.length;
    if (curLen <= prevLen) {
      lastHistoryLenRef.current = curLen;
      return;
    }
    const newSummaries = match.history.slice(prevLen);
    lastHistoryLenRef.current = curLen;

    const incoming: PointToast[] = [];
    newSummaries.forEach((s, offset) => {
      const roundIndex = prevLen + offset;
      for (const t of buildToastsFromSummary(s)) {
        const id = pointToastKey(roundIndex, t);
        if (!incoming.some((existing) => existing.id === id)) {
          incoming.push({ id, ...t });
        }
      }
    });
    if (incoming.length === 0) return;

    setToasts((prev) => {
      const existingIds = new Set(prev.map((toast) => toast.id));
      const fresh = incoming.filter((toast) => !existingIds.has(toast.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });

    // Mantenim els cartells visibles exactament 3s.
    incoming.forEach((toast) => {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== toast.id));
      }, 3000);
    });
  }, [match.history]);

  const toastsByTeam: Record<TeamId, PointToast[]> = {
    nos: toasts.filter((t) => t.team === "nos"),
    ells: toasts.filter((t) => t.team === "ells"),
  };

  return (
    <div className="inline-flex items-stretch gap-0 px-3 py-2 rounded-xl wood-surface border-2 border-primary-deep/40 card-shadow">
      <ScoreCol
        label="Nosaltres"
        males={scores.nos.males}
        bones={scores.nos.bones}
        target={targetCama}
        team="nos"
        toasts={toastsByTeam.nos}
      />
      <CamesCol
        nosWon={camesWon.nos}
        ellsWon={camesWon.ells}
        target={targetCames}
      />
      <ScoreCol
        label="Ells"
        males={scores.ells.males}
        bones={scores.ells.bones}
        target={targetCama}
        team="ells"
        toasts={toastsByTeam.ells}
      />
    </div>
  );
}

/** Columna central CAMES amb la mateixa estructura de 3 files que ScoreCol
 *  per garantir que les tipografies i alçades queden alineades. */
function CamesCol({
  nosWon, ellsWon, target,
}: { nosWon: number; ellsWon: number; target: number }) {
  return (
    <div className="flex flex-col items-center justify-between px-2 py-0">
      {/* Fila 1: reserva l'alçada de l'etiqueta superior dels ScoreCol */}
      <span className="text-[10px] font-display tracking-widest uppercase leading-none invisible">
        ·
      </span>
      {/* Fila 2: contingut central (mateixa alçada que el número) */}
      <div className="flex items-center justify-center gap-1.5 leading-none">
        <Dots won={nosWon} target={target} team="nos" />
        <span
          className="text-[10px] text-primary/70 font-display tracking-widest leading-none"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          CAMES
        </span>
        <Dots won={ellsWon} target={target} team="ells" />
      </div>
      {/* Fila 3: reserva l'alçada de l'estat MALES/BONES */}
      <span className="text-[9px] font-display tracking-widest uppercase mt-0.5 leading-none invisible">
        ·
      </span>
    </div>
  );
}

function Dots({ won, target, team }: { won: number; target: number; team: "nos" | "ells" }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: target }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-2 h-2 rounded-full border",
            i < won
              ? team === "nos" ? "bg-team-nos border-team-nos" : "bg-team-ells border-team-ells"
              : "border-primary/40",
          )}
        />
      ))}
    </div>
  );
}

function ScoreCol({
  label, males, bones, target, team, toasts,
}: {
  label: string;
  males: number;
  bones: number;
  target: number;
  team: "nos" | "ells";
  toasts: PointToast[];
}) {
  // males: 0..12 = malas, 12 significa pasar a buenas
  // bones: 0..12 = buenas
  const inBones = males >= target;
  const displayValue = inBones ? bones : males;
  const stateLabel = inBones ? "BONES" : "MALES";

  const prevInBones = useRef(inBones);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!prevInBones.current && inBones) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 900);
      return () => clearTimeout(t);
    }
    prevInBones.current = inBones;
  }, [inBones]);

  return (
    <div className="relative flex flex-col items-center justify-between w-[88px]">
      {/* Cartells flotants tipus crit (envit/truc) sobre el marcador */}
      <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full flex flex-col items-center gap-1.5 z-30">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "px-3 py-1.5 rounded-2xl rounded-bl-sm whitespace-nowrap",
              "font-display font-black text-xs border-2 shadow-lg",
              "animate-shout origin-bottom",
              TOAST_STYLE[t.kind],
            )}
          >
            <span className="mr-1 text-sm">+{t.points}</span>
            <span className="uppercase tracking-wider">{t.label}</span>
          </div>
        ))}
      </div>

      {/* Fila 1: nom equip */}
      <span
        className={cn(
          "text-[10px] font-display tracking-widest uppercase leading-none",
          team === "nos" ? "text-team-nos" : "text-team-ells",
        )}
      >
        {label}
      </span>
      {/* Fila 2: número */}
      <div className={cn("flex items-baseline justify-center gap-1 leading-none", pulse && "animate-bones-pulse")}>
        <span
          className={cn(
            "text-xl font-display font-bold leading-none transition-colors duration-500",
            inBones ? "text-primary" : "text-gold",
          )}
        >
          {displayValue}
          <span className="text-[9px] text-muted-foreground ml-0.5">/{target}</span>
        </span>
      </div>
      {/* Fila 3: estat MALES/BONES */}
      <span
        className={cn(
          "text-[9px] font-display tracking-widest uppercase mt-0.5 leading-none transition-colors duration-500",
          inBones ? "text-primary/80" : "text-muted-foreground",
        )}
      >
        {stateLabel}
      </span>
    </div>
  );
}
