import { memo, useRef } from "react";
import { MatchState, PlayerId, Suit, Rank, Trick } from "@/game/types";
import { PlayingCard } from "./PlayingCard";
import { cn } from "@/lib/utils";

/** Posicions visuals indexades per "posició relativa" des del jugador local
 *  (0 = baix/jo, 1 = dreta, 2 = dalt, 3 = esquerra). */
const POSITION_BY_REL: Record<0 | 1 | 2 | 3, { x: string; y: string; rot: string }> = {
  0: { x: "50%", y: "72%", rot: "4deg" },
  1: { x: "72%", y: "50%", rot: "-86deg" },
  2: { x: "50%", y: "28%", rot: "184deg" },
  3: { x: "28%", y: "50%", rot: "94deg" },
};

/**
 * Desplaçament d'on "vola" la carta quan es juga (expressat com a traslació
 * local dins del frame rotat del jugador). Com que la posició de la carta
 * ja està centrada al seu seient i rotada, només cal desplaçar-la "cap a
 * baix" (positiu en Y local) per a que visualment semble que prové del
 * jugador corresponent en aquella direcció.
 */
const PLAY_FROM_OFFSET_PX = 140;

interface TableSurfaceProps {
  match: MatchState;
  /** Seient (0..3) que ha de mostrar-se a baix. Per defecte 0. */
  perspectiveSeat?: PlayerId;
  /** Conjunt d'ids de cartes jugades que NO s'han de renderitzar (perquè
   *  un overlay s'està encarregant d'animar-les, p. ex. la revelació
   *  d'envit). */
  hiddenCardIds?: ReadonlySet<string>;
}

type PlayedEntry = { suit: Suit; rank: Rank; id: string };

function TableSurfaceComponent({ match, perspectiveSeat = 0, hiddenCardIds }: TableSurfaceProps) {
  const r = match.round;
  const posOf = (p: PlayerId) =>
    POSITION_BY_REL[(((p - perspectiveSeat) + 4) % 4) as 0 | 1 | 2 | 3];
  const lastTrick: Trick | undefined = r.tricks[r.tricks.length - 1];
  const prevTrick: Trick | undefined =
    r.tricks.length > 1 ? r.tricks[r.tricks.length - 2] : undefined;

  const displayTrick: Trick | undefined =
    lastTrick && lastTrick.cards.length === 0 ? prevTrick : lastTrick;

  const previousByPlayer: Record<PlayerId, PlayedEntry[]> = { 0: [], 1: [], 2: [], 3: [] };
  r.tricks.forEach((t) => {
    if (t === displayTrick) return;
    t.cards.forEach((tc) => {
      previousByPlayer[tc.player].push({
        suit: tc.card.suit,
        rank: tc.card.rank,
        id: tc.card.id,
      });
    });
  });

  // Índex (dins r.tricks) de la baza que acaba de quedar "ombrejada".
  // Si la baza visualitzada (displayTrick) té exactament 1 carta, significa
  // que el primer jugador de la nova baza acaba de tirar, i les cartes de
  // la baza anterior s'estan reposicionant al costat (animació de lliscament).
  let justShadedTrickIndex: number | null = null;
  if (displayTrick && displayTrick.cards.length === 1) {
    const idx = r.tricks.indexOf(displayTrick);
    if (idx > 0) justShadedTrickIndex = idx - 1;
  }

  // Per a cada jugador, l'id de la carta que pertany a la baza acabada
  // d'ombrejar (la que ha de fer l'animació de lliscament).
  const slidingCardIdByPlayer: Record<PlayerId, string | null> = { 0: null, 1: null, 2: null, 3: null };
  if (justShadedTrickIndex !== null) {
    const justShaded = r.tricks[justShadedTrickIndex];
    justShaded.cards.forEach((tc) => {
      slidingCardIdByPlayer[tc.player] = tc.card.id;
    });
  }

  // Recorda quines cartes ja s'han vist ací al tauler per a no reanimar-les
  // en re-renders posteriors (evita que un update del MatchState no
  // relacionat amb aquesta carta torne a disparar l'animació d'entrada).
  const seenCardsRef = useRef<Set<string>>(new Set());
  const seen = seenCardsRef.current;
  const currentCardIds = new Set<string>();
  r.tricks.forEach((t) => t.cards.forEach((tc) => currentCardIds.add(tc.card.id)));
  // Si s'ha reiniciat la ronda (cap carta present), netegem el registre.
  if (currentCardIds.size === 0) seen.clear();
  // Elimina entrades que ja no estan presents (p. ex. reparteix nou).
  for (const id of Array.from(seen)) {
    if (!currentCardIds.has(id)) seen.delete(id);
  }
  const wasSeen = (id: string) => seen.has(id);
  const markSeen = (id: string) => seen.add(id);

  return (
    <div className="relative w-full h-full min-h-[420px]">
      <div className="absolute inset-2 rounded-[48%/40%] wood-surface border-4 border-primary/30 card-shadow" />
      <div className="absolute inset-5 rounded-[46%/38%] felt-surface border border-primary/20 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-primary/10 font-display font-black text-5xl tracking-widest -rotate-12 select-none whitespace-nowrap">
            TRUC VALENCIÀ
          </div>
        </div>

        {([0, 1, 2, 3] as PlayerId[]).map((p) => {
          const pos = posOf(p);
          const prev = previousByPlayer[p].filter((c) => !hiddenCardIds?.has(c.id));
          const currentTCRaw = displayTrick?.cards.find((tc) => tc.player === p);
          const currentTC = currentTCRaw && !hiddenCardIds?.has(currentTCRaw.card.id) ? currentTCRaw : undefined;
          const isWinner = displayTrick?.winner === p;

          if (prev.length === 0 && !currentTC) return null;

          return (
            <div
              key={`pile-${p}`}
              className="absolute transition-transform duration-300 ease-out"
              style={{
                left: pos.x,
                top: pos.y,
                transform: `translate(-50%, -50%) rotate(${pos.rot})`,
              }}
            >
              <div className="relative">
                {prev.map((c, i) => {
                  const fromTop = prev.length - 1 - i;
                  const offset = (fromTop + 1) * 28;
                  const flip = p === 0 || p === 1 || p === 2 || p === 3;
                  let extraTopPx = 0;
                  if (p === 0 || p === 1 || p === 2 || p === 3) {
                    if (prev.length === 1) extraTopPx = 15;
                    else if (prev.length === 2) extraTopPx = i === 0 ? 30 : 15;
                  }
                  const finalLeftPx = flip ? offset : -offset;
                  const isSliding = slidingCardIdByPlayer[p] === c.id;
                  const slideStyle = isSliding
                    ? ({
                        ["--slide-from-x" as string]: `${-finalLeftPx}px`,
                        ["--slide-from-mt" as string]: `${-extraTopPx}px`,
                      } as React.CSSProperties)
                    : {};
                  return (
                    <div
                      key={`prev-${c.id}`}
                      className="absolute top-1/2 -translate-y-1/2 transition-[left,margin] duration-300 ease-out"
                      style={{
                        left: `${finalLeftPx}px`,
                        marginTop: extraTopPx ? `${extraTopPx}px` : undefined,
                        zIndex: i,
                      }}
                    >
                      <div
                        className={cn(isSliding && "animate-slide-to-shaded")}
                        style={{
                          filter: "brightness(0.82) saturate(0.9)",
                          opacity: 0.85,
                          ...(isSliding ? slideStyle : {}),
                        }}
                      >
                        <PlayingCard suit={c.suit} rank={c.rank} size="md" />
                      </div>
                    </div>
                  );
                })}

                {currentTC && (() => {
                  const isNew = !wasSeen(currentTC.card.id);
                  if (isNew) markSeen(currentTC.card.id);
                  const playStyle = isNew
                    ? ({
                        ["--play-from-x" as string]: "0px",
                        ["--play-from-y" as string]: `${PLAY_FROM_OFFSET_PX}px`,
                      } as React.CSSProperties)
                    : undefined;
                  return (
                    <div
                      key={`curr-${currentTC.card.id}`}
                      className={cn("relative", isNew && "animate-play", isWinner && "z-20")}
                      style={{ zIndex: 10, ...(playStyle ?? {}) }}
                    >
                      <PlayingCard
                        suit={currentTC.card.suit}
                        rank={currentTC.card.rank}
                        size="md"
                      />
                      {isWinner && (
                        <div className="absolute -inset-1 rounded-card border-2 border-primary animate-pulse-gold pointer-events-none" />
                      )}
                    </div>
                  );
                })()}

                {!currentTC && prev.length === 0 && (
                  <div className="invisible">
                    <PlayingCard suit="oros" rank={1} size="md" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TableSurface = memo(TableSurfaceComponent, (prev, next) => {
  if (prev.perspectiveSeat !== next.perspectiveSeat) return false;
  if (prev.hiddenCardIds !== next.hiddenCardIds) return false;
  return prev.match.round === next.match.round;
});
