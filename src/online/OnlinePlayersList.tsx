import { Button } from "@/components/ui/button";
import { Mail, User } from "lucide-react";
import type { OnlinePlayer } from "./useLobbyPresence";

interface Props {
  players: OnlinePlayer[];
  myDeviceId: string;
  /** Si es passa, el botó "Invitar" està disponible i crida aquesta funció. */
  onInvite?: (player: OnlinePlayer) => void;
  /** Filtrar jugadors que ja estan en aquesta taula (no es mostren com a invitables). */
  excludeDeviceIds?: string[];
  title?: string;
  emptyLabel?: string;
}

export function OnlinePlayersList({
  players,
  myDeviceId,
  onInvite,
  excludeDeviceIds = [],
  title = "Jugadors connectats",
  emptyLabel = "No hi ha ningú més connectat",
}: Props) {
  const others = players.filter(
    (p) => p.deviceId !== myDeviceId && !excludeDeviceIds.includes(p.deviceId),
  );

  return (
    <section className="wood-surface border-2 border-primary/40 rounded-2xl p-3 flex flex-col gap-2">
      <div className="text-[11px] font-display tracking-widest uppercase text-primary/85 text-center">
        {title} <span className="text-muted-foreground">({others.length})</span>
      </div>
      {others.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-2">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
          {others.map((p) => {
            const busy = !!p.roomCode;
            return (
              <li
                key={p.deviceId}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-background/30 border border-primary/20"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <User className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                  <span className="text-xs text-foreground truncate">{p.name}</span>
                  {busy && (
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">
                      a {p.roomCode}
                    </span>
                  )}
                </div>
                {onInvite && !busy && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px] border-primary/40 text-primary hover:bg-primary/10"
                    onClick={() => onInvite(p)}
                  >
                    <Mail className="w-3 h-3 mr-1" /> Invitar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
