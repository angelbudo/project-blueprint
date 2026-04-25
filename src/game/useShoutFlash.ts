/**
 * Hook compartit que deriva el "flash" transitori d'un cant a partir del
 * `match.round.log`. Detecta quan apareix un nou esdeveniment `shout` i el
 * mostra durant ~1.6s. S'utilitza tant en la partida offline (`useTrucMatch`)
 * com en la partida online (`OnlinePartida`) perquè l'animació sigui idèntica.
 *
 * No té efectes secundaris més enllà d'un `setTimeout` per netejar el flash;
 * no parla, no toca cap altre estat. La locució en veu alta segueix vivint
 * a `useTrucMatch` (només offline) perquè depèn d'una preferència local.
 */
import { useEffect, useRef, useState } from "react";
import type { MatchState, PlayerId, ShoutKind } from "./types";

export interface ShoutFlash {
  player: PlayerId;
  what: ShoutKind;
  labelOverride?: string;
}

const QUESTION_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "envit", "renvit", "falta-envit",
  "truc", "retruc", "quatre", "joc-fora",
]);

export function useShoutFlash(match: MatchState | null): ShoutFlash | null {
  const [flash, setFlash] = useState<ShoutFlash | null>(null);
  const lastSeenIdxRef = useRef<number>(-1);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!match) return;
    const log = match.round.log;
    // Localitza l'índex del darrer esdeveniment `shout` del log.
    let lastShoutIdx = -1;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].type === "shout") { lastShoutIdx = i; break; }
    }
    if (lastShoutIdx === -1 || lastShoutIdx === lastSeenIdxRef.current) return;
    lastSeenIdxRef.current = lastShoutIdx;
    const ev = log[lastShoutIdx];
    if (ev.type !== "shout") return;
    setFlash({ player: ev.player, what: ev.what });
    if (!QUESTION_SHOUTS.has(ev.what)) {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setFlash(null);
        timerRef.current = null;
      }, 1600) as unknown as number;
    }
  }, [match]);

  // Reset quan canvia la ronda (nou log).
  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return flash;
}