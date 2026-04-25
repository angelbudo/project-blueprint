import { buildDeck, cardStrength, bestEnvit } from "./deck";
import {
  Action, Card, MatchState, PlayerId, RoundState,
  RoundSummary, ShoutKind, TeamId, TrucState,
  nextPlayer, partnerOf, teamOf,
} from "./types";

function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createMatch(
  opts: { targetCama?: number; targetCames?: number; firstDealer?: PlayerId; rng?: () => number } = {}
): MatchState {
  const targetCama = opts.targetCama ?? 12;
  const targetCames = opts.targetCames ?? 2;
  const dealer = (opts.firstDealer ?? 3) as PlayerId;
  const round = dealRound(dealer, opts.rng);
  return {
    scores: { nos: { males: 0, bones: 0 }, ells: { males: 0, bones: 0 } },
    camesWon: { nos: 0, ells: 0 },
    cames: 0,
    targetCama,
    targetCames,
    round,
    dealer,
    history: [],
  };
}

/** Total de punts dins la cama actual per a un equip (capat a 24). */
export function teamCamaTotal(s: { males: number; bones: number }): number {
  return Math.min(s.males + s.bones, 24);
}

/** Suma punts a un equip propagant males → bones, i retorna si ha guanyat la cama. */
function addPointsToTeam(
  scores: Record<TeamId, { males: number; bones: number }>,
  team: TeamId,
  points: number,
  targetCama: number,
): boolean {
  if (points <= 0) return false;
  const s = scores[team];
  let remaining = points;
  if (s.males < targetCama) {
    const room = targetCama - s.males;
    const add = Math.min(room, remaining);
    s.males += add;
    remaining -= add;
  }
  if (remaining > 0) {
    s.bones = Math.min(targetCama, s.bones + remaining);
  }
  return s.bones >= targetCama;
}

export function dealRound(dealer: PlayerId, rng?: () => number): RoundState {
  const deck = shuffle(buildDeck(), rng);
  const hands: Record<PlayerId, Card[]> = { 0: [], 1: [], 2: [], 3: [] };
  const mano = nextPlayer(dealer);
  let p = mano;
  for (let i = 0; i < 12; i++) {
    hands[p].push(deck[i]!);
    p = nextPlayer(p);
  }
  return {
    hands,
    mano,
    turn: mano,
    tricks: [{ cards: [] }],
    trucState: { kind: "none", level: 0 },
    envitState: { kind: "none" },
    envitResolved: false,
    phase: "envit",
    log: [{ type: "deal", dealer }],
  };
}

export function legalActions(m: MatchState, player: PlayerId): Action[] {
  const r = m.round;
  if (r.phase === "game-end" || r.phase === "round-end") return [];

  if (
    r.trucState.kind === "pending" &&
    teamOf(player) === r.trucState.awaitingTeam &&
    !(r.trucState.rejectedBy ?? []).includes(player)
  ) {
    const acts = responseActions(r.trucState.level, "truc");
    const firstTrick = r.tricks[0]!;
    if (
      !r.envitResolved &&
      r.tricks.length === 1 &&
      firstTrick.cards.length < 3 &&
      r.envitState.kind === "none"
    ) {
      acts.push({ type: "shout", what: "envit" });
      acts.push({ type: "shout", what: "falta-envit" });
    }
    return acts;
  }

  if (
    r.envitState.kind === "pending" &&
    teamOf(player) === r.envitState.awaitingTeam &&
    !(r.envitState.rejectedBy ?? []).includes(player)
  ) {
    return responseActions(r.envitState.level, "envit");
  }

  if (r.turn !== player) {
    return [];
  }

  const actions: Action[] = [];

  const noPending = r.trucState.kind !== "pending" && r.envitState.kind !== "pending";
  if (noPending && (r.phase === "playing" || r.phase === "envit")) {
    for (const c of r.hands[player]) actions.push({ type: "play-card", cardId: c.id });
  }

  if (noPending) {
    const t = r.trucState;
    if (t.kind === "none") {
      actions.push({ type: "shout", what: "truc" });
    } else if (t.kind === "accepted") {
      let lastCaller: PlayerId | null = null;
      for (let i = r.log.length - 1; i >= 0; i--) {
        const ev = r.log[i]!;
        if (ev.type === "shout" && (ev.what === "truc" || ev.what === "retruc" || ev.what === "quatre")) {
          lastCaller = ev.player;
          break;
        }
      }
      if (lastCaller !== null && teamOf(player) !== teamOf(lastCaller)) {
        if (t.level === 2) actions.push({ type: "shout", what: "retruc" });
        else if (t.level === 3) actions.push({ type: "shout", what: "quatre" });
        else if (t.level === 4) actions.push({ type: "shout", what: "joc-fora" });
      }
    }
  }

  const firstTrick = r.tricks[0]!;
  const peuNos: PlayerId = teamOf(r.mano) === "nos" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
  const peuElls: PlayerId = teamOf(r.mano) === "ells" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
  const isPeu = player === peuNos || player === peuElls;
  const peuHasPlayed = firstTrick.cards.some(tc => tc.player === player);
  // Prohibit envit després de "voler" el truc (truc acceptat).
  const trucAccepted = r.trucState.kind === "accepted";
  const envitAllowed =
    !r.envitResolved &&
    !trucAccepted &&
    r.tricks.length === 1 &&
    !peuHasPlayed &&
    noPending &&
    isPeu;
  if (envitAllowed) {
    if (r.envitState.kind === "none") {
      actions.push({ type: "shout", what: "envit" });
      actions.push({ type: "shout", what: "falta-envit" });
    }
  }

  return actions;
}

function responseActions(level: TrucState["kind"] extends infer _ ? any : never, kind: "truc" | "envit"): Action[] {
  const acts: Action[] = [
    { type: "shout", what: "vull" },
    { type: "shout", what: "no-vull" },
  ];
  if (kind === "truc") {
    if (level === 2) acts.push({ type: "shout", what: "retruc" });
    if (level === 3) acts.push({ type: "shout", what: "quatre" });
    if (level === 4) acts.push({ type: "shout", what: "joc-fora" });
  } else {
    if (level === 2) {
      acts.push({ type: "shout", what: "renvit" });
      acts.push({ type: "shout", what: "falta-envit" });
    }
    if (level === 4) acts.push({ type: "shout", what: "falta-envit" });
  }
  return acts;
}

export function applyAction(m: MatchState, player: PlayerId, action: Action): MatchState {
  const next: MatchState = {
    ...m,
    scores: { ...m.scores },
    round: {
      ...m.round,
      hands: { ...m.round.hands },
      tricks: m.round.tricks.map(t => ({ ...t, cards: [...t.cards] })),
      log: [...m.round.log],
    },
  };

  if (action.type === "play-card") {
    return doPlayCard(next, player, action.cardId);
  }
  return doShout(next, player, action.what);
}

function doPlayCard(m: MatchState, player: PlayerId, cardId: string): MatchState {
  const r = m.round;
  if (r.turn !== player) return m;
  const hand = r.hands[player];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx === -1) return m;
  const card = hand[idx]!;
  r.hands[player] = [...hand.slice(0, idx), ...hand.slice(idx + 1)];

  const trick = r.tricks[r.tricks.length - 1]!;
  trick.cards.push({ player, card });
  r.log.push({ type: "play", player, card });

  if (r.tricks.length === 1 && !r.envitResolved && r.envitState.kind === "none") {
    const peuNos: PlayerId = teamOf(r.mano) === "nos" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
    const peuElls: PlayerId = teamOf(r.mano) === "ells" ? partnerOf(r.mano) : partnerOf(nextPlayer(r.mano));
    const peusPlayed = trick.cards.some(tc => tc.player === peuNos) && trick.cards.some(tc => tc.player === peuElls);
    if (peusPlayed) {
      r.envitResolved = true;
      r.envitState = { kind: "rejected", points: 0, wonBy: "nos" };
    }
  }

  if (r.phase === "envit") r.phase = "playing";

  if (trick.cards.length === 4) {
    resolveTrick(m);
  } else {
    r.turn = nextPlayer(player);
  }

  if (r.tricks.length >= 1) maybeFinishRound(m);
  return m;
}

function resolveTrick(m: MatchState) {
  const r = m.round;
  const trick = r.tricks[r.tricks.length - 1]!;
  let bestStrength = -1;
  let bestPlayers: PlayerId[] = [];
  for (const tc of trick.cards) {
    const s = cardStrength(tc.card);
    if (s > bestStrength) { bestStrength = s; bestPlayers = [tc.player]; }
    else if (s === bestStrength) bestPlayers.push(tc.player);
  }
  if (bestPlayers.length > 1) {
    const teams = new Set(bestPlayers.map(teamOf));
    if (teams.size === 1) {
      const first = trick.cards.find(tc => bestPlayers.includes(tc.player))!;
      trick.winner = first.player;
      r.log.push({ type: "trick-end", winner: first.player, parda: false });
    } else {
      trick.parda = true;
      r.log.push({ type: "trick-end", parda: true });
    }
  } else {
    trick.winner = bestPlayers[0]!;
    r.log.push({ type: "trick-end", winner: bestPlayers[0]!, parda: false });
  }

  // Leader of the next trick:
  // - If this trick has a winner, that player leads.
  // - If this trick is parda, the leader is the winner of the most recent
  //   non-parda completed trick. If none exists (e.g. the very first trick
  //   was parda), the mano leads.
  let nextStarter: PlayerId = trick.winner ?? r.mano;
  if (!trick.winner) {
    for (let i = r.tricks.length - 2; i >= 0; i--) {
      const t = r.tricks[i]!;
      if (t.cards.length === 4 && !t.parda && t.winner !== undefined) {
        nextStarter = t.winner;
        break;
      }
    }
  }
  if (r.tricks.length < 3 && r.hands[0].length + r.hands[1].length + r.hands[2].length + r.hands[3].length > 0) {
    const played = r.tricks.filter(t => t.cards.length === 4);
    const pardaAt = played.map(t => !!t.parda);
    const winsNos = played.filter(t => !t.parda && t.winner !== undefined && teamOf(t.winner!) === "nos").length;
    const winsElls = played.filter(t => !t.parda && t.winner !== undefined && teamOf(t.winner!) === "ells").length;
    let decided = false;
    if (winsNos >= 2 || winsElls >= 2) decided = true;
    if (played.length === 2 && pardaAt[0] !== pardaAt[1]) decided = true;
    if (!decided) {
      r.tricks.push({ cards: [] });
      r.turn = nextStarter;
    }
  }
}

function maybeFinishRound(m: MatchState) {
  const r = m.round;
  // Defensa: si la ronda ja s'ha tancat, no recalculem ni resumarrem (evita
  // duplicar punts al marcador i múltiples entrades a `history`).
  if (r.phase === "round-end" || r.phase === "game-end") return;
  if (r.log.some((ev) => ev.type === "round-end" || ev.type === "game-end")) return;
  const playedTricks = r.tricks.filter(t => t.cards.length === 4);
  if (playedTricks.length === 0) return;

  const wins: Record<TeamId, number> = { nos: 0, ells: 0 };
  const pardaAt: boolean[] = [];
  for (const t of playedTricks) {
    pardaAt.push(!!t.parda);
    if (!t.parda && t.winner !== undefined) wins[teamOf(t.winner)]++;
  }

  let trucWinner: TeamId | undefined;

  // Regla 1: si guanyes 2 mans, guanyes el truc.
  if (wins.nos >= 2 && wins.nos > wins.ells) trucWinner = "nos";
  else if (wins.ells >= 2 && wins.ells > wins.nos) trucWinner = "ells";

  // Regla 2: si la 1a baza és parda, la guanya qui guanye la 2a baza.
  if (!trucWinner && playedTricks.length >= 2 && pardaAt[0] && !pardaAt[1]) {
    const w = playedTricks[1]!.winner;
    if (w !== undefined) trucWinner = teamOf(w);
  }

  // Regla 3: si la 2a baza queda parda (i la 1a no), guanya qui va guanyar la 1a.
  if (!trucWinner && playedTricks.length >= 2 && !pardaAt[0] && pardaAt[1]) {
    const w = playedTricks[0]!.winner;
    if (w !== undefined) trucWinner = teamOf(w);
  }

  // Regla 4: 1a i 2a pardes → es juga la 3a; guanya qui la guanye.
  // Si la 3a també queda parda (totes 3 pardes), guanya l'equip de la mà.
  if (!trucWinner && playedTricks.length === 3) {
    if (pardaAt[0] && pardaAt[1]) {
      if (!pardaAt[2] && playedTricks[2]!.winner !== undefined) {
        trucWinner = teamOf(playedTricks[2]!.winner!);
      } else {
        trucWinner = teamOf(r.mano);
      }
    } else if (wins.nos > wins.ells) trucWinner = "nos";
    else if (wins.ells > wins.nos) trucWinner = "ells";
    else trucWinner = teamOf(r.mano);
  }

  if (trucWinner) finishRound(m, trucWinner);
}

function finishRound(m: MatchState, trucWinner: TeamId) {
  const r = m.round;
  // Defensa: no tanquem dues vegades la mateixa ronda (evita duplicar punts).
  if (r.phase === "round-end" || r.phase === "game-end") return;
  if (r.log.some((ev) => ev.type === "round-end" || ev.type === "game-end")) return;

  // Esbrina el màxim nivell d'envit cantat aquesta ronda (per al cartell del marcador).
  let envitLevel: 2 | 4 | "falta" | undefined;
  for (const ev of r.log) {
    if (ev.type === "shout") {
      if (ev.what === "envit" && envitLevel === undefined) envitLevel = 2;
      else if (ev.what === "renvit") envitLevel = 4;
      else if (ev.what === "falta-envit") envitLevel = "falta";
    }
  }
  // Màxim nivell de truc cantat (2/3/4/24).
  let trucLevelCalled: 0 | 2 | 3 | 4 | 24 = 0;
  for (const ev of r.log) {
    if (ev.type === "shout") {
      if (ev.what === "truc" && trucLevelCalled < 2) trucLevelCalled = 2;
      else if (ev.what === "retruc") trucLevelCalled = 3;
      else if (ev.what === "quatre") trucLevelCalled = 4;
      else if (ev.what === "joc-fora") trucLevelCalled = 24;
    }
  }

  let trucPoints = 1;
  let jocFora = false;
  let trucRejected = false;
  if (r.trucState.kind === "accepted") {
    if (r.trucState.level === 24) {
      // "Joc fora" acceptat: tanca tota la partida.
      jocFora = true;
      trucPoints = 0; // no s'utilitza per a punts; va directe a la victòria
    } else {
      trucPoints = r.trucState.level;
    }
  } else if (r.trucState.kind === "rejected") {
    trucPoints = r.trucState.pointsAwarded;
    trucWinner = r.trucState.wonBy;
    trucRejected = true;
  }

  let envitWinner: TeamId | undefined;
  let envitPoints = 0;
  let envitRejected = false;
  if (r.envitState.kind === "accepted") {
    envitPoints = r.envitState.points;
    envitWinner = computeEnvitWinner(r);
  } else if (r.envitState.kind === "rejected") {
    envitPoints = r.envitState.points;
    envitWinner = r.envitState.wonBy;
    // points === 0 vol dir que ningú no ha cantat envit (cas implícit); no és "no querit".
    envitRejected = envitPoints > 0;
  }

  const summary: RoundSummary = {
    trucPoints,
    envitPoints,
    trucWinner,
    envitWinner,
    envitLevel,
    envitRejected,
    trucLevel: trucLevelCalled,
    trucRejected,
  };
  r.log.push({ type: "round-end", summary });
  m.history.push(summary);
  r.phase = "round-end";

  // Resolució de "joc fora": guanya tota la partida.
  if (jocFora) {
    m.jocForaWinner = trucWinner;
    r.phase = "game-end";
    r.log.push({ type: "game-end", winner: trucWinner });
    return;
  }

  // Aplica envit primer (si s'ha cantat) i comprova cama; després truc.
  // L'envit es resol abans del truc en l'ordre tradicional.
  const apply = (team: TeamId, pts: number): boolean => {
    if (pts <= 0) return false;
    return addPointsToTeam(m.scores, team, pts, m.targetCama);
  };

  let camaClosedBy: TeamId | undefined;
  if (envitWinner && envitPoints > 0) {
    if (apply(envitWinner, envitPoints)) camaClosedBy = envitWinner;
  }
  if (!camaClosedBy && trucPoints > 0) {
    if (apply(trucWinner, trucPoints)) camaClosedBy = trucWinner;
  } else if (camaClosedBy && trucPoints > 0 && trucWinner !== camaClosedBy) {
    // Si l'envit ja ha tancat cama, el truc d'aquesta ronda no compta
    // (la cama ja està decidida). Si fos el mateix equip, tampoc cal
    // continuar acumulant en aquesta cama tancada.
  }

  if (camaClosedBy) {
    m.camesWon[camaClosedBy] += 1;
    m.cames = m.camesWon.nos + m.camesWon.ells;
    if (m.camesWon[camaClosedBy] >= m.targetCames) {
      r.phase = "game-end";
      r.log.push({ type: "game-end", winner: camaClosedBy });
    } else {
      // Nova cama: tots dos equips comencen de zero (males/bones independents).
      m.scores.nos = { males: 0, bones: 0 };
      m.scores.ells = { males: 0, bones: 0 };
    }
  }
}

function computeEnvitWinner(r: RoundState): TeamId | undefined {
  const envits: Record<PlayerId, number> = {
    0: bestEnvit(r.hands[0]),
    1: bestEnvit(r.hands[1]),
    2: bestEnvit(r.hands[2]),
    3: bestEnvit(r.hands[3]),
  };
  const nosBest = Math.max(envits[0], envits[2]);
  const ellsBest = Math.max(envits[1], envits[3]);
  if (nosBest > ellsBest) return "nos";
  if (ellsBest > nosBest) return "ells";
  // Empat: guanya l'equip del primer jugador (en ordre de joc des del mà) que
  // tinga el millor envit. Equival al primer dels empatats que ha tirat (o
  // tiraria) en la primera basa.
  const best = nosBest;
  let p: PlayerId = r.mano;
  for (let i = 0; i < 4; i++) {
    if (envits[p] === best) return teamOf(p);
    p = nextPlayer(p);
  }
  return teamOf(r.mano);
}

function doShout(m: MatchState, player: PlayerId, what: ShoutKind): MatchState {
  const r = m.round;
  r.log.push({ type: "shout", player, what });

  switch (what) {
    case "truc":
    case "retruc":
    case "quatre":
    case "joc-fora": {
      const levelMap: Record<string, 2 | 3 | 4 | 24> = { truc: 2, retruc: 3, quatre: 4, "joc-fora": 24 };
      const level = levelMap[what]!;
      r.trucState = { kind: "pending", level, calledBy: player, awaitingTeam: teamOf(player) === "nos" ? "ells" : "nos" };
      r.turn = nextRespondent(player);
      break;
    }
    case "envit": {
      if (r.trucState.kind === "pending") {
        r.deferredTruc = {
          level: r.trucState.level,
          calledBy: r.trucState.calledBy,
          awaitingTeam: r.trucState.awaitingTeam,
        };
        r.trucState = { kind: "none", level: 0 };
      }
      r.envitState = { kind: "pending", level: 2, calledBy: player, awaitingTeam: teamOf(player) === "nos" ? "ells" : "nos", prevAcceptedLevel: 0 };
      r.turn = nextRespondent(player);
      break;
    }
    case "renvit": {
      const prevLvl = r.envitState.kind === "pending" && typeof r.envitState.level === "number" ? r.envitState.level : 2;
      r.envitState = { kind: "pending", level: 4, calledBy: player, awaitingTeam: teamOf(player) === "nos" ? "ells" : "nos", prevAcceptedLevel: prevLvl };
      r.turn = nextRespondent(player);
      break;
    }
    case "falta-envit": {
      if (r.trucState.kind === "pending") {
        r.deferredTruc = {
          level: r.trucState.level,
          calledBy: r.trucState.calledBy,
          awaitingTeam: r.trucState.awaitingTeam,
        };
        r.trucState = { kind: "none", level: 0 };
      }
      // Punts si el rival no vol la falta-envit:
      // - falta directa (sense envit previ acceptat encara): 1 punt
      // - falta després de envit (2): 2 punts
      // - falta després de renvit (4): 4 punts
      const prevLvl: 0 | 2 | 4 =
        r.envitState.kind === "pending" && typeof r.envitState.level === "number"
          ? (r.envitState.level as 2 | 4)
          : 0;
      r.envitState = { kind: "pending", level: "falta", calledBy: player, awaitingTeam: teamOf(player) === "nos" ? "ells" : "nos", prevAcceptedLevel: prevLvl };
      r.turn = nextRespondent(player);
      break;
    }
    case "vull": {
      if (r.envitState.kind === "pending") {
        const level = r.envitState.level;
        // Càlcul de punts si s'accepta:
        // - envit (2) o renvit (4): valor literal
        // - falta-envit:
        //     · si tots dos equips estan en males → guanyar la falta = guanyar la cama
        //       (assignem prou punts perquè el guanyador tanqui la cama amb seguretat)
        //     · si algun equip ja està en bones → punts = el que li falta al líder
        //       (el que té més bones) per arribar a 12 bones
        let points: number;
        if (level === "falta") {
          const nosBones = m.scores.nos.bones;
          const ellsBones = m.scores.ells.bones;
          const anyInBones = nosBones > 0 || ellsBones > 0;
          if (anyInBones) {
            const leaderBones = Math.max(nosBones, ellsBones);
            points = Math.max(1, m.targetCama - leaderBones);
          } else {
            // Ambdós en males → assegurem tancar la cama amb el guanyador.
            // 24 punts són suficients per omplir males (12) i bones (12).
            points = m.targetCama * 2;
          }
        } else {
          points = level;
        }
        r.envitState = { kind: "accepted", points };
        r.envitResolved = true;
        if (r.deferredTruc) {
          r.trucState = {
            kind: "pending",
            level: r.deferredTruc.level,
            calledBy: r.deferredTruc.calledBy,
            awaitingTeam: r.deferredTruc.awaitingTeam,
          };
          r.turn = nextRespondent(r.deferredTruc.calledBy);
          r.deferredTruc = undefined;
        } else {
          r.turn = whoseTurnAfterCall(r);
        }
      } else if (r.trucState.kind === "pending") {
        r.trucState = { kind: "accepted", level: r.trucState.level };
        r.turn = whoseTurnAfterCall(r);
      }
      break;
    }
    case "no-vull": {
      if (r.envitState.kind === "pending") {
        const envit = r.envitState;
        const rejectedBy = [...(envit.rejectedBy ?? []), player];
        const teammates: PlayerId[] = ([0, 1, 2, 3] as PlayerId[]).filter(
          (p) => teamOf(p) === envit.awaitingTeam
        );
        const allRejected = teammates.every((p) => rejectedBy.includes(p));
        if (!allRejected) {
          r.envitState = { ...envit, rejectedBy };
          const pending = teammates.find((p) => !rejectedBy.includes(p))!;
          r.turn = pending;
          break;
        }
        // Punts atorgats si el rival no vol:
        // - envit (2) → 1 punt
        // - renvit (4) → 2 punts (el que ja estava acceptat com a envit)
        // - falta-envit → depèn del nivell previ acceptat:
        //     · directa (prev = 0) → 1 punt
        //     · després d'envit (prev = 2) → 2 punts
        //     · després de renvit (prev = 4) → 4 punts
        let prev: number;
        if (envit.level === 2) prev = 1;
        else if (envit.level === 4) prev = 2;
        else {
          const pa = (envit as { prevAcceptedLevel?: 0 | 2 | 4 }).prevAcceptedLevel ?? 0;
          prev = pa === 0 ? 1 : pa === 2 ? 2 : 4;
        }
        r.envitState = { kind: "rejected", points: prev, wonBy: teamOf(envit.calledBy) };
        r.envitResolved = true;
        if (r.deferredTruc) {
          r.trucState = {
            kind: "pending",
            level: r.deferredTruc.level,
            calledBy: r.deferredTruc.calledBy,
            awaitingTeam: r.deferredTruc.awaitingTeam,
          };
          r.turn = nextRespondent(r.deferredTruc.calledBy);
          r.deferredTruc = undefined;
        } else {
          r.turn = whoseTurnAfterCall(r);
        }
      } else if (r.trucState.kind === "pending") {
        const truc = r.trucState;
        const rejectedBy = [...(truc.rejectedBy ?? []), player];
        const teammates: PlayerId[] = ([0, 1, 2, 3] as PlayerId[]).filter(
          (p) => teamOf(p) === truc.awaitingTeam
        );
        const allRejected = teammates.every((p) => rejectedBy.includes(p));
        if (!allRejected) {
          r.trucState = { ...truc, rejectedBy };
          const pending = teammates.find((p) => !rejectedBy.includes(p))!;
          r.turn = pending;
          break;
        }
        const callerTeam = teamOf(truc.calledBy);
        const prevPts = truc.level === 2 ? 1 : truc.level === 3 ? 2 : truc.level === 4 ? 3 : 4;
        r.trucState = { kind: "rejected", pointsAwarded: prevPts, wonBy: callerTeam };
        finishRound(m, callerTeam);
      }
      break;
    }
    case "passe":
    case "so-meues": {
      break;
    }
  }
  return m;
}

function nextRespondent(caller: PlayerId): PlayerId {
  let p = nextPlayer(caller);
  while (teamOf(p) === teamOf(caller)) p = nextPlayer(p);
  return p;
}

function whoseTurnAfterCall(r: RoundState): PlayerId {
  const trick = r.tricks[r.tricks.length - 1]!;
  if (trick.cards.length === 0) {
    // Current trick hasn't started yet: the leader is the winner of the
    // previous completed trick. If there is no previous trick, or the
    // previous trick was parda, the leader is the mano.
    const prev = r.tricks[r.tricks.length - 2];
    if (prev && prev.winner !== undefined && !prev.parda) return prev.winner;
    return r.mano;
  }
  const last = trick.cards[trick.cards.length - 1]!;
  return nextPlayer(last.player);
}

export function startNextRound(m: MatchState): MatchState {
  if (m.round.phase === "game-end") return m;
  const newDealer = nextPlayer(m.dealer);
  return {
    ...m,
    dealer: newDealer,
    round: dealRound(newDealer),
  };
}

export { bestEnvit, cardStrength };
