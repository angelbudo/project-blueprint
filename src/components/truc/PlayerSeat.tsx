import { MatchState, PlayerId, teamOf } from "@/game/types";
import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";
import { PresenceDot } from "@/online/PresenceDot";
import type { PresenceStatus } from "@/online/presence";

const POSITION_LABEL: Record<PlayerId, string> = {
  0: "Tu",
  1: "Rival dreta",
  2: "Company",
  3: "Rival esquerra",
};

interface PlayerSeatProps {
  player: PlayerId;
  match: MatchState;
  position: "bottom" | "top" | "left" | "right";
  name?: string;
  cardCount?: number;
  isPendingResponder?: boolean;
  /** Estat de presència (online/away/offline) per a l'indicador. Si és
   *  `null`/`undefined`, no es mostra cap punt (típicament per a bots o
   *  partides offline). */
  presence?: PresenceStatus | null;
  /** Timestamp ISO del darrer heartbeat (per al tooltip "fa Xs"). */
  presenceLastSeen?: string | null;
}

export function PlayerSeat({
  player,
  match,
  position,
  name,
  isPendingResponder,
  presence,
  presenceLastSeen,
}: PlayerSeatProps) {
  const isTurn = match.round.turn === player;
  const team = teamOf(player);
  const cards = match.round.hands[player].length;

  return (
    <div
      className={cn(
        "relative flex items-center gap-2 px-3 py-1.5 rounded-full border-2 transition-all",
        "bg-background/70 backdrop-blur-sm",
        team === "nos" ? "border-team-nos/50" : "border-team-ells/50",
        isTurn && "animate-pulse-gold border-primary",
        isPendingResponder && "border-primary ring-2 ring-primary/60 shadow-[0_0_18px_hsl(var(--primary)/0.55)]",
        position === "left" && "flex-col gap-0.5 px-2 py-2",
        position === "right" && "flex-col gap-0.5 px-2 py-2",
        // Atenuació visual quan el jugador no està en línia.
        presence === "offline" && "opacity-60",
      )}
    >
      {isPendingResponder && (
        <div
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md animate-bounce z-10"
          title="Pendent de respondre"
          aria-label="Pendent de respondre"
        >
          <HelpCircle className="w-4 h-4" strokeWidth={2.5} />
        </div>
      )}
      <div
        className={cn(
          "relative w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-sm",
          team === "nos" ? "bg-team-nos text-white" : "bg-team-ells text-white",
        )}
      >
        {(name ?? POSITION_LABEL[player])[0]}
        {presence && (
          <PresenceDot
            status={presence}
            lastSeen={presenceLastSeen ?? null}
            size={10}
            className="absolute -bottom-0.5 -right-0.5"
          />
        )}
      </div>
      <div className="flex flex-col items-start min-w-0">
        <span className="text-xs font-semibold text-foreground truncate max-w-[90px]">
          {name ?? POSITION_LABEL[player]}
        </span>
        <span className="text-[10px] text-muted-foreground">{cards} cartes</span>
      </div>
    </div>
  );
}
