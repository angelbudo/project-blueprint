/**
 * Càlcul pur de l'estat visual dels cants ("carteles" de truc/envit, V/X
 * d'envit, família del cartell, parpadeig "pendent" mentre s'espera
 * resposta del rival, etc.) a partir d'un MatchState.
 *
 * Aquest mòdul és l'única font de veritat del que veu la UI per a aquests
 * carteles. Tant la partida local (offline) com la partida online han
 * d'utilitzar-lo perquè el tablero es vegi exactament igual.
 *
 * Recorre `match.round.log` i replica les mateixes transicions que abans
 * vivien dins del `setMatch(...)` de `useTrucMatch`. La idea: donat el
 * mateix `MatchState`, la sortida és sempre idèntica.
 */
import type { MatchState, PlayerId, ShoutKind } from "./types";

export interface ShoutDisplay {
  /** Cant actual del jugador (només família "truc" — "envit" viu a part). */
  lastShoutByPlayer: Record<PlayerId, ShoutKind | null>;
  /** Etiqueta sobreescrita ("Truc i passe!", etc.). */
  shoutLabelByPlayer: Record<PlayerId, string | null>;
  /** El cant del jugador ja ha estat acceptat (sense pulsació d'espera). */
  acceptedShoutByPlayer: Record<PlayerId, boolean>;
  /** Família del cant per posicionar el cartell (amunt = envit, avall = truc). */
  shoutFamilyByPlayer: Record<PlayerId, "envit" | "truc" | null>;
  /** Cartell persistent d'envit per al jugador que l'ha cantat. */
  envitShoutByPlayer: Record<PlayerId, ShoutKind | null>;
  /** Etiqueta sobreescrita per al cartell d'envit (rarament usada). */
  envitShoutLabelByPlayer: Record<PlayerId, string | null>;
  /** Resultat de l'envit per al cantador: pending / volgut / no-volgut. */
  envitOutcomeByPlayer: Record<PlayerId, { outcome: "pending" | "volgut" | "no-volgut" } | null>;
}

const ENVIT_QUESTION_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "envit", "renvit", "falta-envit",
]);
const TRUC_QUESTION_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "truc", "retruc", "quatre", "joc-fora",
]);
const QUESTION_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  ...ENVIT_QUESTION_SHOUTS, ...TRUC_QUESTION_SHOUTS,
]);
const RESPONSE_SHOUTS: ReadonlySet<ShoutKind> = new Set([
  "vull", "no-vull", "retruc", "quatre", "joc-fora", "renvit", "falta-envit",
]);

function emptyDisplay(): ShoutDisplay {
  return {
    lastShoutByPlayer: { 0: null, 1: null, 2: null, 3: null },
    shoutLabelByPlayer: { 0: null, 1: null, 2: null, 3: null },
    acceptedShoutByPlayer: { 0: false, 1: false, 2: false, 3: false },
    shoutFamilyByPlayer: { 0: null, 1: null, 2: null, 3: null },
    envitShoutByPlayer: { 0: null, 1: null, 2: null, 3: null },
    envitShoutLabelByPlayer: { 0: null, 1: null, 2: null, 3: null },
    envitOutcomeByPlayer: { 0: null, 1: null, 2: null, 3: null },
  };
}

/**
 * Calcula el "label override" per a un cant de truc en posició no-peu
 * (afegeix " i passe!"). Mateixa regla que `dispatch` al hook offline.
 */
function trucPasseLabel(
  what: "truc" | "retruc" | "quatre" | "joc-fora",
): string {
  const base: Record<string, string> = {
    truc: "Truc",
    retruc: "Retruc",
    quatre: "Quatre val",
    "joc-fora": "Joc fora",
  };
  return `${base[what]} i passe!`;
}

/**
 * Reconstrueix l'estat visual recorrent el log d'esdeveniments del round
 * actual. Manté els mateixos invariants que el `dispatch` del client
 * offline (vegeu `useTrucMatch.ts`).
 */
export function computeShoutDisplay(match: MatchState): ShoutDisplay {
  const out = emptyDisplay();
  const r = match.round;

  // Estat acumulat necessari per decidir "Truc i passe!" i la família
  // heretada per `vull`/`no-vull`.
  let envitResolved = false;
  let envitInPlay = false;     // hi ha algun envit en curs (pending o accepted/rejected ja registrat)
  let tricksPlayed = 0;        // bazas tancades dins del round
  let trickHasPlays = false;   // alguna carta jugada en la baza actual
  const mano = r.mano;

  for (const ev of r.log) {
    if (ev.type === "play") {
      trickHasPlays = true;
      continue;
    }
    if (ev.type === "trick-end") {
      tricksPlayed += 1;
      trickHasPlays = false;
      // Quan acaba la baza, els carteles de truc s'esborren (mateixa
      // regla que la derivació original a OnlinePartida).
      out.lastShoutByPlayer = { 0: null, 1: null, 2: null, 3: null };
      out.shoutLabelByPlayer = { 0: null, 1: null, 2: null, 3: null };
      // L'estat "acceptat" del truc es manté per al cantador? No: en la
      // versió original es netejava també; mantenim aquest comportament.
      out.acceptedShoutByPlayer = { 0: false, 1: false, 2: false, 3: false };
      // Family del truc s'ha de netejar perquè ja no hi ha cartell.
      for (const pid of [0, 1, 2, 3] as PlayerId[]) {
        if (out.shoutFamilyByPlayer[pid] === "truc") {
          out.shoutFamilyByPlayer[pid] = null;
        }
      }
      continue;
    }
    if (ev.type !== "shout") continue;

    const player = ev.player;
    const what = ev.what;

    // ---- ENVIT family ----
    if (ENVIT_QUESTION_SHOUTS.has(what)) {
      envitInPlay = true;
      // Renvit / falta-envit: qualsevol envit pendent passa a "volgut".
      if (what === "renvit" || what === "falta-envit") {
        for (const pid of [0, 1, 2, 3] as PlayerId[]) {
          if (out.envitOutcomeByPlayer[pid]?.outcome === "pending") {
            out.envitOutcomeByPlayer[pid] = { outcome: "volgut" };
          }
        }
      }
      out.envitOutcomeByPlayer[player] = { outcome: "pending" };
      out.envitShoutByPlayer[player] = what;
      out.envitShoutLabelByPlayer[player] = null;
      out.shoutFamilyByPlayer[player] = "envit";
      // Una nova "pregunta" reseteja l'estat acceptat.
      out.acceptedShoutByPlayer = { 0: false, 1: false, 2: false, 3: false };
      continue;
    }

    // ---- TRUC family (call) ----
    if (TRUC_QUESTION_SHOUTS.has(what)) {
      // "Truc i passe!" si és al primer trick, sense envit resolt ni en joc,
      // i el cantador NO és el peu del seu equip.
      let labelOverride: string | null = null;
      const isFirstTrick = tricksPlayed === 0 && !trickHasPlays;
      if (isFirstTrick && !envitResolved && !envitInPlay) {
        const peuManoTeam = ((mano + 2) % 4) as PlayerId;
        const peuOtherTeam = ((mano + 3) % 4) as PlayerId;
        const callerIsPeu = player === peuManoTeam || player === peuOtherTeam;
        if (!callerIsPeu) {
          labelOverride = trucPasseLabel(what as "truc" | "retruc" | "quatre" | "joc-fora");
        }
      }
      out.lastShoutByPlayer[player] = what;
      out.shoutLabelByPlayer[player] = labelOverride;
      out.shoutFamilyByPlayer[player] = "truc";
      out.acceptedShoutByPlayer = { 0: false, 1: false, 2: false, 3: false };
      continue;
    }

    // ---- Responses (vull / no-vull) ----
    if (what === "vull" || what === "no-vull") {
      // Determina si la resposta és a un envit pendent o a un truc pendent.
      const isEnvitResponse = (() => {
        for (const pid of [0, 1, 2, 3] as PlayerId[]) {
          if (out.envitOutcomeByPlayer[pid]?.outcome === "pending") return true;
        }
        return false;
      })();

      if (isEnvitResponse) {
        // Resposta a un envit. Pot ser que encara quedi un membre de l'equip
        // per respondre — el log conté la seqüència completa, així que ací
        // només marquem outcome quan ja podem decidir. Fem-ho mirant si en
        // el log següent hi ha una altra resposta del mateix equip; per
        // simplicitat i fidelitat, marquem sempre i deixem que un "no-vull"
        // posterior del partner sobreescrigui. Però la regla original
        // espera a la resolució real (envitState) — per replicar-la sense
        // re-executar el motor, fem servir el `match.round.envitState`
        // final només quan `tricksPlayed === current` (és l'última paraula).
        // En la pràctica, "vull" o "no-vull" determinen l'outcome a partir
        // del kind final de l'envitState — vegeu el bloc post-loop.
        // Família del cartell hereta envit.
        out.shoutFamilyByPlayer[player] = "envit";
        envitResolved = true;
        envitInPlay = false;
        continue;
      }

      // Resposta a un truc.
      if (what === "vull") {
        // Marca el cantador del truc com a acceptat (manté el cartell).
        for (const pid of [0, 1, 2, 3] as PlayerId[]) {
          const cur = out.lastShoutByPlayer[pid];
          if (cur && TRUC_QUESTION_SHOUTS.has(cur)) {
            out.acceptedShoutByPlayer[pid] = true;
          }
        }
      } else {
        // No-vull: esborra els cartells de truc pendent.
        for (const pid of [0, 1, 2, 3] as PlayerId[]) {
          const cur = out.lastShoutByPlayer[pid];
          if (cur && TRUC_QUESTION_SHOUTS.has(cur)) {
            out.lastShoutByPlayer[pid] = null;
            out.shoutLabelByPlayer[pid] = null;
            out.shoutFamilyByPlayer[pid] = null;
          }
        }
      }
      out.lastShoutByPlayer[player] = what;
      out.shoutFamilyByPlayer[player] = "truc";
      continue;
    }

    // Altres (passe, so-meues): no afecten els carteles.
    void RESPONSE_SHOUTS;
  }

  // Resol l'outcome final dels envits a partir del kind final de l'envitState.
  // Així replicem la regla original: només marquem volgut/no-volgut quan
  // l'envit ha quedat realment resolt al motor.
  const envSt = r.envitState;
  if (envSt.kind === "accepted" || envSt.kind === "rejected") {
    const result: "volgut" | "no-volgut" = envSt.kind === "accepted" ? "volgut" : "no-volgut";
    for (const pid of [0, 1, 2, 3] as PlayerId[]) {
      if (out.envitOutcomeByPlayer[pid]?.outcome === "pending") {
        out.envitOutcomeByPlayer[pid] = { outcome: result };
      }
    }
  }

  return out;
}