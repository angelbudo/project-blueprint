import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PlayingCard } from "@/components/truc/PlayingCard";
import { TableSurface } from "@/components/truc/TableSurface";
import { PlayerSeat } from "@/components/truc/PlayerSeat";
import { ShoutBubble, ShoutBadge, ShoutButton } from "@/components/truc/ShoutButton";
import { ChatPanel, ChatBubble } from "@/components/truc/ChatPanel";
import { DealAnimation } from "@/components/truc/DealAnimation";
import { EnvitReveal } from "@/components/truc/EnvitReveal";
import { BotDebugPanel } from "@/components/truc/BotDebugPanel";
import {
  Action,
  MatchState,
  PlayerId,
  ShoutKind,
  TeamId,
  Trick,
  teamOf,
} from "@/game/types";
import {
  buildToastsFromSummary,
  nextToastId,
  pointToastKey,
  TOAST_STYLE,
  type PointToast,
} from "@/components/truc/Scoreboard";
import { bestEnvit, cardStrength, playerEnvitBreakdown, RANK_NAME, SUIT_NAME, SUIT_SYMBOL } from "@/game/deck";
import { toast } from "sonner";
import { ChatMessage, ChatPhraseId, PHRASES } from "@/game/phrases";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Trophy,
  RotateCcw,
  Volume2,
  VolumeOff,
  LogOut,
  Pause,
  Play,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { PresenceStatus } from "@/online/presence";

/**
 * Cartell persistent que indica que un jugador ha cantat envit en aquesta
 * mà. Es manté visible fins que comença la mà següent. Si l'envit ha estat
 * resolt mostra a sota una segona insígnia "Volgut" o "No volgut".
 */
/**
 * Símbol (✓/✗) que es col·loca al costat del ShoutBadge "Envit!" un cop
 * l'envit s'ha resolt. El cartell d'envit en si el dibuixa el ShoutBadge
 * original (que es manté visible fins al final de la mà).
 */
function EnvitOutcomeMark({
  outcome,
  className,
}: {
  outcome: "pending" | "volgut" | "no-volgut";
  className?: string;
}) {
  if (outcome === "pending") return null;
  return (
    <span
      className={cn(
        "pointer-events-none z-30 font-display font-black text-2xl leading-none drop-shadow-md",
        outcome === "volgut"
          ? "text-green-500 [text-shadow:_0_0_6px_rgba(34,197,94,0.6),_0_2px_2px_rgba(0,0,0,0.6)]"
          : "text-red-500 [text-shadow:_0_0_6px_rgba(239,68,68,0.6),_0_2px_2px_rgba(0,0,0,0.6)]",
        className
      )}
      aria-label={outcome === "volgut" ? "Volgut" : "No volgut"}
    >
      {outcome === "volgut" ? "✓" : "✗"}
    </span>
  );
}

/** Frases relacionades amb l'envit que s'amaguen del ChatPanel un cop l'envit
 *  s'ha resolt o ja s'ha passat de la primera baza. */
const ENVIT_PHRASE_IDS: ReadonlySet<ChatPhraseId> = new Set<ChatPhraseId>([
  "tens-envit",
  "vols-envide",
  "quant-envit",
  "si-tinc-n",
  "envida",
  "tira-falta",
]);

/** Determina si un crit pertany a la família de l'envit (es mostra amunt
 *  del seient) o a la família del truc (es mostra avall del seient). */
function isEnvitShout(what: ShoutKind | null | undefined): boolean {
  return what === "envit" || what === "renvit" || what === "falta-envit";
}

/**
 * Component visual del tauler de Truc. No té estat de joc propi: rep
 * `match`, accions humanes i callbacks. S'utilitza tant per a la partida
 * solo (`/partida`) com per a la versió online.
 *
 * Sempre mostra el seient `HUMAN = 0` a baix (perspectiva del jugador local
 * en mode solo). En el mode online, el wrapper ha de rotar el `match` o
 * passar les dades amb el seient propi a la posició 0 abans de cridar açò.
 */

export interface TrucBoardProps {
  match: MatchState;
  /** Accions legals per al jugador humà (seient 0). */
  humanActions: Action[];
  /** Despatxa una acció del jugador humà. */
  dispatch: (player: PlayerId, action: Action) => void;

  /** Crit instantani per a l'animació flotant central. */
  shoutFlash: { what: string; labelOverride?: string; player?: PlayerId } | null;
  lastShoutByPlayer: Record<PlayerId, ShoutKind | null>;
  shoutLabelByPlayer: Record<PlayerId, string | null>;
  acceptedShoutByPlayer: Record<PlayerId, boolean>;
  /** Família del darrer cant per jugador: "envit" (cartell amunt) o "truc"
   *  (cartell avall). Si no es proporciona, s'infereix del shout actual. */
  shoutFamilyByPlayer?: Record<PlayerId, "envit" | "truc" | null>;
  /** Cartell persistent d'envit per jugador (independent del cartell de truc). */
  envitShoutByPlayer?: Record<PlayerId, ShoutKind | null>;
  envitShoutLabelByPlayer?: Record<PlayerId, string | null>;
  /** Estat persistent del cartell d'envit per jugador (visible fins la nova mà). */
  envitOutcomeByPlayer?: Record<PlayerId, { outcome: "pending" | "volgut" | "no-volgut" } | null>;

  /** Missatges de xat per jugador (l'últim emès recentment). */
  messages: ChatMessage[];
  /** L'humà parla. */
  onSay: (phraseId: ChatPhraseId) => void;

  /** Callbacks de hint al bot company i nova partida. */
  onNewGame: () => void;
  onAbandon: () => void;

  /** Etiquetes dels seients (perspectiva des del jugador). */
  seatNames?: { bottom?: string; left?: string; top?: string; right?: string };

  /**
   * Si està definit, s'usa per disparar l'animació de reparteix. Quan canvia
   * el valor s'inicia una nova animació. Si és `null` mai es reparteix
   * (útil per a forçar UI sense animació).
   */
  dealKey?: string | null;

  /** Mostra el panell de debug dels bots. */
  showBotDebug?: boolean;

  /**
   * Seient (0..3) que ha de mostrar-se a la posició inferior. Per defecte 0
   * (mode solo). En mode online es passa el seient del propi jugador per a
   * que sempre es vegi a sí mateix avall.
   */
  perspectiveSeat?: PlayerId;

  /** Contingut opcional inserit entre la mà del jugador i el ChatPanel
   *  (utilitzat pel mode online per al xat lliure de la mesa). */
  belowHandSlot?: React.ReactNode;

  /** Temps màxim per torn (segons). Si l'humà no juga, es tira automàticament. */
  turnTimeoutSec?: 15 | 30 | 45 | 60;
  /** Callback per canviar el temps màxim per torn des del propi tauler. */
  onChangeTurnTimeoutSec?: (sec: 15 | 30 | 45 | 60) => void;
  /**
   * Timestamp ISO o ms epoch del moment en què el servidor va anclar el torn
   * actual. Si es defineix, el comptador s'ancora a aquest valor en lloc del
   * `Date.now()` local — així tots els clients online queden sincronitzats
   * encara que hi haja latència. Si és null/undefined, s'usa l'ancoratge
   * local (mode offline).
   */
  turnAnchorAt?: string | number | null;

  /**
   * Estat de presència per seient (només mode online). Si no es proporciona,
   * els seients no mostren cap indicador de connexió (mode offline / vs bots).
   */
  seatPresence?: Record<PlayerId, PresenceStatus | null>;
  /** Timestamp ISO de l'últim heartbeat per seient (per al tooltip "fa Xs"). */
  seatPresenceLastSeen?: Record<PlayerId, string | null>;

  /** Si es proporciona, mostra un botó de pausa sota el d'abandonar. */
  onPauseToggle?: (next: boolean) => void;
  /** Si la partida està actualment pausada (només mode online). */
  paused?: boolean;
}

/**
 * Tauler del Truc. Conté:
 *  - Capçalera amb so / nova partida / marcador horitzontal / abandonar.
 *  - Superfície de joc (TableSurface) amb seients, mans ocultes i animació.
 *  - Zona inferior amb la mà del jugador, envit, crits i ChatPanel.
 */
export function TrucBoard(props: TrucBoardProps) {
  const {
    match,
    humanActions,
    dispatch,
    shoutFlash,
    lastShoutByPlayer,
    shoutLabelByPlayer,
    acceptedShoutByPlayer,
    shoutFamilyByPlayer,
    envitShoutByPlayer,
    envitShoutLabelByPlayer,
    envitOutcomeByPlayer,
    messages,
    onSay,
    onNewGame,
    onAbandon,
    seatNames,
    dealKey: providedDealKey,
    showBotDebug = true,
    perspectiveSeat = 0 as PlayerId,
    belowHandSlot,
    turnTimeoutSec = 30,
    onChangeTurnTimeoutSec,
    turnAnchorAt,
    seatPresence,
    seatPresenceLastSeen,
    onPauseToggle,
    paused = false,
  } = props;

  const presenceFor = (p: PlayerId) => seatPresence?.[p] ?? null;
  const presenceLastSeenFor = (p: PlayerId) => seatPresenceLastSeen?.[p] ?? null;

  // Determina si el cartell d'un jugador és de la família "envit" (cartell
  // amunt del seient) o "truc" (cartell avall). Prioritza la família
  // explícita; si no, infereix pel shout actual.
  const isEnvitFor = (pid: PlayerId): boolean => {
    const fam = shoutFamilyByPlayer?.[pid];
    if (fam === "envit") return true;
    if (fam === "truc") return false;
    return isEnvitShout(lastShoutByPlayer[pid] as ShoutKind);
  };

  // Seients lògics derivats de la perspectiva. El jugador "HUMAN" és sempre
  // qui mira el tauler des de baix.
  const HUMAN: PlayerId = perspectiveSeat;
  const RIGHT: PlayerId = ((perspectiveSeat + 1) % 4) as PlayerId;
  const PARTNER: PlayerId = ((perspectiveSeat + 2) % 4) as PlayerId;
  const LEFT: PlayerId = ((perspectiveSeat + 3) % 4) as PlayerId;

  const r = match.round;
  const [muted, setMuted] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  // Animació de reparteix.
  //
  // IMPORTANT: en partides online (i a vegades en local) els bots poden
  // començar a jugar la primera baza abans que el client vegi el primer
  // snapshot de la ronda nova. Si exigim "totes les mans intactes" per a
  // detectar el reparteix, l'animació s'omet i el jugador veu directament
  // bots amb 2 cartes. Detectem el reparteix per **canvi de ronda**
  // (history.length + cames + mano) sempre que encara estem dins la
  // primera baza i el total de cartes en joc (mans + jugades) és 12.
  const autoDealKey = (() => {
    const inHand = r.hands[0].length + r.hands[1].length + r.hands[2].length + r.hands[3].length;
    const playedThisRound = r.tricks.reduce((acc, t) => acc + t.cards.length, 0);
    const total = inHand + playedThisRound;
    const isFirstTrick = r.tricks.length === 1;
    // total === 12 → ningú no ha guanyat baza encara (no s'han descartat).
    // isFirstTrick → estem realment al començament de la ronda.
    if (total === 12 && isFirstTrick && r.tricks[0].cards.length < 4) {
      return `${match.history.length}-${match.cames}-${r.mano}`;
    }
    return null;
  })();
  const dealKey = providedDealKey === undefined ? autoDealKey : providedDealKey;

  const lastDealKeyRef = useRef<string | null>(null);
  const [dealing, setDealing] = useState(false);
  const [revealedCount, setRevealedCount] = useState<Record<PlayerId, number>>({
    0: 3, 1: 3, 2: 3, 3: 3,
  });
  useEffect(() => {
    if (!dealKey) return;
    if (dealKey !== lastDealKeyRef.current) {
      lastDealKeyRef.current = dealKey;
      setDealing(true);
      setRevealedCount({ 0: 0, 1: 0, 2: 0, 3: 0 });
    }
  }, [dealKey]);

  // Mostres / preguntes / respostes destacades al ChatPanel.
  const [altresDismissed, setAltresDismissed] = useState(false);
  const [preguntesDismissed, setPreguntesDismissed] = useState(false);
  const [respostesPending, setRespostesPending] = useState(false);
  const respostesAnchorRef = useRef<number | null>(null);
  useEffect(() => {
    setAltresDismissed(false);
    setPreguntesDismissed(false);
    setRespostesPending(false);
    respostesAnchorRef.current = null;
  }, [match.history.length]);

  useEffect(() => {
    const partnerMsg = [...messages].reverse().find((m) => m.player === PARTNER);
    if (!partnerMsg) return;
    const phrase = PHRASES.find((p) => p.id === partnerMsg.phraseId);
    if (phrase?.category !== "pregunta") return;
    setRespostesPending(true);
    const playedByPartner = match.round.tricks
      .flatMap((t) => t.cards)
      .filter((tc) => tc.player === PARTNER).length;
    respostesAnchorRef.current = playedByPartner;
  }, [messages, match.round.tricks]);
  useEffect(() => {
    if (!respostesPending) return;
    const anchor = respostesAnchorRef.current;
    if (anchor === null) return;
    const playedByPartner = match.round.tricks
      .flatMap((t) => t.cards)
      .filter((tc) => tc.player === PARTNER).length;
    if (playedByPartner > anchor) {
      setRespostesPending(false);
      respostesAnchorRef.current = null;
    }
  }, [match.round.tricks, respostesPending]);

  const isPendingResponder = (p: PlayerId): boolean => {
    if (r.envitState.kind === "pending") {
      return (
        teamOf(p) === r.envitState.awaitingTeam &&
        !(r.envitState.rejectedBy ?? []).includes(p)
      );
    }
    if (r.trucState.kind === "pending") {
      return (
        teamOf(p) === r.trucState.awaitingTeam &&
        !(r.trucState.rejectedBy ?? []).includes(p)
      );
    }
    return false;
  };

  const myHand = r.hands[HUMAN];
  const myPlayedCards = r.tricks
    .flatMap((t) => t.cards)
    .filter((tc) => tc.player === HUMAN)
    .map((tc) => tc.card);
  const myEnvit = bestEnvit([...myHand, ...myPlayedCards]);

  const playableIds = new Set(
    humanActions
      .filter((a) => a.type === "play-card")
      .map((a) => (a as Extract<Action, { type: "play-card" }>).cardId),
  );
  const shoutActions = humanActions.filter((a) => a.type === "shout") as Extract<
    Action,
    { type: "shout" }
  >[];

  const isHumanTurn = r.turn === HUMAN || humanActions.length > 0;
  const gameEnded = r.phase === "game-end";

  // Quan estem en la fase de revelació de l'envit (final de mà amb envit
  // volgut), només s'amaguen les cartes concretes que conformen l'envit
  // de cada jugador (les altres cartes ja jugades segueixen visibles a la
  // taula); l'overlay EnvitReveal s'encarrega d'animar-les fent flip si
  // venien de la mà i convergint cap al seient.
  const envitRevealActive = (() => {
    if (r.phase !== "round-end") return false;
    const last = match.history[match.history.length - 1];
    return !!(last && last.envitWinner && !last.envitRejected && last.envitPoints > 0);
  })();

  // Conjunt d'ids de cartes que l'overlay està animant (per a no duplicar-les).
  // També comptem quantes cartes envit té cada jugador encara a la mà,
  // perquè la HiddenHand mostre el nombre correcte de cartes face-down
  // restants durant l'animació.
  const envitInHandCountByPlayer: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const envitHiddenIds = new Set<string>();
  if (envitRevealActive) {
    ([0, 1, 2, 3] as PlayerId[]).forEach((p) => {
      const b = playerEnvitBreakdown(r, p);
      b.cards.forEach((c) => {
        if (b.playedIds.has(c.id)) {
          envitHiddenIds.add(c.id);
        } else {
          envitInHandCountByPlayer[p] += 1;
        }
      });
    });
  }

  // Auto-play timeout: if the human must play a card and doesn't act within
  // 30 seconds, dispatch a random legal play-card action automatically.
  // Only triggers when a card play is required (not for pending shout
  // responses, which require an explicit decision).
  const playCardActions = humanActions.filter(
    (a) => a.type === "play-card",
  ) as Extract<Action, { type: "play-card" }>[];
  const mustPlayCard =
    playCardActions.length > 0 &&
    r.turn === HUMAN &&
    r.envitState.kind !== "pending" &&
    r.trucState.kind !== "pending" &&
    !gameEnded;

  const TURN_TIMEOUT_MS = turnTimeoutSec * 1000;
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null);
  const turnDeadlineRef = useRef<number | null>(null);
  const autoPlayedKeyRef = useRef<string | null>(null);

  // Comptador que augmenta cada cop que `mustPlayCard` passa de false→true.
  // Així, quan apareix un cant (envit/truc) i el temporitzador es pausa, en
  // resoldre's el cant i tornar-te el torn, el deadline es reinicia des de
  // zero (no continua amb el temps anterior).
  const [resumeNonce, setResumeNonce] = useState(0);
  const lastMustPlayRef = useRef(false);
  useEffect(() => {
    if (mustPlayCard && !lastMustPlayRef.current) {
      setResumeNonce((n) => n + 1);
    }
    lastMustPlayRef.current = mustPlayCard;
  }, [mustPlayCard]);

  // Clau estable del torn actual. Inclou `resumeNonce` perquè qualsevol pausa
  // (cant pendent, canvi de torn, etc.) reinicia neta el comptador en tornar.
  // En mode online, també inclou `turnAnchorAt` perquè quan el servidor canvia
  // l'ancoratge (canvi de torn real) el deadline es recalcule.
  const anchorMs = turnAnchorAt == null
    ? null
    : (typeof turnAnchorAt === "number" ? turnAnchorAt : Date.parse(turnAnchorAt));
  const turnKey = mustPlayCard
    ? `${match.history.length}-${match.cames}-${r.tricks.length}-${r.tricks[r.tricks.length - 1]?.cards.length ?? 0}-${HUMAN}-${resumeNonce}-${anchorMs ?? "local"}`
    : null;

  useEffect(() => {
    if (!mustPlayCard || !turnKey) {
      turnDeadlineRef.current = null;
      setTurnSecondsLeft(null);
      return;
    }
    // Si el servidor proporciona `turnAnchorAt`, fixem el deadline absolut a
    // partir d'eixe instant. Així tots els clients online comparteixen la
    // mateixa data límit i no hi ha desajusts per latència o per quan ha
    // arribat el missatge realtime a cadascú.
    const deadline = anchorMs != null
      ? anchorMs + TURN_TIMEOUT_MS
      : Date.now() + TURN_TIMEOUT_MS;
    turnDeadlineRef.current = deadline;
    const initialRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setTurnSecondsLeft(initialRemaining);

    const tick = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTurnSecondsLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(tick);
        if (autoPlayedKeyRef.current === turnKey) return;
        autoPlayedKeyRef.current = turnKey;
        const choices = playCardActions;
        if (choices.length > 0) {
          // Heurística "carta segura":
          //  1) Resoldre cada opció a la carta real (per llegir força i id).
          //  2) Si en la baza actual ja lidera el company, jugar la més baixa
          //     (no cal gastar-la).
          //  3) Si lidera un rival, intentar guanyar amb la mínima força
          //     suficient; si cap nostra guanya, jugar la més baixa (descart).
          //  4) Si no hi ha cartes a la baza, jugar la més baixa.
          //  5) Si tot empata o falta info, fallback aleatori.
          const myHandNow = r.hands[HUMAN];
          type Opt = { action: typeof choices[number]; card: { id: string; rank: number; suit: string } | undefined; strength: number };
          const opts: Opt[] = choices.map((a) => {
            const card = myHandNow.find((c) => c.id === a.cardId);
            return {
              action: a,
              card,
              strength: card ? cardStrength(card) : 0,
            };
          });

          const currentTrick = r.tricks[r.tricks.length - 1];
          const PARTNER_PID = ((HUMAN + 2) % 4) as PlayerId;
          let leader: { player: PlayerId; strength: number } | null = null;
          if (currentTrick) {
            for (const tc of currentTrick.cards) {
              const s = cardStrength(tc.card);
              if (!leader || s > leader.strength) {
                leader = { player: tc.player, strength: s };
              }
            }
          }

          const sortedAsc = [...opts].sort((a, b) => a.strength - b.strength);
          let pickOpt: Opt | null = null;

          if (!leader) {
            // Som els primers a tirar a la baza: jugar la més baixa.
            pickOpt = sortedAsc[0] ?? null;
          } else if (leader.player === PARTNER_PID) {
            // El company lidera: la més baixa serveix.
            pickOpt = sortedAsc[0] ?? null;
          } else {
            // Lidera un rival: cerca la mínima que el supere.
            const winners = sortedAsc.filter((o) => o.strength > leader!.strength);
            pickOpt = winners[0] ?? sortedAsc[0] ?? null;
          }

          // Fallback: si la heurística no ha pogut decidir, agafa una a l'atzar.
          if (!pickOpt) {
            pickOpt = opts[Math.floor(Math.random() * opts.length)] ?? null;
          }

          if (pickOpt) {
            dispatch(HUMAN, pickOpt.action);
            const card = pickOpt.card;
            const cardLabel = card
              ? `${RANK_NAME[card.rank as 1 | 3 | 4 | 5 | 6 | 7]} de ${SUIT_NAME[card.suit as "oros" | "copes" | "espases" | "bastos"]} ${SUIT_SYMBOL[card.suit as "oros" | "copes" | "espases" | "bastos"]}`
              : "una carta";
            toast.warning("Temps esgotat", {
              description: `S'ha jugat automàticament: ${cardLabel}`,
              duration: 4000,
            });
          }
        }
      }
    }, 250);

    return () => {
      window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, mustPlayCard, TURN_TIMEOUT_MS]);

  const firstTrick0 = r.tricks[0];
  const highlightPreguntes =
    (r.phase === "envit" || r.phase === "playing") &&
    r.tricks.length === 1 &&
    !!firstTrick0 &&
    r.turn === HUMAN &&
    !firstTrick0.cards.some((tc) => tc.player === HUMAN) &&
    !firstTrick0.cards.some((tc) => tc.player === PARTNER) &&
    !preguntesDismissed;
  const highlightRespostes = respostesPending;
  const partnerHasPlayedFirstTrick = !!firstTrick0?.cards.some((tc) => tc.player === PARTNER);
  const humanHasPlayedFirstTrick = !!firstTrick0?.cards.some((tc) => tc.player === HUMAN);
  const highlightAltres =
    r.phase === "playing" &&
    r.tricks.length === 1 &&
    humanHasPlayedFirstTrick &&
    !partnerHasPlayedFirstTrick &&
    r.turn === PARTNER &&
    r.envitState.kind === "none" &&
    !r.envitResolved &&
    r.trucState.kind !== "pending" &&
    !altresDismissed;

  // Amaga les frases d'envit del ChatPanel quan: l'envit ja s'ha cantat
  // (resolt o pendent), quan ja no estem a la 1a baza, o quan el truc ja
  // s'ha "volgut" (acceptat) — després de voler el truc no es pot envidar.
  const envitPhrasesHidden =
    r.envitResolved ||
    r.envitState.kind !== "none" ||
    r.tricks.length > 1 ||
    r.trucState.kind === "accepted";

  // Amaga respostes "fortes" del ChatPanel quan la mà del jugador no
  // permet dir-les sincerament. Es basa en les cartes que li queden.
  const myRemaining = r.hands[HUMAN] ?? [];
  const hasThree = myRemaining.some((c) => c.rank === 3);
  const hasGoodCard = myRemaining.some(
    (c) =>
      c.rank === 3 ||
      (c.rank === 7 && (c.suit === "oros" || c.suit === "espases")) ||
      (c.rank === 1 && (c.suit === "bastos" || c.suit === "espases")),
  );
  const hiddenResponseIds = new Set<ChatPhraseId>();
  if (envitPhrasesHidden) {
    ENVIT_PHRASE_IDS.forEach((id) => hiddenResponseIds.add(id));
  }
  if (!hasGoodCard) {
    hiddenResponseIds.add("vine-a-mi");
    hiddenResponseIds.add("tinc-bona");
    hiddenResponseIds.add("tinc-un-tres");
    hiddenResponseIds.add("vine-a-vore");
    hiddenResponseIds.add("vine-al-meu-tres");
  } else {
    // Si encara em queda alguna carta bona (3, 7 oros, 7 espases, As bastos
    // o As espases), no és sincer dir "No tinc res!" — l'amaguem.
    hiddenResponseIds.add("no-tinc-res");
    if (!hasThree) {
      hiddenResponseIds.add("tinc-un-tres");
      hiddenResponseIds.add("vine-al-meu-tres");
    }
  }

  const handleSay = (phraseId: ChatPhraseId) => {
    setAltresDismissed(true);
    const sentPhrase = PHRASES.find((p) => p.id === phraseId);
    if (sentPhrase?.category === "pregunta") setPreguntesDismissed(true);
    if (sentPhrase?.category === "resposta") {
      setRespostesPending(false);
      respostesAnchorRef.current = null;
    }
    onSay(phraseId);
  };

  const nameBottom = seatNames?.bottom ?? "Tu";
  const nameLeft = seatNames?.left ?? "Bot Esq.";
  const nameTop = seatNames?.top ?? "Company";
  const nameRight = seatNames?.right ?? "Bot Dre.";

  return (
    <main className="min-h-screen flex flex-col relative">
      {paused && (
        <div className="fixed inset-0 z-[200] bg-background/70 backdrop-blur-sm flex flex-col items-center justify-center gap-4 pointer-events-auto">
          <Pause className="w-16 h-16 text-primary" />
          <p className="text-2xl font-semibold text-foreground">Partida pausada</p>
          {onPauseToggle && (
            <Button
              onClick={() => onPauseToggle(false)}
              variant="outline"
              className="border-primary/60 text-primary hover:bg-primary/10"
            >
              <Play className="w-4 h-4 mr-2" /> Reprendre
            </Button>
          )}
        </div>
      )}
      <div className="relative px-2 pt-2 flex items-center gap-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            onClick={() => {
              // Toggle de so via lib/speech.
              import("@/lib/speech").then(({ toggleMuted }) => {
                setMuted(toggleMuted());
              });
            }}
            size="sm"
            variant="outline"
            className={cn(
              "h-8 w-8 p-0 border-primary/60 hover:bg-primary/10",
              muted ? "text-destructive" : "text-primary",
            )}
            aria-label={muted ? "Activar so" : "Silenciar so"}
          >
            {muted ? <VolumeOff className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Button
            onClick={onNewGame}
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0 border-primary/60 text-primary hover:bg-primary/10"
            aria-label="Nova partida"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>


        </div>
        <div className="flex-1 flex justify-center min-w-0">
          <HorizontalScoreboard match={match} />
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <Button
            onClick={() => setConfirmAbandon(true)}
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0 border-destructive/60 text-destructive hover:bg-destructive/10"
            aria-label="Abandonar i tornar a inici"
            title="Abandonar i tornar a inici"
          >
            <LogOut className="w-4 h-4" />
          </Button>
          {onPauseToggle && (
            <Button
              onClick={() => onPauseToggle(!paused)}
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0 border-primary/60 text-primary hover:bg-primary/10"
              aria-label={paused ? "Reprendre la partida" : "Pausar la partida"}
              title={paused ? "Reprendre la partida" : "Pausar la partida"}
            >
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 relative mt-[35px] mb-1 mx-2 min-h-[480px]">
        <TableSurface match={match} perspectiveSeat={perspectiveSeat} hiddenCardIds={envitRevealActive ? envitHiddenIds : undefined} />

        {dealing && dealKey && (
          <DealAnimation
            dealKey={dealKey}
            dealer={match.dealer}
            mano={r.mano}
            perspectiveSeat={perspectiveSeat}
            onCardLanded={(player, idx) =>
              setRevealedCount((prev) => ({
                ...prev,
                [player]: Math.max(prev[player], idx + 1),
              }))
            }
            onComplete={() => {
              setDealing(false);
              setRevealedCount({ 0: 3, 1: 3, 2: 3, 3: 3 });
            }}
          />
        )}

        {envitRevealActive && (
          <EnvitReveal
            match={match}
            perspectiveSeat={perspectiveSeat}
            winnerTeam={match.history[match.history.length - 1]!.envitWinner!}
          />
        )}

        <div className="absolute left-1 bottom-[37px] z-30">
          <TricksWonIndicator match={match} />
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10" style={{ top: "20px" }}>
          <HiddenHand
            count={Math.max(0, (dealing ? Math.min(revealedCount[PARTNER], 3) : r.hands[PARTNER].length) - (envitRevealActive ? envitInHandCountByPlayer[PARTNER] : 0))}
            cards={r.hands[PARTNER]}
          />
        </div>
        <div className="absolute top-12 left-1/2 -translate-y-1/2 -translate-x-full z-20" style={{ marginLeft: "-55px", marginTop: "-30px" }}>
          <div className="relative">
            <PlayerSeat player={PARTNER} match={match} position="top" name={nameTop} isPendingResponder={isPendingResponder(PARTNER)} presence={presenceFor(PARTNER)} presenceLastSeen={presenceLastSeenFor(PARTNER)} />
            {messages.find((m) => m.player === PARTNER) && (
              <ChatBubble
                phraseId={messages.find((m) => m.player === PARTNER)!.phraseId}
                vars={messages.find((m) => m.player === PARTNER)!.vars}
                position="top"
              />
            )}
            {/* Cartell d'envit (sempre amunt). Persisteix fins la nova mà. */}
            {envitShoutByPlayer?.[PARTNER] && (
              <div className="absolute top-[-17px] left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="relative inline-block">
                  <ShoutBadge
                    what={envitShoutByPlayer[PARTNER] as ShoutKind}
                    labelOverride={envitShoutLabelByPlayer?.[PARTNER] ?? undefined}
                    quiet={!!envitOutcomeByPlayer?.[PARTNER] && envitOutcomeByPlayer[PARTNER]!.outcome !== "pending"}
                  />
                  {envitOutcomeByPlayer?.[PARTNER] && (
                    <EnvitOutcomeMark
                      outcome={envitOutcomeByPlayer[PARTNER]!.outcome}
                      className="absolute right-full top-1/2 -translate-y-1/2 mr-0"
                    />
                  )}
                </div>
              </div>
            )}
            {/* Cartell de truc (sempre avall). */}
            {lastShoutByPlayer[PARTNER] && (
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="relative inline-block">
                  <ShoutBadge
                    what={lastShoutByPlayer[PARTNER] as ShoutKind}
                    labelOverride={shoutLabelByPlayer[PARTNER] ?? undefined}
                    quiet={acceptedShoutByPlayer[PARTNER]}
                  />
                  {acceptedShoutByPlayer[PARTNER] && (
                    <EnvitOutcomeMark
                      outcome="volgut"
                      className="absolute right-full top-1/2 -translate-y-1/2 mr-[-4px]"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="absolute left-1 top-[42%] -translate-y-1/2 z-10">
          <HiddenHand
            count={Math.max(0, (dealing ? Math.min(revealedCount[LEFT], 3) : r.hands[LEFT].length) - (envitRevealActive ? envitInHandCountByPlayer[LEFT] : 0))}
            direction="vertical"
            cards={r.hands[LEFT]}
          />
        </div>
        <div className="absolute left-1 top-[42%] z-20" style={{ marginTop: "55px" }}>
          <div className="relative">
            <PlayerSeat player={LEFT} match={match} position="left" name={nameLeft} isPendingResponder={isPendingResponder(LEFT)} presence={presenceFor(LEFT)} presenceLastSeen={presenceLastSeenFor(LEFT)} />
            {messages.find((m) => m.player === LEFT) && (
              <ChatBubble
                phraseId={messages.find((m) => m.player === LEFT)!.phraseId}
                vars={messages.find((m) => m.player === LEFT)!.vars}
                position="bottom-left"
              />
            )}
            {envitShoutByPlayer?.[LEFT] && (
              <div className="absolute top-[-17px] left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="relative inline-block">
                  <ShoutBadge
                    what={envitShoutByPlayer[LEFT] as ShoutKind}
                    labelOverride={envitShoutLabelByPlayer?.[LEFT] ?? undefined}
                    quiet={!!envitOutcomeByPlayer?.[LEFT] && envitOutcomeByPlayer[LEFT]!.outcome !== "pending"}
                  />
                  {envitOutcomeByPlayer?.[LEFT] && (
                    <EnvitOutcomeMark
                      outcome={envitOutcomeByPlayer[LEFT]!.outcome}
                      className="absolute right-full top-1/2 -translate-y-1/2 mr-0"
                    />
                  )}
                </div>
              </div>
            )}
            {lastShoutByPlayer[LEFT] && (
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="relative inline-block">
                  <ShoutBadge
                    what={lastShoutByPlayer[LEFT] as ShoutKind}
                    labelOverride={shoutLabelByPlayer[LEFT] ?? undefined}
                    quiet={acceptedShoutByPlayer[LEFT]}
                  />
                  {acceptedShoutByPlayer[LEFT] && (
                    <EnvitOutcomeMark
                      outcome="volgut"
                      className="absolute right-full top-1/2 -translate-y-1/2 mr-[-4px]"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="absolute right-1 top-[42%] z-20" style={{ transform: "translateY(-100%)", marginTop: "-55px" }}>
          <div className="relative">
            <PlayerSeat player={RIGHT} match={match} position="right" name={nameRight} isPendingResponder={isPendingResponder(RIGHT)} presence={presenceFor(RIGHT)} presenceLastSeen={presenceLastSeenFor(RIGHT)} />
            {messages.find((m) => m.player === RIGHT) && (
              <ChatBubble
                phraseId={messages.find((m) => m.player === RIGHT)!.phraseId}
                vars={messages.find((m) => m.player === RIGHT)!.vars}
                position="bottom-right"
              />
            )}
            {envitShoutByPlayer?.[RIGHT] && (
              <div className="absolute top-[-17px] left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="relative inline-block">
                  <ShoutBadge
                    what={envitShoutByPlayer[RIGHT] as ShoutKind}
                    labelOverride={envitShoutLabelByPlayer?.[RIGHT] ?? undefined}
                    quiet={!!envitOutcomeByPlayer?.[RIGHT] && envitOutcomeByPlayer[RIGHT]!.outcome !== "pending"}
                  />
                  {envitOutcomeByPlayer?.[RIGHT] && (
                    <EnvitOutcomeMark
                      outcome={envitOutcomeByPlayer[RIGHT]!.outcome}
                      className="absolute right-full top-1/2 -translate-y-1/2 mr-0"
                    />
                  )}
                </div>
              </div>
            )}
            {lastShoutByPlayer[RIGHT] && (
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="relative inline-block">
                  <ShoutBadge
                    what={lastShoutByPlayer[RIGHT] as ShoutKind}
                    labelOverride={shoutLabelByPlayer[RIGHT] ?? undefined}
                    quiet={acceptedShoutByPlayer[RIGHT]}
                  />
                  {acceptedShoutByPlayer[RIGHT] && (
                    <EnvitOutcomeMark
                      outcome="volgut"
                      className="absolute right-full top-1/2 -translate-y-1/2 mr-[-4px]"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="absolute right-1 top-[42%] -translate-y-1/2 z-10">
          <HiddenHand
            count={Math.max(0, (dealing ? Math.min(revealedCount[RIGHT], 3) : r.hands[RIGHT].length) - (envitRevealActive ? envitInHandCountByPlayer[RIGHT] : 0))}
            direction="vertical"
            cards={r.hands[RIGHT]}
          />
        </div>

        {shoutFlash && (
          <ShoutBubble
            what={shoutFlash.what as ShoutKind}
            labelOverride={shoutFlash.labelOverride}
            className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          />
        )}
      </div>

      <div className="px-2 pt-1 pb-2 bg-background/40 border-t-2 border-primary/30 relative mt-[-35px]">
        <div className="w-full min-h-[20px] flex flex-wrap justify-center items-center gap-1 mb-1">
          {!gameEnded && shoutActions.length > 0 && shoutActions.map((a) => (
            <ShoutButton
              key={a.what}
              what={a.what}
              size="sm"
              onClick={() => dispatch(HUMAN, a)}
            />
          ))}
        </div>

        <div className="flex items-end gap-3">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="relative scale-90 origin-bottom-left">
              <PlayerSeat player={HUMAN} match={match} position="bottom" name={nameBottom} isPendingResponder={isPendingResponder(HUMAN)} presence={presenceFor(HUMAN)} presenceLastSeen={presenceLastSeenFor(HUMAN)} />
              {messages.find((m) => m.player === HUMAN) && (
                <ChatBubble
                  phraseId={messages.find((m) => m.player === HUMAN)!.phraseId}
                  vars={messages.find((m) => m.player === HUMAN)!.vars}
                  position="top"
                />
              )}
              {envitShoutByPlayer?.[HUMAN] && (
                <div className="absolute top-[-17px] left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <div className="relative inline-block">
                    <ShoutBadge
                      what={envitShoutByPlayer[HUMAN] as ShoutKind}
                      labelOverride={envitShoutLabelByPlayer?.[HUMAN] ?? undefined}
                      quiet={!!envitOutcomeByPlayer?.[HUMAN] && envitOutcomeByPlayer[HUMAN]!.outcome !== "pending"}
                    />
                    {envitOutcomeByPlayer?.[HUMAN] && (
                      <EnvitOutcomeMark
                        outcome={envitOutcomeByPlayer[HUMAN]!.outcome}
                        className="absolute right-full top-1/2 -translate-y-1/2 mr-0"
                      />
                    )}
                  </div>
                </div>
              )}
              {lastShoutByPlayer[HUMAN] && (
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <div className="relative inline-block">
                    <ShoutBadge
                      what={lastShoutByPlayer[HUMAN] as ShoutKind}
                      labelOverride={shoutLabelByPlayer[HUMAN] ?? undefined}
                      quiet={acceptedShoutByPlayer[HUMAN]}
                    />
                    {acceptedShoutByPlayer[HUMAN] && (
                      <EnvitOutcomeMark
                        outcome="volgut"
                        className="absolute right-full top-1/2 -translate-y-1/2 mr-[-4px]"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 leading-none py-1 -ml-[10px]">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Envit</div>
              <div className="text-2xl font-display font-bold text-gold leading-none">{myEnvit}</div>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center min-w-0 -ml-[30px]">
            {turnSecondsLeft !== null && (
              <div
                className={cn(
                  "text-[10px] font-mono tabular-nums px-2 py-0.5 rounded-full mb-1 leading-none",
                  turnSecondsLeft <= 10
                    ? "bg-destructive/20 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
                aria-live="polite"
                aria-label={`Temps per tirar: ${turnSecondsLeft} segons`}
              >
                {turnSecondsLeft}s
              </div>
            )}
            <div className="flex justify-center gap-1.5 min-w-0 w-full">
            {myHand.length === 0 ? (
              <div className="text-muted-foreground text-sm py-4">Esperant repartiment…</div>
            ) : (
              myHand.map((c, i) => {
                const visible = !dealing || i < revealedCount[HUMAN];
                if (!visible) {
                  return <div key={c.id} className="w-[64px] h-[92px]" />;
                }
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "transition-all duration-300 ease-out",
                      dealing && "animate-fade-in",
                    )}
                  >
                    <PlayingCard
                      suit={c.suit}
                      rank={c.rank}
                      size="md"
                      playable={playableIds.has(c.id) && isHumanTurn}
                      onClick={
                        playableIds.has(c.id)
                          ? () => dispatch(HUMAN, { type: "play-card", cardId: c.id })
                          : undefined
                      }
                    />
                  </div>
                );
              })
            )}
            </div>
          </div>
        </div>
      </div>

      {belowHandSlot}

      <ChatPanel
        onSay={handleSay}
        highlightPreguntes={highlightPreguntes}
        highlightRespostes={highlightRespostes}
        highlightAltres={highlightAltres}
        hiddenPhraseIds={hiddenResponseIds.size > 0 ? hiddenResponseIds : undefined}
      />

      {gameEnded && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="wood-surface rounded-2xl border-2 border-primary p-6 max-w-sm w-full text-center card-shadow gold-glow">
            <Trophy className="w-16 h-16 text-primary mx-auto mb-3" />
            <h2 className="font-display text-3xl font-black text-gold mb-2">
              {(() => {
                const winner = match.jocForaWinner
                  ?? (match.camesWon.nos > match.camesWon.ells ? "nos" : "ells");
                return winner === "nos" ? "Nosaltres!" : "Ells!";
              })()}
            </h2>
            <p className="text-foreground mb-4">
              {match.jocForaWinner
                ? "Joc fora!"
                : `Cames: ${match.camesWon.nos} – ${match.camesWon.ells}`}
            </p>
            <Button
              onClick={onNewGame}
              variant="default"
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-display font-bold"
            >
              Nova partida
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandonar partida?</AlertDialogTitle>
            <AlertDialogDescription>
              Tornaràs a la pantalla d'inici i la partida actual s'esborrarà definitivament. Aquesta acció no es pot desfer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel·lar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAbandon(false);
                onAbandon();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Abandonar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {showBotDebug && <BotDebugPanel />}
    </main>
  );
}

function HiddenHand({
  count,
  direction = "horizontal",
  cards,
}: {
  count: number;
  direction?: "horizontal" | "vertical";
  cards?: { id: string; suit: import("@/game/types").Suit; rank: import("@/game/types").Rank }[];
}) {
  const isVertical = direction === "vertical";
  // DEBUG MODE: render bots' hands face-up so we can study their behavior.
  return (
    <div className={cn(isVertical ? "flex flex-col -space-y-9" : "flex -space-x-4")}>
      {Array.from({ length: count }).map((_, i) => {
        const c = cards?.[i];
        // Cards coming from the online server are masked with placeholder
        // ids ("hidden-..."): only their *count* is real. Render face-down
        // for those so opponents' hands stay hidden in online play.
        const isHidden = !c || c.id.startsWith("hidden-");
        if (!isHidden) {
          return (
            <PlayingCard
              key={c.id}
              suit={c.suit}
              rank={c.rank}
              size="sm"
              className={isVertical ? "rotate-90" : ""}
            />
          );
        }
        return (
          <PlayingCard key={c?.id ?? i} faceDown size="sm" className={isVertical ? "rotate-90" : ""} />
        );
      })}
    </div>
  );
}

function TricksWonIndicator({ match }: { match: MatchState }) {
  const r = match.round;
  const resolved = r.tricks.filter(
    (t) => t.cards.length === 4 && (t.winner !== undefined || t.parda),
  );
  const winnerTeam = (t: Trick): TeamId | "parda" | undefined => {
    if (t.parda) return "parda";
    if (t.winner === undefined) return undefined;
    return teamOf(t.winner);
  };
  return (
    <div className="flex flex-row items-center gap-1.5">
      <span className="text-[8px] font-display tracking-wider uppercase text-primary/80 [writing-mode:vertical-rl] rotate-180">
        Basses
      </span>
      <div className="flex flex-col gap-0.5">
        {[0, 1, 2].map((i) => {
          const t = resolved[i];
          const w = t ? winnerTeam(t) : undefined;
          return (
            <div
              key={i}
              className={cn(
                "px-1 py-0.5 rounded text-[9px] font-display font-bold border text-center min-w-[40px]",
                !w && "border-muted-foreground/30 text-muted-foreground/60 bg-background/40",
                w === "nos" && "border-team-nos bg-team-nos/80 text-white",
                w === "ells" && "border-team-ells bg-team-ells/80 text-white",
                w === "parda" && "border-primary bg-primary/30 text-primary-foreground",
              )}
            >
              {`${i + 1}ª`}
              {w === "nos" && " Nos"}
              {w === "ells" && " Ells"}
              {w === "parda" && " Parda"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ToastPosition = "above" | "below";
const TOAST_POS_KEY = "truc:toastPosition";

function HorizontalScoreboard({ match }: { match: MatchState }) {
  const { scores, camesWon, targetCama, targetCames } = match;

  const [toasts, setToasts] = useState<PointToast[]>([]);
  const [toastPos, setToastPos] = useState<ToastPosition>(() => {
    if (typeof window === "undefined") return "below";
    const saved = window.localStorage.getItem(TOAST_POS_KEY);
    return saved === "above" || saved === "below" ? saved : "below";
  });
  // Track which history indexes ja s'han convertit en toasts per evitar
  // duplicats quan l'efecte es dispara més d'una vegada (ex: StrictMode,
  // re-renders del pare amb noves referències de match/scores).
  const processedHistoryIdxRef = useRef<Set<number>>(new Set());

  const [displayedScores, setDisplayedScores] = useState(scores);
  const [displayedCames, setDisplayedCames] = useState(camesWon);
  const SCORE_DELAY_MS = 1200;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TOAST_POS_KEY, toastPos);
  }, [toastPos]);

  useEffect(() => {
    const curLen = match.history.length;
    const processed = processedHistoryIdxRef.current;

    // Si l'historial s'ha encongit (nova partida), reseteja el tracking i
    // sincronitza els marcadors mostrats.
    if (curLen < processed.size || (curLen === 0 && processed.size > 0)) {
      processed.clear();
      setDisplayedScores(scores);
      setDisplayedCames(camesWon);
      return;
    }

    // Detecta només els índexs nous que encara no s'han processat.
    const newIndexes: number[] = [];
    for (let i = 0; i < curLen; i++) {
      if (!processed.has(i)) newIndexes.push(i);
    }

    if (newIndexes.length === 0) {
      // No hi ha res nou: només sincronitza els marcadors si han canviat.
      setDisplayedScores(scores);
      setDisplayedCames(camesWon);
      return;
    }

    const incoming: PointToast[] = [];
    const seenKeys = new Set<string>();
    for (const idx of newIndexes) {
      processed.add(idx);
      const s = match.history[idx];
      if (!s) continue;
      for (const t of buildToastsFromSummary(s)) {
        // Clau estable per parell (índex de la mà + família envit/truc).
        // Així, encara que l'efecte es dispare més d'una vegada amb la mateixa
        // entrada d'historial (StrictMode, re-renders, remounts), només
        // generarem UN cartell d'envit i UN cartell de truc per ronda.
        const key = pointToastKey(idx, t);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        incoming.push({ id: key, ...t });
      }
    }

    if (incoming.length > 0) {
      // Si alguna ronda nova té envit volgut, retardem la mostra dels
      // cartells de punts (i l'actualització del marcador) durant 3s
      // perquè es vegi primer la revelació de cartes d'envit.
      const hasEnvitReveal = newIndexes.some((idx) => {
        const s = match.history[idx];
        return !!(s && s.envitWinner && !s.envitRejected && s.envitPoints > 0);
      });
      const revealDelay = hasEnvitReveal ? 3000 : 0;

      window.setTimeout(() => {
        setToasts((prev) => {
          const existingIds = new Set(prev.map((x) => x.id));
          const fresh = incoming.filter((x) => !existingIds.has(x.id));
          if (fresh.length === 0) return prev;
          return [...prev, ...fresh];
        });
        incoming.forEach((toast) => {
          window.setTimeout(() => {
            setToasts((prev) => prev.filter((x) => x.id !== toast.id));
          }, 3000);
        });
        window.setTimeout(() => {
          setDisplayedScores(scores);
          setDisplayedCames(camesWon);
        }, SCORE_DELAY_MS);
      }, revealDelay);
    } else {
      setDisplayedScores(scores);
      setDisplayedCames(camesWon);
    }
  }, [match.history, scores, camesWon]);

  const toastsByTeam: Record<TeamId, PointToast[]> = {
    nos: toasts.filter((t) => t.team === "nos"),
    ells: toasts.filter((t) => t.team === "ells"),
  };

  return (
    <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-xl wood-surface border-2 border-primary/50 card-shadow">

      <TeamSide
        label="Nosaltres"
        males={displayedScores.nos.males}
        bones={displayedScores.nos.bones}
        target={targetCama}
        team="nos"
        toasts={toastsByTeam.nos}
        toastPos={toastPos}
      />
      <div className="flex items-center gap-1">
        <CamesDots won={displayedCames.nos} target={targetCames} team="nos" direction="vertical" />
        <span
          className="text-[8px] text-muted-foreground tracking-widest leading-none font-display"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          CAMES
        </span>
        <CamesDots won={displayedCames.ells} target={targetCames} team="ells" direction="vertical" />
      </div>
      <TeamSide
        label="Ells"
        males={displayedScores.ells.males}
        bones={displayedScores.ells.bones}
        target={targetCama}
        team="ells"
        toasts={toastsByTeam.ells}
        toastPos={toastPos}
      />
    </div>
  );
}

function CamesDots({
  won,
  target,
  team,
  direction = "horizontal",
}: {
  won: number;
  target: number;
  team: "nos" | "ells";
  direction?: "horizontal" | "vertical";
}) {
  return (
    <div className={cn(direction === "vertical" ? "flex flex-col gap-0.5" : "flex gap-0.5")}>
      {Array.from({ length: target }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-2 h-2 rounded-full border",
            i < won
              ? team === "nos"
                ? "bg-team-nos border-team-nos"
                : "bg-team-ells border-team-ells"
              : "border-primary/40 bg-background/30",
          )}
          aria-label={`${team} cama ${i + 1}`}
        />
      ))}
    </div>
  );
}

function TeamSide({
  label, males, bones, target, team, toasts = [], toastPos = "below",
}: {
  label: string; males: number; bones: number; target: number; team: "nos" | "ells";
  toasts?: PointToast[]; toastPos?: "above" | "below";
}) {
  const inBones = males >= target;
  const total = males + bones;
  const displayValue = inBones ? Math.max(0, target * 2 - total) : Math.min(males, target);
  const stateLabel = inBones ? "Bones" : "Males";
  const isAbove = toastPos === "above";
  return (
    <div className="relative flex flex-col items-center gap-0.5 w-[68px]">
      <span className={cn("text-[10px] font-display tracking-widest uppercase leading-none", team === "nos" ? "text-team-nos" : "text-team-ells")}>
        {label}
      </span>
      <div className="flex items-baseline justify-center gap-0.5 leading-none">
        <span className={cn(
          "text-base font-display font-bold leading-none transition-colors duration-500",
          inBones ? "text-primary" : "text-gold",
        )}>{displayValue}</span>
        <span className="text-[9px] text-muted-foreground leading-none">/{target}</span>
      </div>
      <span className={cn(
        "text-[9px] font-display tracking-widest uppercase leading-none transition-colors duration-500",
        inBones ? "text-primary/80" : "text-muted-foreground",
      )}>
        {stateLabel}
      </span>

      <div
        className={cn(
          "pointer-events-none absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-50",
          isAbove ? "bottom-full mb-1" : "top-full mt-1",
        )}
        style={{ minWidth: "max-content" }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "px-1.5 py-0.5 rounded-xl",
              "font-display font-black text-[8px] border shadow-md",
              "animate-shout",
              "max-w-[140px] text-center leading-tight break-words",
              isAbove ? "rounded-bl-sm origin-bottom" : "rounded-tl-sm origin-top",
              TOAST_STYLE[t.kind],
            )}
          >
            <span className="mr-0.5 text-[9px]">+{t.points}</span>
            <span className="uppercase tracking-wide">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
