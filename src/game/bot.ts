import type { Action, Card, MatchState, PlayerId } from "./types";
import { legalActions } from "./engine";
import { bestEnvit, cardStrength } from "./deck";
import { teamOf } from "./types";
import type { PartnerAdvice } from "./botConsult";
import { pickFortCard, pickMolestoCard, pickTresCard, type CardHint, type PlayStrengthHint } from "./playerIntents";
import { recordBotDecision } from "./botDebug";
import { NEUTRAL_TUNING, type BotTuning } from "./profileAdaptation";

export interface BotHints {
  cardHint?: CardHint;
  playStrength?: PlayStrengthHint;
  silentTruc?: boolean;
  foldTruc?: boolean;
  /**
   * Mode sincer: indica si algun rival ha mostrat força en aquesta ronda
   * dient "Vine a mi!" (vine-a-mi) o "Algo tinc" (tinc-bona). Quan és
   * `true`, mai es reserva una carta forta (manilla d'espases o manilla
   * d'oros) confiant que la mesa és inofensiva.
   */
  rivalShownStrength?: boolean;
}

export function botDecide(
  m: MatchState,
  player: PlayerId,
  partnerAdvice: PartnerAdvice = "neutral",
  hints: BotHints = {},
  tuning: BotTuning = NEUTRAL_TUNING,
  bluffRate: number = 0,
): Action | null {
  const actions = legalActions(m, player);
  if (actions.length === 0) return null;

  const r = m.round;
  const hand = r.hands[player];
  const handStrength = avgStrength(hand);
  const myEnvit = bestEnvit(hand);

  if (r.envitState.kind === "pending" && teamOf(player) === r.envitState.awaitingTeam) {
    const isManoMe = r.mano === player;
    const trucStrength = estimateTrucStrength(hand);
    return decideEnvitResponse(actions, myEnvit, r.envitState.level, isManoMe, trucStrength, player, tuning, bluffRate, m, partnerAdvice);
  }
  if (r.trucState.kind === "pending" && teamOf(player) === r.trucState.awaitingTeam) {
    // Ordre del company humà: "Au, anem-se'n!" => rebutja el truc si és possible.
    if (hints.foldTruc) {
      const noVull = actions.find(a => a.type === "shout" && a.what === "no-vull");
      if (noVull) return noVull;
    }
    return decideTrucResponse(actions, hand, m, player, partnerAdvice, tuning, bluffRate);
  }

  // ---- Estratègia "trampa" d'envit ----
  // Si sóc MÀ amb envit molt fort (≥31), sovint NO envide i espere que
  // ho faça el rival per a guanyar més pedres. El PEU (segon de la
  // parella) en canvi, si té envit (≥31), envida directament: no té
  // sentit esperar perquè ja és el seu torn d'envidar.
  const isMano = r.mano === player;
  const trapEnvit =
    (isMano && myEnvit >= 31) ||
    (partnerAdvice === "strong" && myEnvit >= 28);

  const canEnvit = actions.some(a => a.type === "shout" && a.what === "envit");
  // Peu amb envit (≥31): envida sí o sí, sense consultar ni esperar.
  if (canEnvit && !isMano && myEnvit >= 31) {
    return { type: "shout", what: "envit" };
  }
  // Mode honest (bluffRate === 0): només envida si realment té possibilitats
  // reals de guanyar l'envit (≥31). Si la mà és, envida; si és peu ja s'ha
  // tractat més amunt. Sense farols ni envits especulatius amb 27/30.
  if (canEnvit && bluffRate === 0) {
    // Mode sincer: amb 31/32/33 d'envit sempre envida, tant si sóc mà com peu.
    // No fem "trampa" (no esperem que envide el rival) perquè això podria
    // implicar deixar passar l'envit i amagar joc, contrari al mode sincer.
    if (myEnvit >= 31) return { type: "shout", what: "envit" };
    // No fer cap altre envit en mode sincer.
  } else
  if (canEnvit && !trapEnvit) {
    if (myEnvit >= 30 && Math.random() < 0.8 * tuning.callPropensity) {
      return { type: "shout", what: "envit" };
    }
    if (myEnvit >= 27 && Math.random() < 0.3 * tuning.callPropensity) {
      return { type: "shout", what: "envit" };
    }
    // Bluff envit: només si el perfil ho permet (bluffRate > 0).
    if (bluffRate > 0 && myEnvit < 24 && Math.random() < bluffRate * tuning.bluffPropensity * tuning.callPropensity) {
      return { type: "shout", what: "envit" };
    }
  }
  // Amb trampa activa, de tant en tant igualment envida (per no ser previsible).
  // En mode sincer no s'aplica aquesta aleatorietat.
  if (canEnvit && trapEnvit && bluffRate > 0 && Math.random() < 0.12) {
    return { type: "shout", what: "envit" };
  }

  const canTruc = actions.some(a => a.type === "shout" && a.what === "truc");
  if (canTruc && !hints.silentTruc) {
    const trucAction = decideProactiveTruc(m, player, hand, handStrength, partnerAdvice, tuning, bluffRate);
    if (trucAction) return trucAction;
  }

  const playActions = actions.filter(a => a.type === "play-card") as Extract<Action, { type: "play-card" }>[];
  if (playActions.length === 0) {
    return actions[0]!;
  }

  // Ordres del company humà sobre quina carta tirar
  if (hints.cardHint === "fort") {
    const myTeamWonFirst = r.tricks[0]?.winner !== undefined && teamOf(r.tricks[0]!.winner!) === teamOf(player);
    const card = pickFortCard(hand, myTeamWonFirst);
    if (card) {
      const match = playActions.find(a => a.cardId === card.id);
      if (match) return match;
    }
  }
  if (hints.cardHint === "molesto") {
    const card = pickMolestoCard(hand);
    if (card) {
      const match = playActions.find(a => a.cardId === card.id);
      if (match) return match;
    }
  }
  if (hints.cardHint === "tres") {
    const card = pickTresCard(hand);
    if (card) {
      const match = playActions.find(a => a.cardId === card.id);
      if (match) return match;
    }
  }

  return choosePlayCard(m, player, playActions, partnerAdvice, hints.playStrength ?? null, hints.rivalShownStrength ?? false);
}

function avgStrength(hand: Array<{ suit: string; rank: number }>): number {
  if (hand.length === 0) return 0;
  let s = 0;
  for (const c of hand) s += cardStrength(c as any);
  return s / hand.length;
}

function estimateTrucStrength(hand: Array<{ suit: string; rank: number }>): number {
  // 0..1 aprox. Cartes molt fortes (≥85: manilla d'oros, manilla d'espases,
  // As bastos, As espases) valen molt; el 3 val mitjà; resta poc.
  let s = 0;
  for (const c of hand) {
    const v = cardStrength(c as any);
    if (v >= 85) s += 0.5;          // topTrucCards fortes + asos
    else if (v >= 70) s += 0.3;     // tres
    else if (v >= 50) s += 0.12;    // 6 o 7 menor
    else s += 0.04;
  }
  return Math.min(1, s);
}

/**
 * Distribució discreta aproximada del valor d'envit del rival que ja ha
 * cantat al nivell donat. Cobreix de 20 a 40 (valors típics). Pesos
 * estimats segons l'agressivitat creixent: més nivell → distribució
 * desplaçada cap a valors alts.
 */
function opponentEnvitDistribution(level: 2 | 4 | "falta"): Map<number, number> {
  // Pesos relatius. Es normalitzen després.
  const dist = new Map<number, number>();
  const set = (v: number, w: number) => dist.set(v, (dist.get(v) ?? 0) + w);

  if (level === 2) {
    // Envit simple: la majoria envida amb 29-33; cua fins a 38; algun bluff baix.
    set(25, 0.3); set(26, 0.5); set(27, 0.8); set(28, 1.2);
    set(29, 2.0); set(30, 3.0); set(31, 3.2); set(32, 2.8);
    set(33, 2.2); set(34, 1.6); set(35, 1.0); set(36, 0.6); set(37, 0.4); set(38, 0.2);
  } else if (level === 4) {
    // Renvit: el rival ja ha pujat → mà més forta.
    set(28, 0.3); set(29, 0.5); set(30, 1.0); set(31, 1.8);
    set(32, 2.6); set(33, 3.0); set(34, 2.8); set(35, 2.2);
    set(36, 1.6); set(37, 1.0); set(38, 0.6); set(39, 0.3); set(40, 0.2);
  } else {
    // Falta-envit: típicament només es canta amb mà molt forta o desesperació.
    set(28, 0.4); set(29, 0.5); set(30, 0.8); set(31, 1.2);
    set(32, 1.8); set(33, 2.4); set(34, 2.6); set(35, 2.4);
    set(36, 2.0); set(37, 1.6); set(38, 1.2); set(39, 0.8); set(40, 0.5);
  }
  // Normalitza.
  let sum = 0;
  for (const w of dist.values()) sum += w;
  for (const [k, v] of dist) dist.set(k, v / sum);
  return dist;
}

/**
 * Probabilitat de guanyar l'envit donat el meu valor i si soc mà.
 * Mà guanya els empats.
 */
function envitWinProbability(myEnvit: number, level: 2 | 4 | "falta", isMano: boolean): number {
  const dist = opponentEnvitDistribution(level);
  let pWin = 0;
  for (const [oppVal, p] of dist) {
    if (myEnvit > oppVal) pWin += p;
    else if (myEnvit === oppVal && isMano) pWin += p;
  }
  return pWin;
}

function decideEnvitResponse(
  actions: Action[],
  myEnvit: number,
  level: 2 | 4 | "falta",
  isMano: boolean,
  trucStrength: number,
  player: PlayerId,
  tuning: BotTuning = NEUTRAL_TUNING,
  bluffRate: number = 0,
  m?: MatchState,
  partnerAdvice: PartnerAdvice = "neutral",
): Action {
  // Punts en joc per nivell (vull / no vull):
  //   envit (2): +2 si guanyem / -1 si perdem    → cost no-vull = 1 al rival
  //   renvit (4): +4 / -2                         → cost no-vull = 2
  //   falta:    +molts / -(1|2|4) segons history  → assumim cost no-vull = 2
  const pWin = envitWinProbability(myEnvit, level, isMano);

  // EV (en pedres) d'acceptar respecte rebutjar:
  //   EV_accept = pWin*win - (1-pWin)*lose
  //   EV_reject = -costRebuig  (perdem aquests punts segur)
  //   acceptem si EV_accept > EV_reject
  let win: number, lose: number, costRebuig: number;
  if (level === 2) { win = 2; lose = 2; costRebuig = 1; }
  else if (level === 4) { win = 4; lose = 4; costRebuig = 2; }
  else { win = 8; lose = 8; costRebuig = 2; } // falta: aproximació

  // Bonus per força de truc: si la mà és bona de joc, perdre l'envit "fa
  // menys mal" perquè recuperem amb el truc (+0.5/+1 pedra equivalent).
  const trucBonus = trucStrength >= 0.7 ? 1.0 : trucStrength >= 0.5 ? 0.5 : trucStrength <= 0.2 ? -0.5 : 0;

  const evAccept = pWin * win - (1 - pWin) * lose + trucBonus + tuning.envitAcceptDelta;
  const evReject = -costRebuig;

  // Pujar (renvit / falta-envit) val la pena només si la nostra prob. després
  // de pujar (que sol baixar perquè el rival rebutja amb mà mediocre i només
  // continua amb la millor) compensa el cost extra. Heurística: necessitem
  // pWin alta i un mínim absolut d'envit.
  const canRaise = actions.some(a => a.type === "shout" && (a.what === "renvit" || a.what === "falta-envit"));
  const raiseAction = actions.find(a => a.type === "shout" && (a.what === "renvit" || a.what === "falta-envit"));

  const log = (decision: string) => {
    // eslint-disable-next-line no-console
    console.log(
      `[bot envit] p${player} decision=${decision} level=${level} myEnvit=${myEnvit} mano=${isMano} ` +
      `pWin=${pWin.toFixed(2)} EV_accept=${evAccept.toFixed(2)} EV_reject=${evReject.toFixed(2)} ` +
      `trucStrength=${trucStrength.toFixed(2)} trucBonus=${trucBonus.toFixed(2)}`
    );
    recordBotDecision({
      player,
      kind: "envit",
      decision,
      level,
      myEnvit,
      isMano,
      pWin,
      evAccept,
      evReject,
      trucStrength,
      trucBonus,
    });
  };

  // ----- Mode SINCER (bluffRate === 0): regles dures d'envit -----
  // Amb 31/32/33 d'envit, mai rebutjar i, segons el nivell, pujar la juga:
  //   · myEnvit ≥ 31 → mai "no-vull" en sincer (acceptem com a mínim).
  //   · myEnvit ≥ 32 i nivell 2 (envit) → "renvit" (Torne a envidar).
  //   · myEnvit = 33 i sóc mà i nivell 4 (renvit) → "falta-envit"
  //     (com a mà guanyem segur l'empat a 33).
  if (bluffRate === 0) {
    const renvitAction = actions.find(
      (a) => a.type === "shout" && a.what === "renvit",
    );
    const faltaAction = actions.find(
      (a) => a.type === "shout" && a.what === "falta-envit",
    );
    const vullAction = actions.find(
      (a) => a.type === "shout" && a.what === "vull",
    );
    if (myEnvit >= 33 && isMano && level === 4 && faltaAction) {
      log("falta-envit (sincer, mà 33)");
      return faltaAction;
    }
    if (myEnvit >= 32 && level === 2 && renvitAction) {
      log("renvit (sincer, ≥32)");
      return renvitAction;
    }
    if (myEnvit >= 31 && vullAction) {
      log("vull (sincer, ≥31)");
      return vullAction;
    }
  }

  // ----- Mode CONSERVADOR (regla dura) -----
  // Només acceptar envit si:
  //   (a) myEnvit ≥ 31 (31, 32 o 33+ → grans possibilitats reals), o
  //   (b) el meu equip ja ha guanyat la primera baza I tinc una "carta top"
  //       (manilla d'oros, manilla d'espases, As bastos, As espases) a la mà, o
  //   (c) el meu equip ja ha guanyat la primera baza I sé que el meu
  //       company té una carta top (deduït pel partnerAdvice "strong"
  //       després d'una pregunta directa: "vine-a-mi" / "tinc-bona" /
  //       "tens-mes-dun-tres" → "si"). Vegeu adviceFromAnswer.
  // En qualsevol altre cas: NO VULL (rebutjar).
  // No s'aplica a renvit/falta-envit pujats per nosaltres (canRaise) si
  // tenim envit molt alt — gestionat més avall.
  if (tuning.conservativeMode && m) {
    const myTeam = teamOf(player);
    const firstTrick = m.round.tricks[0];
    const wonFirstTrick =
      !!firstTrick &&
      firstTrick.winner !== undefined &&
      firstTrick.parda !== true &&
      teamOf(firstTrick.winner!) === myTeam;
    const hand = m.round.hands[player];
    const hasTopCard = hand.some(
      (c) =>
        (c.rank === 7 && (c.suit === "oros" || c.suit === "espases")) ||
        (c.rank === 1 && (c.suit === "bastos" || c.suit === "espases")),
    );
    const partnerSignalsTop = partnerAdvice === "strong";

    const conservativeAllow =
      myEnvit >= 31 ||
      (wonFirstTrick && (hasTopCard || partnerSignalsTop));

    if (!conservativeAllow) {
      log("no-vull (conservador)");
      return { type: "shout", what: "no-vull" };
    }
    // Si entrem aquí, podem continuar amb la lògica EV/raise normal,
    // però recordem: en general, conservador prefereix "vull" sense pujar.
  }

  if (canRaise && raiseAction) {
    // En mode conservador: pujar només amb envit molt alt i pWin >= 0.85.
    if (tuning.conservativeMode) {
      if (level === 2 && pWin >= 0.85 && myEnvit >= 34) {
        log(`pujar (${(raiseAction as any).what}) [conservador]`);
        return raiseAction;
      }
    } else {
      if (level === 2 && pWin >= 0.7 && myEnvit >= 33) {
        log(`pujar (${(raiseAction as any).what})`);
        return raiseAction;
      }
      if (level === 4 && pWin >= 0.8 && myEnvit >= 35) {
        log(`pujar (${(raiseAction as any).what})`);
        return raiseAction;
      }
    }
  }

  if (evAccept > evReject) {
    log("vull");
    return { type: "shout", what: "vull" };
  }
  if (
    bluffRate > 0 &&
    !tuning.conservativeMode &&
    level === 2 &&
    evAccept > evReject - 0.5 &&
    (isMano || trucStrength >= 0.6) &&
    Math.random() < bluffRate
  ) {
    log("vull (bluff)");
    return { type: "shout", what: "vull" };
  }
  log("no-vull");
  return { type: "shout", what: "no-vull" };
}

function decideTrucResponse(
  actions: Action[],
  hand: Array<{ suit: string; rank: number }>,
  m: MatchState,
  player: PlayerId,
  partnerAdvice: PartnerAdvice = "neutral",
  tuning: BotTuning = NEUTRAL_TUNING,
  bluffRate: number = 0,
): Action {
  const r = m.round;
  const myTeam = teamOf(player);
  const myWinsSoFar = r.tricks.filter(t => t.winner !== undefined && teamOf(t.winner!) === myTeam).length;
  const oppWinsSoFar = r.tricks.filter(
    t => t.winner !== undefined && t.parda !== true && teamOf(t.winner!) !== myTeam,
  ).length;
  const topCards = hand.filter(c => cardStrength(c as any) >= 80).length;
  const goodCards = hand.filter(c => cardStrength(c as any) >= 60).length;
  // "Top de truc" segons l'usuari: manilla d'oros, manilla d'espases, As bastos, As espases.
  const hasTopTrucCard = hand.some(c =>
    (c.rank === 7 && (c.suit === "oros" || c.suit === "espases")) ||
    (c.rank === 1 && (c.suit === "bastos" || c.suit === "espases")),
  );
  // Cartes top de truc (les 4 més fortes, força ≥ 85): As espases (100),
  // As bastos (95), manilla d'espases (7 espases, 90), manilla d'oros
  // (7 oros, 85). Un 3 val 70.
  const topTrucCards = hand.filter(c => cardStrength(c as any) >= 85).length;
  const threes = hand.filter(c => (c as any).rank === 3).length;
  // Suma total de força de la mà (màxim teòric ~270 amb les 3 topTrucCards altes).
  const totalStrength = hand.reduce((s, c) => s + cardStrength(c as any), 0);
  const adviceBoost = partnerAdvice === "strong" ? 25 : partnerAdvice === "weak" ? -20 : 0;
  const strength = avgStrength(hand) + myWinsSoFar * 30 + topCards * 15 + adviceBoost;
  const myEnvit = bestEnvit(hand as any);

  // Punts en joc segons el nivell del truc actual:
  //  - truc (2):     si vull = 2 pts, si no vull = 1 pt al rival
  //  - retruc (3):   si vull = 3 pts, si no vull = 2 pts al rival
  //  - quatre (4):   si vull = 4 pts, si no vull = 3 pts al rival
  //  - joc-fora (24): si vull = guanya tota la partida; si no vull = 4 pts
  const trucLevel = r.trucState.kind === "pending" ? r.trucState.level : 2;

  // Llindars segons el nivell: com més punts arrisques, més forta ha de ser
  // la mà per acceptar o pujar. strength típic: 30 (fluix) – 130+ (molt fort).
  let acceptStrength: number;
  let raiseStrength: number;
  if (trucLevel === 2) {        // truc → vull = 2 pts
    acceptStrength = 60;
    raiseStrength = 95;
  } else if (trucLevel === 3) { // retruc → vull = 3 pts
    acceptStrength = 75;
    raiseStrength = 105;
  } else if (trucLevel === 4) { // quatre val → vull = 4 pts
    acceptStrength = 90;
    raiseStrength = 120;
  } else {                       // joc-fora → vull = guanya tota la partida
    acceptStrength = 130;
    raiseStrength = 999;
  }

  // Apply profile-driven adjustments: a tighter human (low accept_threshold)
  // means our bluffs work — bot accepts with weaker hands too.
  acceptStrength = Math.max(30, acceptStrength + tuning.acceptThresholdDelta);
  raiseStrength = Math.max(60, raiseStrength + tuning.acceptThresholdDelta * 0.5);

  const canEnvit = actions.some(a => a.type === "shout" && a.what === "envit");
  if (canEnvit) {
    // Mode sincer (bluffRate === 0): contra-envit determinista. Només envida
    // si té possibilitats reals (≥31). Sense multiplicadors aleatoris.
    if (bluffRate === 0) {
      if (myEnvit >= 31) return { type: "shout", what: "envit" };
    } else {
    if (myEnvit >= 30 && Math.random() < 0.85 * tuning.callPropensity) return { type: "shout", what: "envit" };
    if (myEnvit >= 27 && Math.random() < 0.55 * tuning.callPropensity) return { type: "shout", what: "envit" };
    if (myEnvit >= 24 && Math.random() < 0.25 * tuning.callPropensity) return { type: "shout", what: "envit" };
    }
  }

  const raise = actions.find(a => a.type === "shout" && (a.what === "retruc" || a.what === "quatre" || a.what === "joc-fora"));
  const isRaiseJocFora = raise && raise.type === "shout" && raise.what === "joc-fora";

  // Cartes excel·lents.
  const hasBothTopAces =
    hand.some(c => c.rank === 1 && c.suit === "espases") &&
    hand.some(c => c.rank === 1 && c.suit === "bastos");

  // Mai pujar a "joc-fora" sense tindre la mà pràcticament guanyada.
  const canRaiseSafely = raise && (!isRaiseJocFora || (hasBothTopAces && myWinsSoFar >= 1));

  // ----- Regla dura: avaluació mínima de la mà segons el nivell -----
  // Si la mà no té cap carta de valor (cap 3 ni cap manilla), és gairebé
  // impossible guanyar el truc: cal rebutjar sempre, encara que el rival
  // canti truc nivell 2.
  // Calcula també les topTrucCards "efectives" (no jugades encara per cap rival
  // del meu equip, però simplificat: només les que jo tinc en mà).
  const hasAnyValuable = topTrucCards >= 1 || threes >= 1;
  // Cartes restants per jugar de la mà (es descomten les que ja he tirat:
  // hand.length ja reflecteix la mà actual viva).
  const cardsLeft = hand.length;

  // Si la mà no val res, mai acceptar pujades >= retruc.
  if (!hasAnyValuable && trucLevel >= 3) {
    return { type: "shout", what: "no-vull" };
  }
  // Per a un truc simple (nivell 2), si a més anem perdent la mà i no tenim
  // cap carta valuosa, també rebutgem.
  if (!hasAnyValuable && trucLevel === 2 && (oppWinsSoFar >= 1 || myWinsSoFar === 0)) {
    return { type: "shout", what: "no-vull" };
  }

  // Per a "joc-fora" cal una mà extraordinària: dos asos top o bé manilla +
  // baza ja guanyada. Sense això, rebutjar sempre.
  if (trucLevel === 24) {
    if (!hasBothTopAces && !(topTrucCards >= 1 && myWinsSoFar >= 1 && threes + topTrucCards >= 2)) {
      return { type: "shout", what: "no-vull" };
    }
  }

  // Per a "quatre van", exigim almenys una manilla o (3 + baza guanyada).
  if (trucLevel === 4) {
    if (topTrucCards === 0 && !(threes >= 1 && myWinsSoFar >= 1)) {
      return { type: "shout", what: "no-vull" };
    }
  }

  // Per a "retruc", exigim almenys un 3 o una manilla.
  if (trucLevel === 3 && topTrucCards === 0 && threes === 0) {
    return { type: "shout", what: "no-vull" };
  }

  if (canRaiseSafely && (hasBothTopAces || strength >= raiseStrength)) {
    return raise!;
  }
  if (canRaiseSafely && topCards >= 2 && myWinsSoFar >= 1) {
    return raise!;
  }
  if (canRaiseSafely && strength >= raiseStrength - 10 && Math.random() < 0.6) {
    return raise!;
  }

  // Si el rival ja ha guanyat alguna baza i la mà és fluixa, no acceptar
  // pujades cares: és tirar punts.
  if (oppWinsSoFar >= 1 && trucLevel >= 3 && strength < acceptStrength + 10) {
    return { type: "shout", what: "no-vull" };
  }

  if (strength >= acceptStrength) return { type: "shout", what: "vull" };
  if (myWinsSoFar >= 1 && goodCards >= 1 && trucLevel <= 3) return { type: "shout", what: "vull" };
  if (
    bluffRate > 0 &&
    strength >= acceptStrength - 10 &&
    trucLevel === 2 &&
    hasAnyValuable &&
    Math.random() < bluffRate * 2.5
  ) {
    return { type: "shout", what: "vull" };
  }
  if (partnerAdvice === "weak") return { type: "shout", what: "no-vull" };
  // Bluff residual només quan el cost és baix (truc nivell 2), tenim alguna
  // carta amb la qual defensar-nos i el perfil permet farolejar.
  if (
    bluffRate > 0 &&
    trucLevel === 2 &&
    hasAnyValuable &&
    Math.random() < bluffRate * tuning.bluffPropensity
  ) {
    return { type: "shout", what: "vull" };
  }
  return { type: "shout", what: "no-vull" };
}

function decideProactiveTruc(
  m: MatchState,
  player: PlayerId,
  hand: Array<{ suit: string; rank: number }>,
  handStrength: number,
  partnerAdvice: PartnerAdvice = "neutral",
  tuning: BotTuning = NEUTRAL_TUNING,
  bluffRate: number = 0,
): Action | null {
  const adviceBoost = partnerAdvice === "strong" ? 20 : partnerAdvice === "weak" ? -15 : 0;
  handStrength = handStrength + adviceBoost;
  const r = m.round;
  const myTeam = teamOf(player);
  const oppTeam = myTeam === "nos" ? "ells" : "nos";

  const myWins = r.tricks.filter(t => t.winner !== undefined && teamOf(t.winner!) === myTeam).length;
  const oppWins = r.tricks.filter(t => t.winner !== undefined && teamOf(t.winner!) === oppTeam).length;

  const topCards = hand.filter(c => cardStrength(c as any) >= 80).length;
  const goodCards = hand.filter(c => cardStrength(c as any) >= 60).length;
  // "Top de truc" segons l'usuari: manilla d'oros, manilla d'espases, As bastos, As espases.
  const hasTopTrucCard = hand.some(c =>
    (c.rank === 7 && (c.suit === "oros" || c.suit === "espases")) ||
    (c.rank === 1 && (c.suit === "bastos" || c.suit === "espases")),
  );

  const myScoreObj = m.scores[myTeam];
  const oppScoreObj = m.scores[oppTeam];
  const myScore = Math.min(myScoreObj.males + myScoreObj.bones, 24);
  const oppScore = Math.min(oppScoreObj.males + oppScoreObj.bones, 24);
  const target = m.targetCama;
  const losingBig = oppScore - myScore >= 4;
  const winningBig = myScore - oppScore >= 4;
  const closeToWin = myScore >= target * 2 - 3;

  // ---- Estratègia "trampa" de truc ----
  // Amb mà MOLT forta (>=2 tops, o tots dos asos), espera que truque el rival
  // per poder retrucar i guanyar més pedres. De tant en tant truca igualment
  // per a no ser predictible.
  const hasBothTopAces =
    hand.some(c => c.rank === 1 && c.suit === "espases") &&
    hand.some(c => c.rank === 1 && c.suit === "bastos");
  const veryStrongHand = topCards >= 2 || hasBothTopAces;

  if (veryStrongHand && !closeToWin) {
    // 80% espera (no truca), 20% truca per disfressar.
    // En mode honest, només si compleix la condició estricta (1a baza guanyada
    // o confirmació del company).
    if (bluffRate === 0) {
      const partnerStrong = partnerAdvice === "strong";
      if (myWins < 1 && !partnerStrong) return null;
      // Sincer: amb mà molt forta, NORMALMENT espera que truque el rival
      // per poder retrucar i guanyar més punts. Només truca proactivament
      // si va perdent per molt (necessita punts ja) o si està a punt de
      // tancar la cama. Així no s'abusa del "Truc i passe".
      if (!losingBig) return null;
      return { type: "shout", what: "truc" };
    }
    if (Math.random() < 0.8) return null;
    return { type: "shout", what: "truc" };
  }

  // En mode honest (bluffRate === 0) només cantem truc si tenim una carta
  // forta de truc (manilla d'oros / manilla d'espases / As bastos / As
  // espases) i, a més, l'equip ja ha guanyat la 1a baza o el company ha
  // confirmat força. A més, per no abusar del "Truc i passe", només truca
  // proactivament en situacions clau (perdent per molt o a punt de tancar);
  // en cas contrari espera que truque el rival per poder retrucar.
  if (bluffRate === 0) {
    const partnerStrong = partnerAdvice === "strong";
    if (!hasTopTrucCard) return null;
    if (myWins < 1 && !partnerStrong) return null;
    if (!losingBig && !closeToWin) return null;
    return { type: "shout", what: "truc" };
  }

  if (topCards >= 2 || (myWins >= 1 && handStrength > 75)) {
    if (Math.random() < 0.7 && !closeToWin) return null;
    return { type: "shout", what: "truc" };
  }

  if (handStrength > 70 || (myWins >= 1 && goodCards >= 2)) {
    const p = (losingBig ? 0.7 : 0.45) * tuning.callPropensity;
    if (Math.random() < p) return { type: "shout", what: "truc" };
    return null;
  }

  if (handStrength > 55 || (myWins >= 1 && goodCards >= 1)) {
    const p = (losingBig ? 0.35 : winningBig ? 0.1 : 0.2) * tuning.callPropensity;
    if (Math.random() < p) return { type: "shout", what: "truc" };
    return null;
  }

  if (bluffRate > 0 && oppWins === 0) {
    const p = (losingBig ? bluffRate * 1.2 : bluffRate * 0.5) * tuning.bluffPropensity;
    if (Math.random() < p) return { type: "shout", what: "truc" };
  }

  return null;
}

function choosePlayCard(
  m: MatchState,
  player: PlayerId,
  playActions: Extract<Action, { type: "play-card" }>[],
  partnerAdvice: PartnerAdvice = "neutral",
  playStrength: PlayStrengthHint = null,
  rivalShownStrength: boolean = false,
): Action {
  const r = m.round;
  const hand = r.hands[player];
  const trick = r.tricks[r.tricks.length - 1]!;
  const cards = playActions.map(a => hand.find(c => c.id === a.cardId)!).filter(Boolean);

  const sorted = [...cards].sort((a, b) => cardStrength(a) - cardStrength(b));
  const lowest = sorted[0]!;
  const highest = sorted[sorted.length - 1]!;

  // Pista directa de força del company humà via chat.
  // "low"  → tira la carta més baixa (l'humà cobreix amb una bona).
  // "high" → tira la carta més alta (l'humà no té res, salva tu la baza).
  // "free" → segueix amb la lògica normal (no força res).
  // "vine-a-vore" → el bot mateix s'ha compromés a tindre 7 d'oros o un 3:
  //   ha de jugar eixa carta si guanya la mesa, sino guardar-la i tirar
  //   la més baixa. Excepció: totes les cartes de la mesa són < 3 (str<70)
  //   i cap rival ha mostrat força → pot reservar el 7 d'oros i tirar el 3.
  if (playStrength === "low") {
    return { type: "play-card", cardId: lowest.id };
  }
  if (playStrength === "high") {
    // Si la baza ja està oberta i el meu equip va guanyant amb la carta
    // més alta, no cal cremar la millor; tira igualment alta perquè
    // l'humà ha demanat que jo me'n faça càrrec.
    return { type: "play-card", cardId: highest.id };
  }
  if (playStrength === "vine-a-vore") {
    // Cartes "compromeses": 7 d'oros (str=85) o qualsevol 3 (str=70).
    const committedCards = cards
      .filter((c) => (c.rank === 7 && c.suit === "oros") || c.rank === 3)
      .sort((a, b) => cardStrength(a) - cardStrength(b));
    if (committedCards.length > 0) {
      const tableBest = trick.cards.length > 0
        ? trick.cards.reduce((mx, tc) => Math.max(mx, cardStrength(tc.card)), -1)
        : -1;
      const tableBestPlayer = trick.cards.length > 0
        ? trick.cards.reduce(
            (best, tc) =>
              best === null || cardStrength(tc.card) > cardStrength(best.card)
                ? tc
                : best,
            null as { player: PlayerId; card: Card } | null,
          )
        : null;
      const partnerWinsTable =
        tableBestPlayer !== null && teamOf(tableBestPlayer.player) === teamOf(player);

      if (partnerWinsTable) {
        // El company ja guanya: no cal cremar res. Tira la més baixa.
        return { type: "play-card", cardId: lowest.id };
      }

      const winningCommitted = committedCards.find((c) => cardStrength(c) > tableBest);
      if (winningCommitted) {
        // Excepció: totes les cartes de la mesa són < 3 (str<70) i cap
        // rival ha mostrat força → si tinc el 7 d'oros, reserve'l i tire
        // el 3 si també guanya.
        const allWeak = trick.cards.every((tc) => cardStrength(tc.card) < 70);
        if (allWeak && !rivalShownStrength) {
          const three = committedCards.find(
            (c) => c.rank === 3 && cardStrength(c) > tableBest,
          );
          const has7Oros = committedCards.some((c) => c.rank === 7 && c.suit === "oros");
          if (three && has7Oros) {
            const matchAct = playActions.find((a) => a.cardId === three.id);
            if (matchAct) return matchAct;
          }
        }
        // Juga la carta compromesa més baixa que guanya la mesa.
        const matchAct = playActions.find((a) => a.cardId === winningCommitted.id);
        if (matchAct) return matchAct;
      }
      // Cap carta compromesa guanya la mesa: guarda-les per a una baza
      // posterior i tira la més baixa de les altres (o la més baixa
      // absoluta si totes són compromeses).
      const nonCommitted = cards
        .filter((c) => !((c.rank === 7 && c.suit === "oros") || c.rank === 3))
        .sort((a, b) => cardStrength(a) - cardStrength(b));
      const fallback = nonCommitted[0] ?? lowest;
      const matchAct = playActions.find((a) => a.cardId === fallback.id);
      if (matchAct) return matchAct;
    }
    // Sense cartes compromeses (cas anòmal): segueix amb la lògica normal.
  }
  if (playStrength === "vine-al-meu-tres" || playStrength === "tinc-un-tres") {
    // Compromís: el bot ha dit "Vine al meu tres" o "Tinc un 3" i té un 3.
    // Regles (mateixes per a les dues respostes):
    //   1) Si la mesa està buida (sóc primer): si el meu equip ha guanyat
    //      la 1a baza, tire un 3 per pressionar (assegure baza/parda).
    //      Si no, juga la lògica normal.
    //   2) Si la mesa té cartes:
    //      a) Si el meu company ja guanya, no cal cremar: més baixa.
    //      b) Si tinc un 3 que GUANYA la millor de la mesa → juga'l.
    //      c) Si el meu equip ha guanyat la 1a baza i el meu 3 EMPATA
    //         (str de la millor de la mesa = 70 = un altre 3) → juga el 3
    //         per assegurar la parda (que en aquesta 2a baza ens fa
    //         guanyar el truc).
    //      d) Si no pot guanyar ni empatar amb cap 3 → guarda els 3 i
    //         tira la més baixa no compromesa.
    const myThrees = cards
      .filter((c) => c.rank === 3)
      .sort((a, b) => cardStrength(a) - cardStrength(b));
    if (myThrees.length > 0) {
      const myTeam = teamOf(player);
      const firstTrick = r.tricks[0];
      const wonFirstTrick =
        !!firstTrick &&
        firstTrick.winner !== undefined &&
        firstTrick.parda !== true &&
        teamOf(firstTrick.winner!) === myTeam;

      if (trick.cards.length === 0) {
        // Sóc primer: tire un 3 si el meu equip ja va 1-0 (o si és la
        // primera baza, ja que el compromís ho exigeix com a posicionament).
        const pickThree = myThrees[0]!;
        const matchAct = playActions.find((a) => a.cardId === pickThree.id);
        if (matchAct) return matchAct;
      } else {
        const tableBest = trick.cards.reduce(
          (mx, tc) => Math.max(mx, cardStrength(tc.card)),
          -1,
        );
        const tableBestPlayer = trick.cards.reduce(
          (best, tc) =>
            best === null || cardStrength(tc.card) > cardStrength(best.card)
              ? tc
              : best,
          null as { player: PlayerId; card: Card } | null,
        );
        const partnerWinsTable =
          tableBestPlayer !== null && teamOf(tableBestPlayer.player) === teamOf(player);

        if (partnerWinsTable) {
          return { type: "play-card", cardId: lowest.id };
        }

        // Cap 3 té força > 70, per tant "winning" només si tableBest < 70.
        const winningThree = myThrees.find((c) => cardStrength(c) > tableBest);
        if (winningThree) {
          const matchAct = playActions.find((a) => a.cardId === winningThree.id);
          if (matchAct) return matchAct;
        }
        // Empat amb el 3 (algun rival també ha tirat un 3) i el meu equip
        // ja ha guanyat la 1a baza → empardar la baza ens dóna el truc.
        const tieingThree = myThrees.find((c) => cardStrength(c) === tableBest);
        if (tieingThree && wonFirstTrick) {
          const matchAct = playActions.find((a) => a.cardId === tieingThree.id);
          if (matchAct) return matchAct;
        }
        // Ni guanya ni empata útil: guarda el 3, tira la més baixa no-3.
        const nonThree = cards
          .filter((c) => c.rank !== 3)
          .sort((a, b) => cardStrength(a) - cardStrength(b));
        const fallback = nonThree[0] ?? lowest;
        const matchAct = playActions.find((a) => a.cardId === fallback.id);
        if (matchAct) return matchAct;
      }
    }
    // Sense 3 (cas anòmal): segueix lògica normal.
  }

  // ----- Regla mode sincer: compromís de "Vine a mi!" / "Algo tinc" -----
  // Si el jugador té una carta forta (str ≥ 80: manilla d'espases, manilla
  // d'oros, As bastos o As espases) i la baza ja està oberta:
  //   1) Si la carta forta GUANYA la millor de la mesa → juga-la.
  //      Excepció: totes les cartes de la mesa són < 3 (str < 70) i tinc
  //      una alternativa més feble (3 o manilla d'oros) que també guanyaria →
  //      reserve la carta forta per a una baza posterior.
  //   2) Si cap carta forta no guanya → guarda-les i tira la més baixa.
  // Aquesta regla té prioritat perquè honora el compromís implícit del
  // "Vine a mi!" o "Algo tinc" (manilla d'espases o manilla d'oros).
  if (trick.cards.length > 0) {
    const myTopCards = cards
      .filter((c) => cardStrength(c) >= 80)
      .sort((a, b) => cardStrength(a) - cardStrength(b));
    if (myTopCards.length > 0) {
      const tableBest = trick.cards.reduce(
        (mx, tc) => Math.max(mx, cardStrength(tc.card)),
        -1,
      );
      const tableBestPlayer = trick.cards.reduce(
        (best, tc) =>
          best === null || cardStrength(tc.card) > cardStrength(best.card)
            ? tc
            : best,
        null as { player: PlayerId; card: Card } | null,
      );
      const partnerWinsTable =
        tableBestPlayer !== null && teamOf(tableBestPlayer.player) === teamOf(player);

      if (!partnerWinsTable) {
        const winningTop = myTopCards.find((c) => cardStrength(c) > tableBest);
        if (winningTop) {
          // Reserve la carta forta NOMÉS si totes les cartes de la mesa
          // són < 3 (str < 70) I cap rival ha mostrat força (vine-a-mi /
          // tinc-bona) en aquesta ronda. Si algun rival ha senyalitzat
          // que té cartes fortes, juga la carta de força per assegurar
          // la baza —especialment crucial en la 1a baza.
          const allWeak = trick.cards.every((tc) => cardStrength(tc.card) < 70);
          if (allWeak && !rivalShownStrength) {
            const winningTopStr = cardStrength(winningTop);
            const reserve = cards
              .filter(
                (c) =>
                  cardStrength(c) < winningTopStr &&
                  cardStrength(c) > tableBest &&
                  (c.rank === 3 || (c.rank === 7 && c.suit === "oros")),
              )
              .sort((a, b) => cardStrength(a) - cardStrength(b))[0];
            if (reserve) {
              const matchAct = playActions.find((a) => a.cardId === reserve.id);
              if (matchAct) return matchAct;
            }
          }
          const matchAct = playActions.find((a) => a.cardId === winningTop.id);
          if (matchAct) return matchAct;
        } else {
          return { type: "play-card", cardId: lowest.id };
        }
      }
    }
  }


  // Si yo soy el primero de mi pareja en tirar (o abro la baza),
  // aplica el consejo del compañero:
  //  - strong → tira baja para reservar la alta
  //  - weak   → tira alta para intentar ganar
  //  - neutral → comportamiento original
  if (trick.cards.length === 0) {
    // Si la 1a baza ha quedat parda, la 2a baza decideix el truc:
    // sempre tira la carta més alta per intentar guanyar-la.
    if (r.tricks.length === 2 && r.tricks[0]!.parda) {
      return { type: "play-card", cardId: highest.id };
    }

    // ----- 2a baza: hem guanyat la 1a però el truc no està assegurat -----
    // Si el meu equip va guanyant 1-0 i no tinc el truc clarament guanyat
    // (sense els dos asos forts ni una carta dominant ja imbatible),
    // obrir amb un 3 per pressionar els rivals: si volen guanyar la baza
    // hauran de cremar les seues millors cartes (manilles fortes i asos),
    // assegurant-nos més probabilitats de tancar el truc en la 3a baza o per parda.
    if (r.tricks.length === 2 && !r.tricks[0]!.parda) {
      const myTeam = teamOf(player);
      const wonFirst =
        r.tricks[0]!.winner !== undefined && teamOf(r.tricks[0]!.winner!) === myTeam;
      if (wonFirst && partnerAdvice !== "weak") {
        const hasAsEspases = cards.some(c => c.rank === 1 && c.suit === "espases");
        const hasAsBastos = cards.some(c => c.rank === 1 && c.suit === "bastos");
        const trucWonAlready = hasAsEspases && hasAsBastos;
        // Considerem "carta dominant assegurada" si tenim una carta ≥85
        // (As bastos o manilla d'espases) i totes les cartes superiors a
        // ella ja s'han jugat en aquesta ronda. Cas senzill: tenir l'As
        // d'espases (sempre invencible) ja compta com a truc assegurat per
        // a aquesta baza si l'usem ara.
        const myHighScore = cardStrength(highest);
        const playedHigher = r.tricks.some(t =>
          t.cards.some(tc => cardStrength(tc.card) > myHighScore),
        );
        const dominantSecured = myHighScore >= 90 && playedHigher; // manilla d'espases / As bastos amb tot per damunt jugat
        const myThrees = cards.filter(c => c.rank === 3);
        if (!trucWonAlready && !dominantSecured && myThrees.length >= 1) {
          // Obre amb un 3 (si en té diversos, juga el de pal "fluix"
          // —oros/copes— per reservar el fort si en queden més).
          const ordered = [...myThrees].sort((a, b) => cardStrength(a) - cardStrength(b));
          const pick = ordered[0]!;
          const matchAct = playActions.find(a => a.cardId === pick.id);
          if (matchAct) return matchAct;
        }
      }
    }

    if (partnerAdvice === "strong") {
      return { type: "play-card", cardId: lowest.id };
    }
    if (partnerAdvice === "weak") {
      return { type: "play-card", cardId: highest.id };
    }
    if (r.tricks.length === 1) {
      // 1a baza: és crucial guanyar-la — si la guanyem i alguna de les
      // següents queda parda, guanyem el truc. Per defecte obrim amb la
      // carta més alta. Excepció: si tenim una carta dominant (≥80,
      // típicament manilla d'oros/espases o asos forts) i a més una altra
      // carta mig-alta (≥55), reservem la dominant i obrim amb la segona millor.
      const dominant = sorted[sorted.length - 1]!;
      const second = sorted[sorted.length - 2];
      const dominantScore = cardStrength(dominant);
      const secondScore = second ? cardStrength(second) : 0;
      if (dominantScore >= 80 && secondScore >= 55) {
        return { type: "play-card", cardId: second!.id };
      }
      return { type: "play-card", cardId: highest.id };
    }
    return { type: "play-card", cardId: highest.id };
  }

  let bestOnTable = -1;
  let bestPlayer: PlayerId | null = null;
  for (const tc of trick.cards) {
    const s = cardStrength(tc.card);
    if (s > bestOnTable) { bestOnTable = s; bestPlayer = tc.player; }
  }

  const partnerWinning = bestPlayer !== null && teamOf(bestPlayer) === teamOf(player);

  if (partnerWinning) {
    return { type: "play-card", cardId: lowest.id };
  }

  // ----- Regla específica: 2n de la parella en la 1a baza -----
  // Si soc el segon en jugar de la meua parella en la primera baza
  // (el company encara no ha jugat i la mesa té 1 carta, d'un rival),
  // he d'intentar guanyar la baza amb la carta de truc més alta possible
  // perquè guanyar la primera dóna avantatge davant un empat posterior.
  // Excepcions per no cremar la millor carta:
  //  a) Tinc As espases + As bastos → ja tinc el truc guanyat; tire baixa.
  //  b) Tinc As bastos + 7 espases i l'As espases ja s'ha jugat en aquesta
  //     ronda → l'As bastos és invencible; tire baixa.
  //  c) Tinc As espases i un 3, i la millor carta de la mesa és un 3 →
  //     podem empardar amb el 3 (reserve l'As espases).
  const partnerSeat = ((player + 2) % 4) as PlayerId;
  const partnerHasPlayedHere = trick.cards.some(tc => tc.player === partnerSeat);
  const isFirstTrick = r.tricks.length === 1;
  const iAmSecondOfPair = isFirstTrick && trick.cards.length === 1 && !partnerHasPlayedHere;
  if (iAmSecondOfPair && partnerAdvice !== "strong") {
    const hasAsEspases = hand.some(c => c.rank === 1 && c.suit === "espases");
    const hasAsBastos = hand.some(c => c.rank === 1 && c.suit === "bastos");
    const has7Espases = hand.some(c => c.rank === 7 && c.suit === "espases");
    const myThrees = cards.filter(c => c.rank === 3);
    // Comprova si l'As espases ja ha eixit en alguna baza d'aquesta ronda
    // (només pot ser en aquesta mateixa primera baza, però ho generalitzem).
    const asEspasesPlayed = r.tricks.some(t =>
      t.cards.some(tc => tc.card.rank === 1 && tc.card.suit === "espases"),
    );

    // (a) Truc ja guanyat amb tots dos asos forts.
    const trucWonAlready = hasAsEspases && hasAsBastos;
    // (b) As bastos invencible perquè l'As espases ja s'ha jugat.
    const asBastosInvincible = hasAsBastos && has7Espases && asEspasesPlayed;

    if (!trucWonAlready && !asBastosInvincible) {
      // (c) Empardar amb el 3 si el rival ha jugat un 3 i jo tinc As espases.
      const tableTopIsThree = trick.cards[0]!.card.rank === 3;
      if (tableTopIsThree && hasAsEspases && myThrees.length >= 1) {
        const myThree = myThrees[0]!;
        const matchAct = playActions.find(a => a.cardId === myThree.id);
        if (matchAct) return matchAct;
      }
      // Carta de truc més alta (≥70) que supere la del rival.
      const trucCards = sorted.filter(c => cardStrength(c) >= 70);
      const winningTrucCards = trucCards.filter(c => cardStrength(c) > bestOnTable);
      if (winningTrucCards.length > 0) {
        // Agafa la més alta per assegurar la baza.
        const pick = winningTrucCards[winningTrucCards.length - 1]!;
        const matchAct = playActions.find(a => a.cardId === pick.id);
        if (matchAct) return matchAct;
      }
      // Si la meua carta més alta no supera la del rival, no la malgaste:
      // tire la més baixa per reservar les bones per a bazas següents.
      if (cardStrength(highest) <= bestOnTable) {
        return { type: "play-card", cardId: lowest.id };
      }
    }
  }

  // Si voy en tercer lugar (mi compañero aún no jugó) y tengo consejo:
  const partner = ((player + 2) % 4) as PlayerId;
  const partnerPlayed = trick.cards.some(tc => tc.player === partner);
  if (!partnerPlayed) {
    if (partnerAdvice === "strong") {
      return { type: "play-card", cardId: lowest.id };
    }
    if (partnerAdvice === "weak") {
      const winners = sorted.filter(c => cardStrength(c) > bestOnTable);
      if (winners.length > 0) {
        return { type: "play-card", cardId: highest.id };
      }
    }
  }

  const winners = sorted.filter(c => cardStrength(c) > bestOnTable);
  if (winners.length > 0) {
    return { type: "play-card", cardId: winners[0]!.id };
  }
  return { type: "play-card", cardId: lowest.id };
}
