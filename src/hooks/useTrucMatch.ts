import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Action, MatchState, PlayerId, ShoutKind, partnerOf, nextPlayer, teamOf } from "@/game/types";
import { applyAction, createMatch, dealRound, legalActions, startNextRound } from "@/game/engine";
import { botDecide } from "@/game/bot";
import { bestEnvit, playerTotalEnvit } from "@/game/deck";
import { computeShoutDisplay } from "@/game/shoutDisplay";
import {
  shouldConsultPartner,
  pickQuestion,
  partnerAnswerFor,
  adviceFromAnswer,
  isBotOpeningForTeam,
  hasGoodTrucCard,
  type PartnerAdvice,
} from "@/game/botConsult";
import type { ChatPhraseId } from "@/game/phrases";
import { emptyIntents, type CardHint, type PartnerIntents, type PlayStrengthHint } from "@/game/playerIntents";
import { speakShout } from "@/lib/speech";
import { NEUTRAL_TUNING, type BotTuning } from "@/game/profileAdaptation";
import type { ProfileEvent } from "@/lib/playerProfile";

/** Cants que es locuten en veu alta quan algú els canta. */
const SPOKEN_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "truc", "retruc", "quatre", "joc-fora",
  "envit", "renvit", "falta-envit",
  "vull", "no-vull",
]);

const HUMAN: PlayerId = 0;
import {
  BOT_DELAY_MS,
  BOT_WAIT_FOR_HUMAN_ENVIT_MS,
  CONSULT_QUESTION_DELAY_MS,
  CONSULT_ANSWER_DELAY_MS,
  CONSULT_BOT_ANSWER_DELAY_MS,
  CONSULT_DECIDE_DELAY_MS,
  RIVAL_FIRST_TRICK_PRE_QUESTION_DELAY_MS,
  RIVAL_FIRST_TRICK_BUBBLE_MS,
  CONSULT_HUMAN_TIMEOUT_MS,
  SECOND_PLAYER_WAIT_MS,
  PARTNER_BOT_INSTRUCTION_DELAY_MS,
  QUANT_ENVIT_FOLLOWUP_QUESTION_DELAY_MS,
  QUANT_ENVIT_FOLLOWUP_ANSWER_DELAY_MS,
  QUANT_ENVIT_FOLLOWUP_FINALIZE_DELAY_MS,
} from "@/game/chatTimings";


const RESPONSE_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "vull",
  "no-vull",
  "retruc",
  "quatre",
  "joc-fora",
  "renvit",
  "falta-envit",
]);

const QUESTION_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "envit",
  "renvit",
  "falta-envit",
  "truc",
  "retruc",
  "quatre",
  "joc-fora",
]);

// Cants de la família "envit": un cop respostos (vull / no-vull / renvit /
// falta-envit), el cartell del cantador ja no s'ha de mostrar.
const ENVIT_QUESTION_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "envit",
  "renvit",
  "falta-envit",
]);

interface UseTrucMatchOptions {
  /** Permite al hook publicar mensajes de chat (consultas bot↔partner). */
  say?: (
    player: PlayerId,
    phraseId: ChatPhraseId,
    durationMs?: number,
    vars?: Record<string, string | number>,
  ) => void;
  /** Cames a guanyar (per defecte 2). */
  targetCames?: number;
  /** Punts per meitat de cama (males/bones). Per defecte 12. */
  targetCama?: number;
  /** Mà inicial (per defecte 0 = tu). El dealer és (mà + 3) % 4. */
  initialMano?: PlayerId;
  /** Si és true, intenta recuperar la partida guardada al localStorage. */
  resume?: boolean;
  /** Tuning derivat del perfil del jugador humà; aplicat als bots rivals. */
  tuning?: BotTuning;
  /** Probabilitat (0..1) de farolejar i mentir dels bots. 0 = sincer. */
  bluffRate?: number;
  /** Callback per registrar esdeveniments del jugador humà al perfil. */
  trackProfile?: (event: ProfileEvent) => void;
  /** Callback opcional invocat al final de cada ronda (history creix). Útil
   * per a forçar un flush del perfil del jugador i recalcular el tuning del
   * bot abans de la ronda següent. */
  onRoundEnd?: () => void;
  /** Si és true, congela qualsevol acció dels bots (no programa torns ni
   *  passa a nova ronda). El jugador humà també queda bloquejat per la UI. */
  paused?: boolean;
}

const SAVE_KEY = "truc:save:v2";

interface SavedMatch {
  match: MatchState;
  targetCames: number;
  initialMano: PlayerId;
}

function loadSavedMatch(): SavedMatch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedMatch;
    if (!parsed?.match?.round) return null;
    if (parsed.match.round.phase === "game-end") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasSavedMatch(): boolean {
  return loadSavedMatch() !== null;
}

export function clearSavedMatch() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* noop */ }
}

interface PendingHumanAnswer {
  botPlayer: PlayerId;
  consultKey: string;
  timer: number;
  resolve: (answer: ChatPhraseId | null) => void;
}

interface PendingSecondPlayerWait {
  botPlayer: PlayerId;
  waitKey: string;
  timer: number;
  partnerBotTimer: number | null;
  resolve: (instruction: ChatPhraseId | null) => void;
}

export function useTrucMatch(options: UseTrucMatchOptions = {}) {
  // Índex de la baza actual des del punt de vista de la UI. Es declara
  // ací (abans del recordChatPhrase) per poder rastrejar a quina baza
  // s'ha emés cada frase ("Vine a vore!", etc.).
  const lastSeenTrickIdxRef = useRef<number>(0);
  // Frases dites en la ronda actual per cada jugador. S'utilitza per
  // implementar regles del mode sincer (p.ex. "només reservar carta forta
  // si cap rival ha dit vine-a-mi / tinc-bona en aquesta ronda").
  const chatSignalsRef = useRef<Record<PlayerId, ChatPhraseId[]>>({
    0: [], 1: [], 2: [], 3: [],
  });
  // Compromisos personals: per a cada jugador, la baza (trickIdx) en la
  // qual ha dit "Vine a vore!", "Vine al meu tres!" o "Tinc un 3" — quan
  // li toque jugar en eixa baza, s'aplica el playStrength corresponent.
  const selfCommitRef = useRef<Record<PlayerId, Record<number, "vine-a-vore" | "vine-al-meu-tres" | "tinc-un-tres">>>({
    0: {}, 1: {}, 2: {}, 3: {},
  });
  const recordChatPhrase = useCallback((player: PlayerId, phraseId: ChatPhraseId) => {
    const arr = chatSignalsRef.current[player] ?? [];
    arr.push(phraseId);
    chatSignalsRef.current[player] = arr;
    if (
      phraseId === "vine-a-vore" ||
      phraseId === "vine-al-meu-tres" ||
      phraseId === "tinc-un-tres"
    ) {
      selfCommitRef.current[player][lastSeenTrickIdxRef.current] = phraseId;
    }
  }, []);
  const rawSayRef = useRef(options.say);
  useEffect(() => { rawSayRef.current = options.say; }, [options.say]);
  const sayRef = useRef<UseTrucMatchOptions["say"]>(undefined);
  sayRef.current = (player, phraseId, durationMs, vars) => {
    recordChatPhrase(player, phraseId);
    rawSayRef.current?.(player, phraseId, durationMs, vars);
  };
  const tuningRef = useRef<BotTuning>(options.tuning ?? NEUTRAL_TUNING);
  useEffect(() => { tuningRef.current = options.tuning ?? NEUTRAL_TUNING; }, [options.tuning]);
  const bluffRateRef = useRef<number>(options.bluffRate ?? 0);
  useEffect(() => { bluffRateRef.current = options.bluffRate ?? 0; }, [options.bluffRate]);
  const trackProfileRef = useRef(options.trackProfile);
  useEffect(() => { trackProfileRef.current = options.trackProfile; }, [options.trackProfile]);
  const onRoundEndRef = useRef(options.onRoundEnd);
  useEffect(() => { onRoundEndRef.current = options.onRoundEnd; }, [options.onRoundEnd]);
  const pausedRef = useRef<boolean>(options.paused ?? false);
  useEffect(() => { pausedRef.current = options.paused ?? false; }, [options.paused]);

  // Quan s'activa la pausa, cancel·la immediatament tots els timers
  // pendents dels bots (acció principal, consultes, espera del company,
  // espera del 2n jugador). Així cap acció programada s'executarà entre
  // la pausa i la represa.
  useEffect(() => {
    if (!options.paused) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    for (const id of consultTimersRef.current) window.clearTimeout(id);
    consultTimersRef.current = [];
    consultInFlightRef.current.clear();
    consultStartedRef.current.clear();
    if (pendingHumanAnswerRef.current) {
      window.clearTimeout(pendingHumanAnswerRef.current.timer);
      pendingHumanAnswerRef.current = null;
    }
    const w = pendingSecondWaitRef.current;
    if (w) {
      window.clearTimeout(w.timer);
      if (w.partnerBotTimer) window.clearTimeout(w.partnerBotTimer);
      pendingSecondWaitRef.current = null;
    }
  }, [options.paused]);

  const lastRoundsRef = useRef<number>(-1);
  const gameStartedTrackedRef = useRef<number>(-1);

  const initialDealer = ((((options.initialMano ?? 0) + 3) % 4) as PlayerId);
  const initialTargetCames = options.targetCames ?? 2;
  const initialTargetCama = options.targetCama ?? 12;
  const [match, setMatch] = useState<MatchState>(() => {
    if (options.resume) {
      const saved = loadSavedMatch();
      if (saved) return saved.match;
    }
    return createMatch({ targetCama: initialTargetCama, targetCames: initialTargetCames, firstDealer: initialDealer });
  });

  // Persistència automàtica al localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (match.round.phase === "game-end") {
        window.localStorage.removeItem(SAVE_KEY);
      } else {
        const payload: SavedMatch = {
          match,
          targetCames: initialTargetCames,
          initialMano: (options.initialMano ?? 0) as PlayerId,
        };
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      }
    } catch { /* noop */ }
  }, [match, initialTargetCames, options.initialMano]);

  // Track "game_started" once per match (new createMatch resets history to []).
  useEffect(() => {
    const isFreshMatch = match.history.length === 0 && match.cames === 0;
    const fingerprint = match.round.mano + match.targetCames * 10;
    if (isFreshMatch && gameStartedTrackedRef.current !== fingerprint) {
      gameStartedTrackedRef.current = fingerprint;
      trackProfileRef.current?.({ type: "game_started" });
    }
    if (!isFreshMatch && gameStartedTrackedRef.current === -1) {
      gameStartedTrackedRef.current = fingerprint;
    }
  }, [match]);

  // Detecta el final de cada ronda (history.length augmenta) i notifica perquè
  // el motor del bot puga refrescar els seus paràmetres dins de la mateixa
  // partida sense esperar a la pròxima.
  useEffect(() => {
    const len = match.history.length;
    if (lastRoundsRef.current === -1) {
      lastRoundsRef.current = len;
      return;
    }
    if (len > lastRoundsRef.current) {
      lastRoundsRef.current = len;
      // Nova ronda: reinicia el log de frases per jugador.
      chatSignalsRef.current = { 0: [], 1: [], 2: [], 3: [] };
      selfCommitRef.current = { 0: {}, 1: {}, 2: {}, 3: {} };
      onRoundEndRef.current?.();
    } else if (len < lastRoundsRef.current) {
      // Nova partida: reinicia comptador i log de frases.
      lastRoundsRef.current = len;
      chatSignalsRef.current = { 0: [], 1: [], 2: [], 3: [] };
      selfCommitRef.current = { 0: {}, 1: {}, 2: {}, 3: {} };
    }
  }, [match.history.length]);
  const [shoutFlash, setShoutFlash] = useState<{ player: PlayerId; what: string; labelOverride?: string } | null>(null);
  // Tots els carteles (truc, envit, V/X, família, acceptat) es deriven del
  // `MatchState` via `computeShoutDisplay`. Així offline i online comparteixen
  // exactament la mateixa font de veritat — qualsevol canvi visual fet ací
  // es reflecteix automàticament en les partides online.
  const display = useMemo(() => computeShoutDisplay(match), [match]);
  const lastShoutByPlayer = display.lastShoutByPlayer;
  const shoutLabelByPlayer = display.shoutLabelByPlayer;
  const acceptedShoutByPlayer = display.acceptedShoutByPlayer;
  const shoutFamilyByPlayer = display.shoutFamilyByPlayer;
  const envitShoutByPlayer = display.envitShoutByPlayer;
  const envitShoutLabelByPlayer = display.envitShoutLabelByPlayer;
  const envitOutcomeByPlayer = display.envitOutcomeByPlayer;
  const shoutTimersRef = useRef<Record<PlayerId, number | null>>({ 0: null, 1: null, 2: null, 3: null });
  const timerRef = useRef<number | null>(null);
  const consultTimersRef = useRef<number[]>([]);
  const consultAdviceRef = useRef<Map<string, PartnerAdvice>>(new Map());
  const consultStartedRef = useRef<Set<string>>(new Set());
  const consultInFlightRef = useRef<Set<string>>(new Set());
  const intentsRef = useRef<PartnerIntents>(emptyIntents());
  // (lastSeenTrickIdxRef ja declarat al començament del hook)
  const pendingHumanAnswerRef = useRef<PendingHumanAnswer | null>(null);
  const pendingSecondWaitRef = useRef<PendingSecondPlayerWait | null>(null);

  const setPartnerCardHintForCurrentTrick = useCallback((hint: CardHint) => {
    intentsRef.current.cardHintByTrick[lastSeenTrickIdxRef.current] = hint;
  }, []);

  const setPartnerPlayStrengthForCurrentTrick = useCallback((hint: PlayStrengthHint) => {
    intentsRef.current.playStrengthByTrick[lastSeenTrickIdxRef.current] = hint;
  }, []);

  const setPartnerSilentForCurrentTrick = useCallback(() => {
    intentsRef.current.silentByTrick[lastSeenTrickIdxRef.current] = true;
  }, []);

  const setPartnerFoldNextTruc = useCallback(() => {
    intentsRef.current.foldNextTruc = true;
  }, []);

  const scheduleConsultTimer = useCallback((fn: () => void, delayMs: number) => {
    const id = window.setTimeout(() => {
      consultTimersRef.current = consultTimersRef.current.filter((t) => t !== id);
      fn();
    }, delayMs) as unknown as number;
    consultTimersRef.current.push(id);
    return id;
  }, []);

  const clearConsultTimers = useCallback(() => {
    for (const id of consultTimersRef.current) window.clearTimeout(id);
    consultTimersRef.current = [];
    consultInFlightRef.current.clear();
  }, []);

  const finishConsult = useCallback((consultKey: string) => {
    consultInFlightRef.current.delete(consultKey);
  }, []);

  /**
   * El component crida açò cada vegada que un jugador (humà inclòs) emet
   * una frase de chat. Si hi ha un bot esperant alguna entrada del seu
   * company, la consumim per resoldre el "await" corresponent.
   */
  const notifyChatPhrase = useCallback((player: PlayerId, phraseId: ChatPhraseId) => {
    if (pausedRef.current) return;
    // Registra la frase a la història per ronda (mode sincer).
    recordChatPhrase(player, phraseId);
    // 1) Resposta a una consulta del bot (preguntes tipus "puc-anar?").
    const pending = pendingHumanAnswerRef.current;
    if (pending && player === partnerOf(pending.botPlayer)) {
      const validAnswers: ChatPhraseId[] = [
        "vine-a-mi", "vine-a-vore", "vine-al-meu-tres", "vine-al-teu-tres",
        "tinc-bona", "tinc-un-tres", "a-tu", "no-tinc-res",
      ];
      if (validAnswers.includes(phraseId)) {
        pending.resolve(phraseId);
        return;
      }
    }
    // 2) Instrucció / resposta del company al peu-bot que està esperant
    // com a 2n en tirar la 1a baza. Accepta tant les instruccions
    // directes ("envida"/"tira-falta") com la resposta a la pregunta
    // "Tens envit?" ("si"/"no") que el bot acaba de fer.
    const waiting = pendingSecondWaitRef.current;
    if (waiting && player === partnerOf(waiting.botPlayer)) {
      const accepted: ChatPhraseId[] = ["envida", "tira-falta", "si", "no"];
      if (accepted.includes(phraseId)) {
        waiting.resolve(phraseId);
      }
    }
  }, []);

  const clearShoutTimer = (p: PlayerId) => {
    if (shoutTimersRef.current[p]) {
      window.clearTimeout(shoutTimersRef.current[p]!);
      shoutTimersRef.current[p] = null;
    }
  };

  const matchRef = useRef<MatchState>(null as unknown as MatchState);
  useEffect(() => { matchRef.current = match; }, [match]);

  const dispatch = useCallback((player: PlayerId, action: Action) => {
    // Mentre la partida està en pausa, ignora qualsevol acció (inclòs
    // l'humà). L'overlay ja bloqueja clics, però aquesta guarda evita
    // que entrades programàtiques (teclat, eines de debug, etc.) puguin
    // colar-se i avançar l'estat.
    if (pausedRef.current) return;
    // Track human plays for the adaptive profile.
    if (player === HUMAN && action.type === "shout") {
      const track = trackProfileRef.current;
      const prev = matchRef.current;
      const pr = prev?.round;
      if (track && pr) {
        const what = action.what;
        if (what === "envit" || what === "renvit" || what === "falta-envit") {
          const myEnvit = bestEnvit(pr.hands[HUMAN] ?? []);
          track({ type: "envit_called", strength: myEnvit, bluff: myEnvit < 25 });
        } else if (what === "truc" || what === "retruc" || what === "quatre" || what === "joc-fora") {
          const hand = pr.hands[HUMAN] ?? [];
          let s = 0;
          for (const c of hand) {
            const v = c.rank === 1 && (c.suit === "espases" || c.suit === "bastos") ? 0.5
              : c.rank === 7 && (c.suit === "oros" || c.suit === "espases") ? 0.5
              : c.rank === 3 ? 0.3 : 0.05;
            s += v;
          }
          const strength = Math.min(1, s);
          track({ type: "truc_called", strength, bluff: strength < 0.25 });
        } else if (what === "vull" || what === "no-vull") {
          const accepted = what === "vull";
          if (pr.envitState.kind === "pending") track({ type: "envit_response", accepted });
          else if (pr.trucState.kind === "pending") track({ type: "truc_response", accepted });
        }
      }
    }
    setMatch(prev => {
      let labelOverride: string | undefined;
      if (action.type === "shout") {
        const pr = prev.round;
        const isTrucCall = action.what === "truc" || action.what === "retruc" || action.what === "quatre" || action.what === "joc-fora";
        if (isTrucCall && !pr.envitResolved && pr.tricks.length === 1 && pr.envitState.kind === "none") {
          // El cartell és "Truc i passe" si el cantador NO és el peu del seu equip
          // (és a dir, encara queda algú del seu equip per tirar la 1a baza
          // i, per tant, podria envidar abans de tirar).
          // Peu de cada equip a la 1a baza:
          //   - equip de la mà: mà + 2
          //   - equip contrari: mà + 3 (= dealer)
          const peuManoTeam = ((pr.mano + 2) % 4) as PlayerId;
          const peuOtherTeam = ((pr.mano + 3) % 4) as PlayerId;
          const callerIsPeu = player === peuManoTeam || player === peuOtherTeam;
          if (!callerIsPeu) {
            const baseLabel: Record<string, string> = {
              truc: "Truc",
              retruc: "Retruc",
              quatre: "Quatre val",
              "joc-fora": "Joc fora",
            };
            labelOverride = `${baseLabel[action.what]} i passe!`;
          }
        }
      }

      const next = applyAction(prev, player, action);
      if (action.type === "shout") {
        // Locuta el cant en veu alta (truc, envit, etc.).
        if (SPOKEN_SHOUTS.has(action.what)) {
          speakShout(action.what, labelOverride);
        }

        // Flash transitori per animar el cant (1.6s). La resta dels
        // carteles persistents (truc, envit, V/X, família, acceptat) es
        // deriven automàticament de `match.round.log` via
        // `computeShoutDisplay`. Vegeu `src/game/shoutDisplay.ts`.
        setShoutFlash({ player, what: action.what, labelOverride });
        if (!QUESTION_SHOUTS.has(action.what)) {
          window.setTimeout(() => setShoutFlash(null), 1600);
        }
      }
      return next;
    });
  }, []);

  const clearPendingSecondWait = () => {
    const w = pendingSecondWaitRef.current;
    if (w) {
      window.clearTimeout(w.timer);
      if (w.partnerBotTimer) window.clearTimeout(w.partnerBotTimer);
      pendingSecondWaitRef.current = null;
    }
  };

  const forcedNextDealerRef = useRef<PlayerId | null>(null);
  const setForcedNextDealer = useCallback((dealer: PlayerId | null) => {
    forcedNextDealerRef.current = dealer;
  }, []);

  const newRound = useCallback(() => {
    setMatch(prev => {
      const next = startNextRound(prev);
      const forced = forcedNextDealerRef.current;
      if (forced !== null && next.round.phase !== "game-end") {
        forcedNextDealerRef.current = null;
        return { ...next, dealer: forced, round: dealRound(forced) };
      }
      return next;
    });
    for (const p of [0, 1, 2, 3] as PlayerId[]) clearShoutTimer(p);
    consultAdviceRef.current.clear();
    consultStartedRef.current.clear();
    clearConsultTimers();
    intentsRef.current = emptyIntents();
    lastSeenTrickIdxRef.current = 0;
    if (pendingHumanAnswerRef.current) {
      window.clearTimeout(pendingHumanAnswerRef.current.timer);
      pendingHumanAnswerRef.current = null;
    }
    clearPendingSecondWait();
  }, [clearConsultTimers, clearShoutTimer]);

  const newGame = useCallback(() => {
    const forced = forcedNextDealerRef.current;
    const firstDealer: PlayerId = forced !== null ? forced : initialDealer;
    if (forced !== null) forcedNextDealerRef.current = null;
    setMatch(createMatch({ targetCama: initialTargetCama, targetCames: initialTargetCames, firstDealer }));
    for (const p of [0, 1, 2, 3] as PlayerId[]) clearShoutTimer(p);
    consultAdviceRef.current.clear();
    consultStartedRef.current.clear();
    clearConsultTimers();
    intentsRef.current = emptyIntents();
    lastSeenTrickIdxRef.current = 0;
    if (pendingHumanAnswerRef.current) {
      window.clearTimeout(pendingHumanAnswerRef.current.timer);
      pendingHumanAnswerRef.current = null;
    }
    clearPendingSecondWait();
  }, [clearConsultTimers, clearShoutTimer]);

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pausedRef.current) return;
    const r = match.round;
    if (r.phase === "game-end" || r.phase === "round-end") return;

    let actor: PlayerId | null = null;
    for (const p of [0, 1, 2, 3] as PlayerId[]) {
      const acts = legalActions(match, p);
      if (acts.length > 0) {
        if (
          (r.envitState.kind === "pending" && (r.envitState.awaitingTeam === (p % 2 === 0 ? "nos" : "ells"))) ||
          (r.trucState.kind === "pending" && (r.trucState.awaitingTeam === (p % 2 === 0 ? "nos" : "ells"))) ||
          r.turn === p
        ) {
          actor = p;
          break;
        }
      }
    }
    if (actor === null) return;
    if (actor === HUMAN) return;

    const botPlayer = actor;

    let delay = BOT_DELAY_MS;
    const firstTrick = r.tricks[0]!;
    const aboutToPlayCard =
      r.turn === botPlayer &&
      r.envitState.kind !== "pending" &&
      r.trucState.kind !== "pending" &&
      (r.phase === "envit" || (r.phase === "playing" && r.tricks.length === 1));
    if (aboutToPlayCard && !r.envitResolved && firstTrick.cards.length < 4) {
      const peuNos: PlayerId = teamOf(r.mano) === "nos" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
      const peuElls: PlayerId = teamOf(r.mano) === "ells" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
      const botIsPeu = botPlayer === peuNos || botPlayer === peuElls;
      const botPartner = partnerOf(botPlayer);
      const partnerHasNotPlayedYet = !firstTrick.cards.some(tc => tc.player === botPartner);

      const humanIsPeu = peuNos === HUMAN;
      const humanHasNotPlayedYet = !firstTrick.cards.some(tc => tc.player === HUMAN);
      if (humanIsPeu && humanHasNotPlayedYet) {
        delay = BOT_WAIT_FOR_HUMAN_ENVIT_MS;
      }

      if (botIsPeu && botPartner === HUMAN && partnerHasNotPlayedYet) {
        delay = BOT_WAIT_FOR_HUMAN_ENVIT_MS;
      }
    }

    const trickIdx = r.tricks.length - 1;
    lastSeenTrickIdxRef.current = trickIdx;
    const consultKey = `${match.history.length}-${trickIdx}-${botPlayer}`;
    const isBotTurnWithoutPendingShouts =
      r.turn === botPlayer &&
      r.envitState.kind !== "pending" &&
      r.trucState.kind !== "pending";
    const isPlayCardTurn =
      isBotTurnWithoutPendingShouts &&
      (r.phase === "playing" || (r.phase === "envit" && r.tricks.length === 1));
    const isResponseTurn =
      (r.envitState.kind === "pending" && (r.envitState.awaitingTeam === (botPlayer % 2 === 0 ? "nos" : "ells"))) ||
      (r.trucState.kind === "pending" && (r.trucState.awaitingTeam === (botPlayer % 2 === 0 ? "nos" : "ells")));

    const cachedAdvice = consultAdviceRef.current.get(consultKey) ?? "neutral";

    const buildHints = () => {
      const hints: {
        cardHint?: CardHint;
        playStrength?: PlayStrengthHint;
        silentTruc?: boolean;
        foldTruc?: boolean;
        rivalShownStrength?: boolean;
      } = {};
      // Mode sincer: detecta si algun rival d'aquest bot ha dit
      // "vine-a-mi" o "tinc-bona" en aquesta ronda. Aplica per a TOTS
      // els bots (no només els que tenen humà de company).
      const myTeam = teamOf(botPlayer);
      let rivalSignaled = false;
      for (const pStr of Object.keys(chatSignalsRef.current)) {
        const p = Number(pStr) as PlayerId;
        if (teamOf(p) === myTeam) continue;
        const phrases = chatSignalsRef.current[p] ?? [];
        if (phrases.includes("vine-a-mi") || phrases.includes("tinc-bona")) {
          rivalSignaled = true;
          break;
        }
      }
      if (rivalSignaled) hints.rivalShownStrength = true;

      // Compromís personal del propi bot: si en aquesta baza ha respost
      // "Vine a vore!", "Vine al meu tres!" o "Tinc un 3", aplica el
      // playStrength específic perquè la funció de tria de carta honre
      // el compromís (jugar la carta forta si guanya la mesa, etc.).
      const selfCommit = selfCommitRef.current[botPlayer]?.[trickIdx];
      if (
        selfCommit === "vine-a-vore" ||
        selfCommit === "vine-al-meu-tres" ||
        selfCommit === "tinc-un-tres"
      ) {
        hints.playStrength = selfCommit;
      }

      const isPartnerOfHuman = partnerOf(HUMAN) === botPlayer;
      if (!isPartnerOfHuman) return hints;
      const ch = intentsRef.current.cardHintByTrick[trickIdx];
      if (ch) hints.cardHint = ch;
      const ps = intentsRef.current.playStrengthByTrick[trickIdx];
      // No sobrescriguis el compromís propi del bot amb una pista més
      // laxa que vinga de l'humà.
      if (
        ps &&
        hints.playStrength !== "vine-a-vore" &&
        hints.playStrength !== "vine-al-meu-tres" &&
        hints.playStrength !== "tinc-un-tres"
      ) {
        hints.playStrength = ps;
      }
      if (intentsRef.current.silentByTrick[trickIdx]) hints.silentTruc = true;
      if (intentsRef.current.foldNextTruc) hints.foldTruc = true;
      return hints;
    };

    const partnerOfBot = partnerOf(botPlayer);
    const partnerIsHumanForOpening = partnerOfBot === HUMAN;
    const isRivalOpeningFirstTrick =
      trickIdx === 0 &&
      botPlayer !== HUMAN &&
      partnerOfBot !== HUMAN &&
      isPlayCardTurn &&
      isBotOpeningForTeam(match, botPlayer);
    const questionDelayMs = isRivalOpeningFirstTrick
      ? RIVAL_FIRST_TRICK_PRE_QUESTION_DELAY_MS
      : CONSULT_QUESTION_DELAY_MS;
    const answerDelayMs = isRivalOpeningFirstTrick
      ? RIVAL_FIRST_TRICK_BUBBLE_MS
      : CONSULT_ANSWER_DELAY_MS;
    // Quan el qui respon és un bot, sempre tarda mig segon (no depèn del
    // mode "rival opening first trick"). Així el chat entre bots flueix ràpid.
    const botAnswerDelayMs = CONSULT_BOT_ANSWER_DELAY_MS;
    const decideDelayMs = isRivalOpeningFirstTrick
      ? RIVAL_FIRST_TRICK_BUBBLE_MS
      : CONSULT_DECIDE_DELAY_MS;
    const bubbleDurationMs = isRivalOpeningFirstTrick
      ? RIVAL_FIRST_TRICK_BUBBLE_MS
      : undefined;

    // Cas especial: el bot obri la primera baza per a la seua parella
    // sense cap carta bona de truc (3, 7 oros, 7 espases, As bastos, As
    // espases). En lloc de consultar, diu "A tu!" i tira directament una
    // carta sense esperar resposta del company. S'aplica tant si el
    // company és l'humà com si és un altre bot.
    if (
      isPlayCardTurn &&
      trickIdx === 0 &&
      isBotOpeningForTeam(match, botPlayer) &&
      !consultStartedRef.current.has(consultKey) &&
      !consultAdviceRef.current.has(consultKey) &&
      !hasGoodTrucCard(match, botPlayer)
    ) {
      consultStartedRef.current.add(consultKey);
      consultAdviceRef.current.set(consultKey, "weak");
      timerRef.current = window.setTimeout(() => {
        const hints = buildHints();
        const action = botDecide(match, botPlayer, "weak", hints, tuningRef.current, bluffRateRef.current);
        if (action) dispatch(botPlayer, action);
      }, questionDelayMs) as unknown as number;
      return () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
      };
    }

    // Nota: el bot que obri la 1a baza NO anuncia mai "Vine a mi!".
    // Si té carta top pot consultar al company i tirar segons la
    // resposta, però l'anunci proactiu queda prohibit en aquesta posició.

    // Cas especial: el bot és el 2n en tirar la 1a baza i encara no s'ha
    // envidat. Espera fins SECOND_PLAYER_WAIT_MS perquè el company li
    // indique alguna cosa ("Envida!" o "Tira la falta!"). Si rep
    // instrucció, llança l'envit corresponent. Si no, decideix per ell
    // mateix (botDecide ja considera envidar amb envit alt).
    // Cas: el bot és el peu (segon de la seua parella) en la 1a baza,
    // el seu company ja ha tirat la seua carta, i encara no s'ha envidat.
    // Espera SECOND_PLAYER_WAIT_MS perquè el company li puga dir
    // "envida" o "tira la falta".
    const firstTrickRef = r.tricks[0]!;
    const peuNosCheck: PlayerId = teamOf(r.mano) === "nos" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
    const peuEllsCheck: PlayerId = teamOf(r.mano) === "ells" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
    const botIsPeuOfTeam = botPlayer === peuNosCheck || botPlayer === peuEllsCheck;
    const partnerForSecondWait = partnerOf(botPlayer);
    const partnerHasPlayedAlready = firstTrickRef.cards.some(tc => tc.player === partnerForSecondWait);
    const botHasNotPlayedYet = !firstTrickRef.cards.some(tc => tc.player === botPlayer);
    const isSecondToPlayFirstTrick =
      isPlayCardTurn &&
      trickIdx === 0 &&
      botIsPeuOfTeam &&
      partnerHasPlayedAlready &&
      botHasNotPlayedYet &&
      r.envitState.kind === "none" &&
      !r.envitResolved;
    const waitKey = `wait2-${match.history.length}-${botPlayer}`;
    if (
      isSecondToPlayFirstTrick &&
      pendingSecondWaitRef.current?.waitKey !== waitKey &&
      !consultStartedRef.current.has(waitKey)
    ) {
      consultStartedRef.current.add(waitKey);

      // Si el propi bot ja té envit (≥31), envida directament: no cal
      // preguntar al company ni esperar instruccions. Amb envit alt
      // (30) també, però amb una mica d'aleatorietat per a no ser
      // totalment previsible.
      const myEnvit = playerTotalEnvit(r, botPlayer);
      const canEnvit = legalActions(match, botPlayer).some(
        (a) => a.type === "shout" && a.what === "envit",
      );
      if (canEnvit && myEnvit >= 31) {
        timerRef.current = window.setTimeout(() => {
          dispatch(botPlayer, { type: "shout", what: "envit" });
        }, BOT_DELAY_MS) as unknown as number;
        return () => {
          if (timerRef.current) window.clearTimeout(timerRef.current);
        };
      }
      if (canEnvit && myEnvit >= 30 && Math.random() < 0.8) {
        timerRef.current = window.setTimeout(() => {
          dispatch(botPlayer, { type: "shout", what: "envit" });
        }, BOT_DELAY_MS) as unknown as number;
        return () => {
          if (timerRef.current) window.clearTimeout(timerRef.current);
        };
      }

      const partner = partnerForSecondWait;
      const partnerIsBot = partner !== HUMAN;

      // Decideix l'acció final del peu-bot a partir de la resposta del
      // company a "Tens envit?" (o de la instrucció directa "Envida!"/
      // "Tira la falta!"), combinant-ho amb el seu propi envit.
      const decideEnvitAction = (
        instruction: ChatPhraseId | null,
      ): Action | null => {
        if (instruction === "envida" || instruction === "tira-falta") {
          const what: ShoutKind = instruction === "tira-falta" ? "falta-envit" : "envit";
          const acts = legalActions(match, botPlayer);
          const envitAct = acts.find((a) => a.type === "shout" && a.what === what)
            ?? acts.find((a) => a.type === "shout" && a.what === "envit");
          if (envitAct) return envitAct;
        }
        if (canEnvit && (instruction === "si" || instruction === "no" || instruction === "si-tinc-n")) {
          const partnerHasEnvit = instruction !== "no";
          if (partnerHasEnvit) {
            // Si el company ha revelat el número (si-tinc-n) podem
            // estimar el total de l'equip i decidir amb més precisió.
            if (instruction === "si-tinc-n") {
              const partnerEnvitKnown = playerTotalEnvit(r, partner);
              const teamBest = Math.max(myEnvit, partnerEnvitKnown);
              if (teamBest >= 31) return { type: "shout", what: "envit" };
              if (teamBest >= 29 && Math.random() < 0.85) return { type: "shout", what: "envit" };
              if (teamBest >= 27 && Math.random() < 0.55) return { type: "shout", what: "envit" };
            } else {
              if (myEnvit >= 27 && Math.random() < 0.85) return { type: "shout", what: "envit" };
              if (myEnvit >= 24 && Math.random() < 0.6) return { type: "shout", what: "envit" };
              if (myEnvit >= 20 && Math.random() < 0.3) return { type: "shout", what: "envit" };
            }
          } else {
            // El company no té envit. Només envida si jo en tinc molt.
            if (myEnvit >= 28 && Math.random() < 0.4) return { type: "shout", what: "envit" };
          }
          // No envidar: el peu-bot tira carta com sempre.
          const hints = buildHints();
          return botDecide(match, botPlayer, cachedAdvice, hints, tuningRef.current, bluffRateRef.current);
        }
        // Sense resposta vàlida: decideix com sempre.
        const hints = buildHints();
        return botDecide(match, botPlayer, cachedAdvice, hints, tuningRef.current, bluffRateRef.current);
      };

      const finalize = (instruction: ChatPhraseId | null) => {
        if (pendingSecondWaitRef.current?.waitKey !== waitKey) return;
        if (pendingSecondWaitRef.current.partnerBotTimer) {
          window.clearTimeout(pendingSecondWaitRef.current.partnerBotTimer);
        }
        window.clearTimeout(pendingSecondWaitRef.current.timer);
        pendingSecondWaitRef.current = null;
        const action = decideEnvitAction(instruction);
        if (action) dispatch(botPlayer, action);
      };

      const timeoutId = window.setTimeout(() => finalize(null), SECOND_PLAYER_WAIT_MS) as unknown as number;

      // El peu-bot pregunta proactivament "Tens envit?" al seu company,
      // SEMPRE que puga envidar. Així el bot té informació explícita per
      // decidir si envidar o no, sigui el company humà o un altre bot.
      let partnerBotTimer: number | null = null;
      if (canEnvit && sayRef.current) {
        scheduleConsultTimer(() => {
          sayRef.current?.(botPlayer, "tens-envit", bubbleDurationMs);
          if (partnerIsBot) {
            const answer = partnerAnswerFor(match, partner, "tens-envit", bluffRateRef.current);
            // A "Tens envit?" el company pot dir "Envida!", "Sí",
            // "Tinc {n}" (si en té 30) o "No". Si revela el número,
            // passem la variable {n} amb l'envit real del company.
            const partnerEnvitNow = playerTotalEnvit(r, partner);
            const displayPhrase: ChatPhraseId = answer;
            const sayVars = answer === "si-tinc-n" ? { n: partnerEnvitNow } : undefined;
            scheduleConsultTimer(() => {
              sayRef.current?.(partner, displayPhrase, bubbleDurationMs, sayVars);
              // Si el company només ha dit "Sí" (sense revelar valor) i
              // jo tinc envit en zona dubtosa (24-29), pregunte
              // "Quant envit tens?" per decidir amb informació concreta.
              const hasReasonableDoubt =
                answer === "si" && myEnvit >= 24 && myEnvit <= 29;
              if (hasReasonableDoubt) {
                // Tots els delays d'aquesta cadena viuen a `chatTimings.ts`
                // perquè pregunta, resposta i finalize comparteixin el
                // mateix mínim i no hi haja inconsistències.
                scheduleConsultTimer(() => {
                  sayRef.current?.(botPlayer, "quant-envit", bubbleDurationMs);
                  scheduleConsultTimer(() => {
                    sayRef.current?.(partner, "si-tinc-n", bubbleDurationMs, { n: partnerEnvitNow });
                    // Finalitza només després que la resposta "Tinc {n}"
                    // s'haja mostrat completament.
                    scheduleConsultTimer(() => {
                      // Reutilitzem la mateixa branca de decisió tractant
                      // "si-tinc-n" com a senyal forta amb número conegut.
                      finalize("si-tinc-n");
                    }, QUANT_ENVIT_FOLLOWUP_FINALIZE_DELAY_MS);
                  }, QUANT_ENVIT_FOLLOWUP_ANSWER_DELAY_MS);
                }, QUANT_ENVIT_FOLLOWUP_QUESTION_DELAY_MS);
              } else {
                scheduleConsultTimer(() => {
                  finalize(answer);
                }, decideDelayMs);
              }
            }, botAnswerDelayMs);
          }
          // Si el partner és humà, esperem que responga via
          // notifyChatPhrase (que crida finalize amb "si"/"no" o
          // l'instrucció "envida"/"tira-falta"). El timeout general ja
          // serveix de rescat.
        }, questionDelayMs);
      } else if (partnerIsBot && sayRef.current) {
        // Cas (rar) on el peu-bot no pot envidar però sí que pot esperar
        // l'orde del company-bot: replica la lògica anterior.
        const partnerEnvit = playerTotalEnvit(r, partner);
        const trapPartner = partnerEnvit >= 32 && Math.random() < 0.75;
        if (!trapPartner && partnerEnvit >= 28) {
          const instruction: ChatPhraseId = partnerEnvit >= 33 ? "tira-falta" : "envida";
          partnerBotTimer = window.setTimeout(() => {
            sayRef.current?.(partner, instruction, bubbleDurationMs);
            window.setTimeout(() => finalize(instruction), 700);
          }, PARTNER_BOT_INSTRUCTION_DELAY_MS) as unknown as number;
        }
      }

      pendingSecondWaitRef.current = {
        botPlayer,
        waitKey,
        timer: timeoutId,
        partnerBotTimer,
        resolve: finalize,
      };

      return () => {
        // Neteja només si encara és la mateixa espera (canvi d'estat).
      };
    }

    // Si el bot ha de tirar carta i obri per a la seua parella sense
    // cap carta forta (3, 7 oros, 7 espases, As bastos, As espases),
    // tira directament sense consultar el company. Aplica a qualsevol
    // baza (no només la primera).
    if (
      isPlayCardTurn &&
      isBotOpeningForTeam(match, botPlayer) &&
      !hasGoodTrucCard(match, botPlayer) &&
      !consultStartedRef.current.has(consultKey) &&
      !consultAdviceRef.current.has(consultKey)
    ) {
      consultStartedRef.current.add(consultKey);
      consultAdviceRef.current.set(consultKey, "weak");
      timerRef.current = window.setTimeout(() => {
        const hints = buildHints();
        const action = botDecide(match, botPlayer, "weak", hints, tuningRef.current, bluffRateRef.current);
        if (action) dispatch(botPlayer, action);
      }, decideDelayMs) as unknown as number;
      return () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
      };
    }

    const forceRivalFirstTrickConsult =
      !!sayRef.current &&
      isRivalOpeningFirstTrick &&
      !consultStartedRef.current.has(consultKey) &&
      !consultAdviceRef.current.has(consultKey);

    const shouldStartConsult =
      forceRivalFirstTrickConsult || (
        sayRef.current &&
        !consultStartedRef.current.has(consultKey) &&
        !consultAdviceRef.current.has(consultKey) &&
        ((isPlayCardTurn && shouldConsultPartner(match, botPlayer, tuningRef.current)) ||
          (isResponseTurn && shouldConsultPartner(match, botPlayer, tuningRef.current)))
      );



    if (shouldStartConsult) {
      if (consultInFlightRef.current.has(consultKey)) return;

      consultStartedRef.current.add(consultKey);
      consultInFlightRef.current.add(consultKey);
      const partner = partnerOf(botPlayer);
      const question = pickQuestion(match, botPlayer);
      const partnerIsHuman = partner === HUMAN;

      scheduleConsultTimer(() => {
        sayRef.current?.(botPlayer, question, bubbleDurationMs);

        if (partnerIsHuman) {
          const finalize = (answer: ChatPhraseId | null) => {
            if (pendingHumanAnswerRef.current?.consultKey !== consultKey) return;
            window.clearTimeout(pendingHumanAnswerRef.current.timer);
            pendingHumanAnswerRef.current = null;
            const advice: PartnerAdvice = answer ? adviceFromAnswer(answer, question) : "neutral";
            consultAdviceRef.current.set(consultKey, advice);
            scheduleConsultTimer(() => {
              const hints = buildHints();
              const action = botDecide(match, botPlayer, advice, hints, tuningRef.current, bluffRateRef.current);
              if (hints.foldTruc && action?.type === "shout" && action.what === "no-vull") {
                intentsRef.current.foldNextTruc = false;
              }
              if (action) dispatch(botPlayer, action);
              finishConsult(consultKey);
            }, decideDelayMs);
          };

          const timeoutId = window.setTimeout(() => {
            finalize(null);
          }, CONSULT_HUMAN_TIMEOUT_MS) as unknown as number;

          pendingHumanAnswerRef.current = {
            botPlayer,
            consultKey,
            timer: timeoutId,
            resolve: (ans) => finalize(ans),
          };
        } else {
          // Context per a "Vine al meu tres": ¿algun rival del partner
          // ha dit "No tinc res" en aquesta ronda?
          const partnerTeam = teamOf(partner);
          let rivalSaidNoTincRes = false;
          for (const pStr of Object.keys(chatSignalsRef.current)) {
            const p = Number(pStr) as PlayerId;
            if (teamOf(p) === partnerTeam) continue;
            if ((chatSignalsRef.current[p] ?? []).includes("no-tinc-res")) {
              rivalSaidNoTincRes = true;
              break;
            }
          }
          const answer = partnerAnswerFor(match, partner, question, bluffRateRef.current, { rivalSaidNoTincRes });
          const advice = adviceFromAnswer(answer, question);
          scheduleConsultTimer(() => {
            sayRef.current?.(partner, answer, bubbleDurationMs);
            scheduleConsultTimer(() => {
              consultAdviceRef.current.set(consultKey, advice);
              const hints = buildHints();
              const action = botDecide(match, botPlayer, advice, hints, tuningRef.current, bluffRateRef.current);
              if (hints.foldTruc && action?.type === "shout" && action.what === "no-vull") {
                intentsRef.current.foldNextTruc = false;
              }
              if (action) dispatch(botPlayer, action);
              finishConsult(consultKey);
            }, decideDelayMs);
          }, botAnswerDelayMs);
        }
      }, questionDelayMs);

      return;
    }

    // Si ja hi ha una consulta o espera en curs per a aquest bot,
    // no programes una decisió paral·lela.
    if (pendingHumanAnswerRef.current?.botPlayer === botPlayer) {
      return;
    }
    if (pendingSecondWaitRef.current?.botPlayer === botPlayer) {
      return;
    }
    if (consultInFlightRef.current.has(consultKey)) {
      return;
    }

    timerRef.current = window.setTimeout(() => {
      const hints = buildHints();
      const action = botDecide(match, botPlayer, cachedAdvice, hints, tuningRef.current, bluffRateRef.current);
      if (hints.foldTruc && action?.type === "shout" && action.what === "no-vull") {
        intentsRef.current.foldNextTruc = false;
      }
      if (action) dispatch(botPlayer, action);
    }, delay) as unknown as number;

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [match, dispatch, options.paused]);

  useEffect(() => {
    if (pausedRef.current) return;
    if (match.round.phase === "round-end") {
      // Si l'envit ha estat volgut, donem 3s extra per a la revelació de
      // les cartes d'envit abans de començar la nova mà.
      const lastSummary = match.history[match.history.length - 1];
      const envitRevealed = !!(lastSummary && lastSummary.envitWinner && !lastSummary.envitRejected && lastSummary.envitPoints > 0);
      const delay = envitRevealed ? 5800 : 2800;
      const t = window.setTimeout(() => newRound(), delay);
      return () => window.clearTimeout(t);
    }
  }, [match.round.phase, match.history, newRound, options.paused]);

  const humanActions = legalActions(match, HUMAN);

  return {
    match,
    dispatch,
    humanActions,
    shoutFlash,
    lastShoutByPlayer,
    shoutLabelByPlayer,
    acceptedShoutByPlayer,
    shoutFamilyByPlayer,
    envitShoutByPlayer,
    envitShoutLabelByPlayer,
    envitOutcomeByPlayer,
    newGame,
    newRound,
    setPartnerCardHintForCurrentTrick,
    setPartnerPlayStrengthForCurrentTrick,
    setPartnerSilentForCurrentTrick,
    setPartnerFoldNextTruc,
    notifyChatPhrase,
    setForcedNextDealer,
    /** Comprova si algun rival d'aquest jugador ha emès una frase concreta
     *  en la ronda actual (utilitzat per al context de "Vine al meu 3"). */
    rivalsHaveSaid: (forPlayer: PlayerId, phraseId: ChatPhraseId): boolean => {
      const t = teamOf(forPlayer);
      for (const pStr of Object.keys(chatSignalsRef.current)) {
        const p = Number(pStr) as PlayerId;
        if (teamOf(p) === t) continue;
        if ((chatSignalsRef.current[p] ?? []).includes(phraseId)) return true;
      }
      return false;
    },
  };
}
