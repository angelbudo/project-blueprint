// Edge function that exposes all room-related RPCs.
// Body: { fn: "createRoom" | "joinRoom" | ..., data: {...} }
// Service role key bypasses RLS for trusted server operations.
// Public access (no auth) — identity is the client-generated device_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  applyAction,
  createMatch,
  legalActions,
  startNextRound,
} from "./_shared/engine.ts";
import { botDecide, type BotHints } from "./_shared/bot.ts";
import { partnerOf, teamOf } from "./_shared/types.ts";
import type { Action, MatchState, PlayerId } from "./_shared/types.ts";
import { tuningFromProfile, NEUTRAL_TUNING, applyDifficulty, type BotTuning, type PlayerProfile } from "./_shared/profileAdaptation.ts";

type SeatKind = "human" | "bot" | "empty";

interface RoomFullDTO {
  room: {
    id: string;
    code: string;
    status: "lobby" | "playing" | "finished" | "abandoned";
    targetCames: number;
    initialMano: PlayerId;
    seatKinds: SeatKind[];
    hostDevice: string;
    matchState: MatchState | null;
    /** Server-anchored timestamp when the current turn started. */
    turnStartedAt: string | null;
    /** When non-null, the match is paused — no actions are accepted. */
    pausedAt: string | null;
  };
  players: { seat: PlayerId; name: string; deviceId: string; isOnline: boolean; lastSeen: string }[];
  mySeat: PlayerId | null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";
function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  for (let i = 0; i < 2; i++) code += DIGITS[Math.floor(Math.random() * DIGITS.length)];
  return code;
}

function maskMatchStateForSeat(state: MatchState, mySeat: PlayerId | null): MatchState {
  const hands = state.round.hands;
  const masked: MatchState["round"]["hands"] = { 0: [], 1: [], 2: [], 3: [] };
  for (const p of [0, 1, 2, 3] as PlayerId[]) {
    if (p === mySeat) {
      masked[p] = hands[p].map((c) => ({ ...c }));
    } else {
      masked[p] = hands[p].map((_, i) => ({ id: `hidden-${p}-${i}`, suit: "oros", rank: 1 } as never));
    }
  }
  return { ...state, round: { ...state.round, hands: masked } };
}

interface RoomRow {
  id: string;
  code: string;
  status: "lobby" | "playing" | "finished" | "abandoned";
  target_cames: number;
  initial_mano: number;
  seat_kinds: SeatKind[];
  host_device: string;
  match_state: MatchState | null;
  bot_intents?: BotIntents;
  turn_started_at?: string | null;
  paused_at?: string | null;
}

interface PlayerRow {
  seat: number;
  device_id: string;
  name: string;
  is_online: boolean;
  last_seen: string;
}

function buildFullDTO(room: RoomRow, players: PlayerRow[], myDeviceId: string | null): RoomFullDTO {
  const me = myDeviceId ? players.find((p) => p.device_id === myDeviceId) ?? null : null;
  const mySeat = me ? (me.seat as PlayerId) : null;
  const matchState = room.match_state ? maskMatchStateForSeat(room.match_state, mySeat) : null;
  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      targetCames: room.target_cames,
      initialMano: room.initial_mano as PlayerId,
      seatKinds: room.seat_kinds,
      hostDevice: room.host_device,
      matchState,
      turnStartedAt: room.turn_started_at ?? null,
      pausedAt: room.paused_at ?? null,
    },
    players: players.map((p) => ({
      seat: p.seat as PlayerId,
      name: p.name,
      deviceId: p.device_id,
      isOnline: p.is_online,
      lastSeen: p.last_seen,
    })),
    mySeat,
  };
}

/**
 * Returns the seat (0..3) that is currently expected to act, or null if none.
 * Used to decide whether the "turn" has changed across two states (and thus
 * whether to bump `turn_started_at`).
 */
function currentActor(state: MatchState | null): PlayerId | null {
  if (!state) return null;
  const r = state.round;
  if (r.phase === "game-end" || r.phase === "round-end") return null;
  for (const p of [0, 1, 2, 3] as PlayerId[]) {
    if (legalActions(state, p).length === 0) continue;
    if (
      (r.envitState.kind === "pending" && r.envitState.awaitingTeam === (p % 2 === 0 ? "nos" : "ells")) ||
      (r.trucState.kind === "pending" && r.trucState.awaitingTeam === (p % 2 === 0 ? "nos" : "ells")) ||
      r.turn === p
    ) {
      return p;
    }
  }
  return null;
}

/**
 * Decides the new value for `turn_started_at`:
 *   - If the actor changed compared to `prevState`, anchor to `now`.
 *   - Otherwise keep the previous timestamp so countdowns don't restart on
 *     unrelated row updates (chat, presence-driven re-saves, etc.).
 */
function computeTurnStartedAt(
  prevState: MatchState | null,
  nextState: MatchState | null,
  prevTurnStartedAt: string | null,
): string | null {
  const nextActor = currentActor(nextState);
  if (nextActor == null) return null;
  const prevActor = currentActor(prevState);
  if (prevActor === nextActor && prevTurnStartedAt) return prevTurnStartedAt;
  return new Date().toISOString();
}

interface BotIntents {
  cardHint?: Record<number, "fort" | "molesto" | "tres">;
  playStrength?: Record<number, "low" | "high" | "free" | "vine-a-vore">;
  silentTruc?: Record<number, boolean>;
  foldTruc?: Record<number, boolean>;
}

function hintsForBot(intents: BotIntents, seat: PlayerId): BotHints {
  return {
    cardHint: intents.cardHint?.[seat] ?? null,
    playStrength: intents.playStrength?.[seat] ?? null,
    silentTruc: intents.silentTruc?.[seat] ?? false,
    foldTruc: intents.foldTruc?.[seat] ?? false,
    // Conservador per online: sense rastreig de chat per ronda, assumim
    // que un rival podria haver mostrat força → mai reservem manilla.
    // Així es respecta estrictament la regla: la reserva només passa
    // quan tenim certesa absoluta que cap rival ha senyalitzat.
    rivalShownStrength: true,
  };
}

function actionsEqual(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "play-card" && b.type === "play-card") return a.cardId === b.cardId;
  if (a.type === "shout" && b.type === "shout") return (a as any).what === (b as any).what;
  return false;
}

// Players whose `last_seen` is older than this are treated as bots so the
// match doesn't stall when somebody disconnects mid-game. They reclaim
// control automatically the moment they heartbeat or call getRoom.
const INACTIVITY_BOT_TAKEOVER_MS = 60_000;

/**
 * Returns a seat-kinds array where every "human" seat whose occupant has been
 * inactive for more than INACTIVITY_BOT_TAKEOVER_MS (or is missing entirely)
 * is treated as a "bot". Used to keep the game moving when a player drops.
 */
async function effectiveSeatKinds(
  roomId: string,
  baseSeatKinds: SeatKind[],
): Promise<SeatKind[]> {
  const { data: players } = await admin
    .from("room_players")
    .select("seat, last_seen, is_online")
    .eq("room_id", roomId);
  const now = Date.now();
  const result = [...baseSeatKinds];
  for (let s = 0; s < 4; s++) {
    if (result[s] !== "human") continue;
    const occupant = (players ?? []).find((p: any) => p.seat === s) as
      | { last_seen: string; is_online: boolean }
      | undefined;
    const lastSeen = occupant?.last_seen
      ? new Date(occupant.last_seen).getTime()
      : 0;
    const inactive = !occupant ||
      now - lastSeen > INACTIVITY_BOT_TAKEOVER_MS;
    if (inactive) result[s] = "bot";
  }
  return result;
}

function bluffRateFromHonesty(h: string | null | undefined): number {
  if (h === "pillo") return 0.10;
  if (h === "mentider") return 0.20;
  return 0;
}

async function loadHumanTuning(roomId: string): Promise<{ tuning: BotTuning; bluffRate: number }> {
  // Aggregates the tuning of all human players in the room: average their
  // adaptive profile so bots react to the table's collective playstyle, and
  // apply each player's chosen bot difficulty preset before averaging.
  const { data: players } = await admin
    .from("room_players")
    .select("device_id")
    .eq("room_id", roomId);
  const deviceIds = (players ?? []).map((p: any) => p.device_id).filter(Boolean);
  if (deviceIds.length === 0) return { tuning: NEUTRAL_TUNING, bluffRate: 0 };
  const { data: profiles } = await admin
    .from("player_profiles")
    .select("*")
    .in("device_id", deviceIds);
  const list = (profiles ?? []) as (PlayerProfile & { bot_difficulty?: string; bot_honesty?: string })[];
  if (list.length === 0) return { tuning: NEUTRAL_TUNING, bluffRate: 0 };
  const tunings = list.map((p) => {
    const base = tuningFromProfile(p);
    const diff = (p.bot_difficulty as any) ?? "balanced";
    return applyDifficulty(base, diff);
  });
  const avg: BotTuning = {
    callPropensity: tunings.reduce((s, t) => s + t.callPropensity, 0) / tunings.length,
    bluffPropensity: tunings.reduce((s, t) => s + t.bluffPropensity, 0) / tunings.length,
    acceptThresholdDelta: tunings.reduce((s, t) => s + t.acceptThresholdDelta, 0) / tunings.length,
    envitAcceptDelta: tunings.reduce((s, t) => s + t.envitAcceptDelta, 0) / tunings.length,
    consultRate: tunings.reduce((s, t) => s + t.consultRate, 0) / tunings.length,
  };
  const bluffRates = list.map((p) => bluffRateFromHonesty(p.bot_honesty));
  const bluffRate = bluffRates.reduce((s, v) => s + v, 0) / bluffRates.length;
  return { tuning: avg, bluffRate };
}

async function advanceBots(
  roomId: string,
  initial: MatchState,
  seatKinds: SeatKind[],
  intents: BotIntents,
  prevTurnStartedAt: string | null = null,
) {
  const { tuning, bluffRate } = await loadHumanTuning(roomId);
  let state = initial;
  let safety = 0;
  while (safety++ < 64) {
    if (state.round.phase === "game-end") break;
    let actor: PlayerId | null = null;
    for (const p of [0, 1, 2, 3] as PlayerId[]) {
      if (legalActions(state, p).length > 0) {
        const r = state.round;
        if (
          (r.envitState.kind === "pending" && r.envitState.awaitingTeam === (p % 2 === 0 ? "nos" : "ells")) ||
          (r.trucState.kind === "pending" && r.trucState.awaitingTeam === (p % 2 === 0 ? "nos" : "ells")) ||
          r.turn === p
        ) {
          actor = p;
          break;
        }
      }
    }
    if (actor == null) break;
    if (seatKinds[actor] !== "bot") break;

    const decision = botDecide(state, actor, "neutral", hintsForBot(intents, actor), tuning, bluffRate);
    if (!decision) break;
    await admin.from("room_actions").insert({ room_id: roomId, seat: actor, action: decision });
    state = applyAction(state, actor, decision);
    if (intents.cardHint) delete intents.cardHint[actor];
    if (intents.playStrength) delete intents.playStrength[actor];
    if (intents.silentTruc) delete intents.silentTruc[actor];
    if (intents.foldTruc) delete intents.foldTruc[actor];
    if (state.round.phase === "round-end") {
      state = startNextRound(state);
      intents.cardHint = {};
      intents.playStrength = {};
      intents.silentTruc = {};
      intents.foldTruc = {};
    }
  }
  const newStatus = state.round.phase === "game-end" ? "finished" : "playing";
  // Anchor `turn_started_at` to "now" if the actor changed (or null when no
  // human turn is active). All clients read the same timestamp, so their
  // countdowns stay in sync regardless of network latency.
  const turnStartedAt = newStatus === "playing"
    ? computeTurnStartedAt(initial, state, prevTurnStartedAt)
    : null;
  await admin
    .from("rooms")
    .update({
      match_state: state,
      status: newStatus,
      bot_intents: intents,
      turn_started_at: turnStartedAt,
    })
    .eq("id", roomId);
}

// ──────────────────────────────────────────────────────────────────────
// RPC handlers
// ──────────────────────────────────────────────────────────────────────

const handlers: Record<string, (data: any) => Promise<unknown>> = {
  async createRoom(d) {
    if (d.seatKinds[d.hostSeat] !== "human") throw new Error("El seient de l'amfitrió ha de ser 'human'.");
    let code = "";
    for (let i = 0; i < 5; i++) {
      const candidate = generateRoomCode();
      const { data: existing } = await admin.from("rooms").select("id").eq("code", candidate).maybeSingle();
      if (!existing) { code = candidate; break; }
    }
    if (!code) throw new Error("No s'ha pogut generar un codi de sala. Torna-ho a provar.");

    const { data: room, error } = await admin
      .from("rooms")
      .insert({
        code,
        status: "lobby",
        target_cames: d.targetCames,
        initial_mano: d.initialMano,
        seat_kinds: d.seatKinds,
        host_device: d.hostDevice,
      })
      .select("*")
      .single();
    if (error || !room) throw new Error(error?.message ?? "Error creant sala");

    const { error: pErr } = await admin.from("room_players").insert({
      room_id: room.id,
      seat: d.hostSeat,
      device_id: d.hostDevice,
      name: d.hostName,
      is_online: true,
    });
    if (pErr) throw new Error(pErr.message);
    return { code: room.code, roomId: room.id };
  },

  async joinRoom(d) {
    const code = String(d.code).toUpperCase();
    const { data: room, error } = await admin.from("rooms").select("*").eq("code", code).maybeSingle();
    if (error) throw new Error(error.message);
    if (!room) throw new Error("Sala no trobada");
    if (room.status === "finished" || room.status === "abandoned") throw new Error("La partida ja ha acabat");

    const { data: existingPlayers } = await admin.from("room_players").select("*").eq("room_id", room.id);
    const players = existingPlayers ?? [];
    const mine = players.find((p: any) => p.device_id === d.deviceId);
    // Si la sala és "sense amfitrió" (creada automàticament pel lobby), el primer humà en seure en serà l'amfitrió.
    const HOSTLESS = "__lobby__";
    if (!mine && room.host_device === HOSTLESS) {
      await admin.from("rooms").update({ host_device: d.deviceId, updated_at: new Date().toISOString() }).eq("id", room.id);
      room.host_device = d.deviceId;
    }
    if (mine) {
      await admin.from("room_players")
        .update({ name: d.name, is_online: true, last_seen: new Date().toISOString() })
        .eq("id", mine.id);
      return { roomId: room.id, code: room.code, seat: mine.seat as PlayerId };
    }
    if (room.status !== "lobby") throw new Error("La partida ja ha començat i no permet noves entrades");

    const seatKinds = room.seat_kinds as SeatKind[];
    const usedSeats = new Set(players.map((p: any) => p.seat));
    let chosenSeat: PlayerId | null = null;
    if (d.preferredSeat != null) {
      if (seatKinds[d.preferredSeat] === "human" && !usedSeats.has(d.preferredSeat)) {
        chosenSeat = d.preferredSeat;
      } else throw new Error("Eixe seient no està disponible");
    } else {
      for (let s = 0; s < 4; s++) {
        if (seatKinds[s] === "human" && !usedSeats.has(s)) { chosenSeat = s as PlayerId; break; }
      }
    }
    if (chosenSeat == null) throw new Error("La sala està plena");

    const { error: insErr } = await admin.from("room_players").insert({
      room_id: room.id, seat: chosenSeat, device_id: d.deviceId, name: d.name, is_online: true,
    });
    if (insErr) throw new Error(insErr.message);
    return { roomId: room.id, code: room.code, seat: chosenSeat };
  },

  async getRoom(d) {
    const code = String(d.code).toUpperCase();
    const { data: room, error } = await admin.from("rooms").select("*").eq("code", code).maybeSingle();
    if (error) throw new Error(error.message);
    if (!room) throw new Error("Sala no trobada");
    const { data: players } = await admin.from("room_players").select("*").eq("room_id", room.id).order("seat");
    // NOTE: presence (is_online / last_seen) is updated only via the
    // `heartbeat` RPC. Updating it here would trigger a Realtime UPDATE on
    // `room_players` for every fetch, which the client listens to and reacts
    // to by calling `getRoom` again — causing an infinite loop that blocks
    // the UI and overwhelms the edge function.
    return buildFullDTO(room as RoomRow, (players ?? []) as PlayerRow[], d.deviceId ?? null);
  },

  async startMatch(d) {
    const { data: room, error } = await admin.from("rooms").select("*").eq("id", d.roomId).maybeSingle();
    if (error || !room) throw new Error("Sala no trobada");
    if (room.host_device !== d.deviceId) throw new Error("Només l'amfitrió pot començar");
    if (room.status !== "lobby") throw new Error("La partida ja ha començat");

    const { data: players } = await admin.from("room_players").select("seat").eq("room_id", room.id);
    const seatKinds = room.seat_kinds as SeatKind[];
    const expectedHumans = seatKinds.filter((k) => k === "human").length;
    if ((players?.length ?? 0) < expectedHumans) {
      throw new Error(`Falten humans per unir-se (${players?.length ?? 0}/${expectedHumans})`);
    }
    const initialMano = room.initial_mano as PlayerId;
    const firstDealer = (((initialMano + 3) % 4) as PlayerId);
    const matchState = createMatch({ targetCama: 12, targetCames: room.target_cames, firstDealer });
    const initialTurnStartedAt = computeTurnStartedAt(null, matchState, null);
    const { error: upErr } = await admin.from("rooms")
      .update({
        status: "playing",
        match_state: matchState,
        turn_started_at: initialTurnStartedAt,
        updated_at: new Date().toISOString(),
      }).eq("id", room.id);
    if (upErr) throw new Error(upErr.message);
    await advanceBots(
      room.id,
      matchState,
      await effectiveSeatKinds(room.id, seatKinds),
      {},
      initialTurnStartedAt,
    );
    return { ok: true };
  },

  async submitAction(d) {
    const { data: room } = await admin.from("rooms").select("*").eq("id", d.roomId).maybeSingle();
    if (!room) throw new Error("Sala no trobada");
    if (room.status !== "playing") throw new Error("La partida no està en curs");
    if ((room as any).paused_at) throw new Error("La partida està pausada");

    const { data: player } = await admin.from("room_players").select("seat")
      .eq("room_id", room.id).eq("device_id", d.deviceId).maybeSingle();
    if (!player) throw new Error("No estàs en aquesta sala");
    const seat = player.seat as PlayerId;
    const state = room.match_state as MatchState | null;
    if (!state) throw new Error("Estat de partida buit");

    const legal = legalActions(state, seat);
    if (!legal.some((a) => actionsEqual(a, d.action))) throw new Error("Acció no permesa");

    // Submitting an action counts as activity — refresh presence so the seat
    // immediately stops being treated as inactive (bot takeover).
    await admin.from("room_players")
      .update({ is_online: true, last_seen: new Date().toISOString() })
      .eq("room_id", room.id).eq("device_id", d.deviceId);

    // Track human shouts in their adaptive profile (best-effort, non-blocking failures).
    if (d.action.type === "shout") {
      try {
        const what = (d.action as any).what as string;
        const hand = state.round.hands[seat] ?? [];
        const events: any[] = [];
        if (what === "envit" || what === "renvit" || what === "falta-envit") {
          // crude envit estimate by suit-count
          const counts: Record<string, number[]> = {};
          for (const c of hand) (counts[c.suit] ||= []).push(c.rank === 1 ? 1 : c.rank >= 10 ? 0 : c.rank);
          let best = 0;
          for (const arr of Object.values(counts)) {
            const sorted = arr.sort((a, b) => b - a);
            const v = sorted.length >= 2 ? 20 + sorted[0] + sorted[1] : sorted[0] ?? 0;
            if (v > best) best = v;
          }
          events.push({ type: "envit_called", strength: best, bluff: best < 25 });
        } else if (what === "truc" || what === "retruc" || what === "quatre" || what === "joc-fora") {
          let s = 0;
          for (const c of hand) {
            s += c.rank === 1 && (c.suit === "espases" || c.suit === "bastos") ? 0.5
              : c.rank === 7 && (c.suit === "oros" || c.suit === "espases") ? 0.5
              : c.rank === 3 ? 0.3 : 0.05;
          }
          const strength = Math.min(1, s);
          events.push({ type: "truc_called", strength, bluff: strength < 0.25 });
        } else if (what === "vull" || what === "no-vull") {
          const accepted = what === "vull";
          if (state.round.envitState.kind === "pending") events.push({ type: "envit_response", accepted });
          else if (state.round.trucState.kind === "pending") events.push({ type: "truc_response", accepted });
        }
        if (events.length > 0) {
          // Fire-and-forget call to player-profile edge function.
          admin.functions.invoke("player-profile", { body: { fn: "track", data: { deviceId: d.deviceId, events } } }).catch(() => {});
        }
      } catch { /* ignore */ }
    }

    let next = applyAction(state, seat, d.action);
    if (next.round.phase === "round-end" && (next.round.phase as string) !== "game-end") {
      next = startNextRound(next);
    }
    await admin.from("room_actions").insert({ room_id: room.id, seat, action: d.action });
    const newStatus = next.round.phase === "game-end" ? "finished" : "playing";
    const prevTurnStartedAt = (room as any).turn_started_at as string | null | undefined ?? null;
    const nextTurnStartedAt = newStatus === "playing"
      ? computeTurnStartedAt(state, next, prevTurnStartedAt)
      : null;
    await admin.from("rooms").update({
      match_state: next,
      status: newStatus,
      turn_started_at: nextTurnStartedAt,
      updated_at: new Date().toISOString(),
    }).eq("id", room.id);
    if (newStatus === "playing") {
      const effective = await effectiveSeatKinds(room.id, room.seat_kinds as SeatKind[]);
      await advanceBots(
        room.id,
        next,
        effective,
        (room as any).bot_intents ?? {},
        nextTurnStartedAt,
      );
    }
    return { ok: true };
  },

  async updatePlayerName(d) {
    const { error } = await admin.from("room_players").update({ name: d.name })
      .eq("room_id", d.roomId).eq("device_id", d.deviceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  },

  async heartbeat(d) {
    await admin.from("room_players")
      .update({ is_online: true, last_seen: new Date().toISOString() })
      .eq("room_id", d.roomId).eq("device_id", d.deviceId);
    // En lobby toquem updated_at perquè el lobby sàpiga que l'amfitrió està viu.
    const { data: room } = await admin
      .from("rooms")
      .select("id, host_device, status, match_state, seat_kinds, bot_intents, turn_started_at")
      .eq("id", d.roomId).maybeSingle();
    if (!room) return { ok: true };
    if ((room as any).host_device === d.deviceId && (room as any).status === "lobby") {
      await admin.from("rooms").update({ updated_at: new Date().toISOString() }).eq("id", d.roomId);
    }
    // While playing, every heartbeat from any participant is a chance to
    // advance the bot replacement for inactive seats. This is what unblocks
    // the match when a human disconnects mid-turn: their teammates' regular
    // heartbeats (every 15s) will trigger the bot to act for them.
    if ((room as any).status === "playing" && (room as any).match_state && !(room as any).paused_at) {
      const state = (room as any).match_state as MatchState;
      const effective = await effectiveSeatKinds(d.roomId, (room as any).seat_kinds as SeatKind[]);
      const intents: BotIntents = (room as any).bot_intents ?? {};
      const prevTurnStartedAt = (room as any).turn_started_at as string | null | undefined ?? null;
      await advanceBots(d.roomId, state, effective, intents, prevTurnStartedAt);
    }
    return { ok: true };
  },

  async setSeatKind(d) {
    const { data: room } = await admin.from("rooms").select("*").eq("id", d.roomId).maybeSingle();
    if (!room) throw new Error("Sala no trobada");
    if (room.host_device !== d.deviceId) throw new Error("Només l'amfitrió pot canviar els seients");
    if (room.status !== "lobby") throw new Error("La partida ja ha començat");
    const seat = d.seat as PlayerId;
    const kind = d.kind as SeatKind;
    if (kind !== "human" && kind !== "bot") throw new Error("Tipus de seient invàlid");
    const seatKinds = [...(room.seat_kinds as SeatKind[])];
    // No permetre canviar un seient ja ocupat per un humà
    const { data: occ } = await admin.from("room_players").select("device_id").eq("room_id", room.id).eq("seat", seat).maybeSingle();
    if (occ) throw new Error("Eixe seient ja està ocupat per un humà");
    seatKinds[seat] = kind;
    const { error } = await admin.from("rooms").update({ seat_kinds: seatKinds, updated_at: new Date().toISOString() }).eq("id", room.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  },

  async leaveRoom(d) {
    const { data: room } = await admin.from("rooms").select("*").eq("id", d.roomId).maybeSingle();
    if (!room) return { ok: true };
    const HOSTLESS = "__lobby__";
    const isHost = room.host_device === d.deviceId;
    // Treure el jugador si estem en lobby
    if (room.status === "lobby") {
      await admin.from("room_players").delete().eq("room_id", room.id).eq("device_id", d.deviceId);
    } else {
      await admin.from("room_players").update({ is_online: false }).eq("room_id", room.id).eq("device_id", d.deviceId);
    }
    if (isHost) {
      // Si encara queden altres humans al lobby, reassignem l'amfitrió; si no, la sala queda "sense amfitrió" (hostless) per al lobby automàtic o s'abandona si està jugant.
      if (room.status === "lobby") {
        const { data: remaining } = await admin.from("room_players").select("device_id").eq("room_id", room.id).limit(1);
        const nextHost = (remaining ?? [])[0]?.device_id ?? HOSTLESS;
        await admin.from("rooms").update({ host_device: nextHost, updated_at: new Date().toISOString() }).eq("id", room.id);
        return { ok: true, abandoned: false };
      }
      await admin.from("rooms").update({ status: "abandoned", updated_at: new Date().toISOString() }).eq("id", room.id);
      return { ok: true, abandoned: true };
    }
    return { ok: true };
  },

  async listLobbyRooms(_d) {
    const HOSTLESS = "__lobby__";
    const LOBBY_TABLES = 4;

    // 1) Neteja de taules penjades: només si l'amfitrió real (no hostless) ha desaparegut >3min,
    //    o si porta >3min "playing" amb marcador 0-0.
    const stale = new Date(Date.now() - 180_000).toISOString();
    const { data: staleRooms } = await admin
      .from("rooms")
      .select("id, host_device, status, updated_at, match_state")
      .in("status", ["lobby", "playing"])
      .lt("updated_at", stale);
    for (const r of (staleRooms ?? []) as { id: string; host_device: string; status: "lobby" | "playing"; updated_at: string; match_state: MatchState | null }[]) {
      if (r.host_device === HOSTLESS) continue; // Les taules automàtiques del lobby no caduquen.
      const { data: host } = await admin.from("room_players")
        .select("last_seen, is_online")
        .eq("room_id", r.id).eq("device_id", r.host_device).maybeSingle();
      const lastSeen = host?.last_seen ? new Date(host.last_seen).getTime() : 0;
      const hostMissing = !host || !host.is_online || Date.now() - lastSeen > 180_000;
      const state = r.match_state as MatchState | null;
      const stillZeroZero = !!state
        && state.cames === 0
        && state.scores.nos.males === 0
        && state.scores.nos.bones === 0
        && state.scores.nos.males === 0
        && state.scores.ells.males === 0
        && state.scores.ells.bones === 0;
      if (hostMissing || (r.status === "playing" && stillZeroZero)) {
        await admin.from("rooms").update({ status: "abandoned", updated_at: new Date().toISOString() }).eq("id", r.id);
      }
    }

    // 2) Garantir que sempre hi ha LOBBY_TABLES taules en lobby (les "oficials"). Omplim buits amb taules hostless.
    const { data: lobbyCount } = await admin
      .from("rooms")
      .select("id", { count: "exact", head: false })
      .eq("status", "lobby");
    const existing = (lobbyCount ?? []).length;
    const toCreate = Math.max(0, LOBBY_TABLES - existing);
    for (let i = 0; i < toCreate; i++) {
      let code = "";
      for (let tries = 0; tries < 5; tries++) {
        const cand = generateRoomCode();
        const { data: ex } = await admin.from("rooms").select("id").eq("code", cand).maybeSingle();
        if (!ex) { code = cand; break; }
      }
      if (!code) continue;
      await admin.from("rooms").insert({
        code,
        status: "lobby",
        target_cames: 2,
        initial_mano: 0,
        seat_kinds: ["human", "human", "human", "human"],
        host_device: HOSTLESS,
      });
    }

    const { data: rooms, error } = await admin
      .from("rooms")
      .select("id, code, status, target_cames, seat_kinds, host_device, created_at")
      .in("status", ["lobby", "playing"])
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(error.message);
    const list = rooms ?? [];
    if (list.length === 0) return { rooms: [] };
    const ids = list.map((r: any) => r.id);
    const { data: players } = await admin
      .from("room_players")
      .select("room_id, seat, name, is_online")
      .in("room_id", ids);
    const byRoom = new Map<string, any[]>();
    for (const p of (players ?? [])) {
      const arr = byRoom.get(p.room_id) ?? [];
      arr.push(p);
      byRoom.set(p.room_id, arr);
    }
    return {
      rooms: list.map((r: any) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        targetCames: r.target_cames,
        seatKinds: r.seat_kinds,
        hostDevice: r.host_device,
        players: (byRoom.get(r.id) ?? []).map((p) => ({
          seat: p.seat as PlayerId,
          name: p.name,
          isOnline: p.is_online,
        })),
      })),
    };
  },

  async sendChatPhrase(d) {
    const { data: room } = await admin.from("rooms").select("*").eq("id", d.roomId).maybeSingle();
    if (!room) throw new Error("Sala no trobada");
    const { data: player } = await admin.from("room_players").select("seat")
      .eq("room_id", room.id).eq("device_id", d.deviceId).maybeSingle();
    if (!player) throw new Error("No estàs en aquesta sala");
    const seat = player.seat as PlayerId;

    await admin.from("room_chat").insert({ room_id: room.id, seat, phrase_id: d.phraseId });
    if (room.status !== "playing") return { ok: true };
    if ((room as any).paused_at) return { ok: true };

    const seatKinds = room.seat_kinds as SeatKind[];
    let state = room.match_state as MatchState | null;
    if (!state) return { ok: true };
    const intents: BotIntents = (room as any).bot_intents ?? {};
    intents.cardHint ??= {};
    intents.playStrength ??= {};
    intents.silentTruc ??= {};
    intents.foldTruc ??= {};

    const partner = partnerOf(seat);
    const partnerIsBot = seatKinds[partner] === "bot";

    const legal = legalActions(state, seat);
    const tryDispatch = async (what: string) => {
      const a = legal.find((x: any) => x.type === "shout" && x.what === what);
      if (!a) return false;
      let next = applyAction(state!, seat, a);
      if (next.round.phase === "round-end" && (next.round.phase as string) !== "game-end") {
        next = startNextRound(next);
      }
      await admin.from("room_actions").insert({ room_id: room.id, seat, action: a });
      state = next;
      return true;
    };

    let stateChanged = false;
    if (d.phraseId === "envida") {
      stateChanged = (await tryDispatch("envit")) || stateChanged;
    } else if (d.phraseId === "tira-falta") {
      stateChanged = (await tryDispatch("falta-envit")) || stateChanged;
    } else if (d.phraseId === "vamonos") {
      const r = state.round;
      const canFold = r.trucState.kind === "pending" &&
        r.trucState.awaitingTeam === teamOf(seat) &&
        legal.some((a: any) => a.type === "shout" && a.what === "no-vull");
      if (canFold) stateChanged = (await tryDispatch("no-vull")) || stateChanged;
      if (partnerIsBot) intents.foldTruc[partner] = true;
    } else if (d.phraseId === "pon-fort" && partnerIsBot) {
      intents.cardHint[partner] = "fort";
    } else if (d.phraseId === "pon-molesto" && partnerIsBot) {
      intents.cardHint[partner] = "molesto";
    } else if (d.phraseId === "vine-al-teu-tres" && partnerIsBot) {
      intents.cardHint[partner] = "tres";
    } else if (d.phraseId === "juega-callado" && partnerIsBot) {
      intents.silentTruc[partner] = true;
    } else if ((d.phraseId === "vine-a-mi" || d.phraseId === "vine-al-meu-tres") && partnerIsBot) {
      intents.playStrength[partner] = "low";
    } else if ((d.phraseId === "tinc-bona" || d.phraseId === "tinc-un-tres") && partnerIsBot) {
      intents.playStrength[partner] = "free";
    } else if ((d.phraseId === "a-tu" || d.phraseId === "no-tinc-res") && partnerIsBot) {
      intents.playStrength[partner] = "high";
    }
    // Compromís personal: el qui ha emés la frase ha declarat tindre
    // 7 d'oros o un 3 ("vine-a-vore"), o un 3 amb context favorable
    // ("vine-al-meu-tres"), o un 3 sense top cards ("tinc-un-tres").
    // Si és un seient controlat per bot (bot remot), apliquem el
    // playStrength específic al propi speaker perquè la lògica del bot
    // honre el compromís quan li toque jugar.
    if (
      (d.phraseId === "vine-a-vore" ||
        d.phraseId === "vine-al-meu-tres" ||
        d.phraseId === "tinc-un-tres") &&
      seatKinds[seat] === "bot"
    ) {
      intents.playStrength[seat] = d.phraseId;
    }

    const prevTurnStartedAt = (room as any).turn_started_at as string | null | undefined ?? null;
    if (stateChanged) {
      const newStatus = state.round.phase === "game-end" ? "finished" : "playing";
      const initialState = room.match_state as MatchState;
      const nextTurnStartedAt = newStatus === "playing"
        ? computeTurnStartedAt(initialState, state, prevTurnStartedAt)
        : null;
      await admin.from("rooms")
        .update({
          match_state: state,
          status: newStatus,
          bot_intents: intents,
          turn_started_at: nextTurnStartedAt,
        }).eq("id", room.id);
      if (newStatus === "playing") {
        const eff = await effectiveSeatKinds(room.id, seatKinds);
        await advanceBots(room.id, state, eff, intents, nextTurnStartedAt);
      }
    } else {
      await admin.from("rooms").update({ bot_intents: intents }).eq("id", room.id);
      const eff = await effectiveSeatKinds(room.id, seatKinds);
      await advanceBots(room.id, state, eff, intents, prevTurnStartedAt);
    }
    return { ok: true };
  },

  async listMyActiveRooms(d) {
    if (!d?.deviceId || typeof d.deviceId !== "string") {
      return { rooms: [] };
    }
    // Find every room where this device occupies a seat AND the room is still
    // in progress. Used by the home page banner to offer "tornar a la partida".
    const { data: mySeats } = await admin
      .from("room_players")
      .select("room_id, seat")
      .eq("device_id", d.deviceId);
    const roomIds = (mySeats ?? []).map((r: any) => r.room_id);
    if (roomIds.length === 0) return { rooms: [] };

    const { data: rooms } = await admin
      .from("rooms")
      .select("id, code, status, target_cames, updated_at")
      .in("id", roomIds)
      .eq("status", "playing")
      .order("updated_at", { ascending: false });

    return {
      rooms: (rooms ?? []).map((r: any) => {
        const seat = (mySeats ?? []).find((s: any) => s.room_id === r.id)?.seat ?? null;
        return {
          id: r.id,
          code: r.code,
          status: r.status,
          targetCames: r.target_cames,
          updatedAt: r.updated_at,
          mySeat: seat,
        };
      }),
    };
  },

  async sendTextMessage(d) {
    const text = typeof d?.text === "string" ? d.text.trim() : "";
    if (!text) throw new Error("Missatge buit");
    if (text.length > 200) throw new Error("Missatge massa llarg (màx 200)");
    if (typeof d?.roomId !== "string" || !d.roomId) throw new Error("roomId requerit");
    if (typeof d?.deviceId !== "string" || !d.deviceId) throw new Error("deviceId requerit");

    const { data: player } = await admin
      .from("room_players")
      .select("seat")
      .eq("room_id", d.roomId)
      .eq("device_id", d.deviceId)
      .maybeSingle();
    if (!player) throw new Error("No estàs en aquesta sala");

    const { error } = await admin.from("room_text_chat").insert({
      room_id: d.roomId,
      seat: player.seat,
      device_id: d.deviceId,
      text,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  },

  async ping(_d) {
    return { ok: true, t: Date.now() };
  },

  async setPaused(d) {
    if (typeof d?.roomId !== "string" || !d.roomId) throw new Error("roomId requerit");
    if (typeof d?.deviceId !== "string" || !d.deviceId) throw new Error("deviceId requerit");
    const paused = !!d?.paused;
    const { data: room } = await admin.from("rooms").select("*").eq("id", d.roomId).maybeSingle();
    if (!room) throw new Error("Sala no trobada");
    if (room.status !== "playing") throw new Error("La partida no està en curs");
    const { data: player } = await admin.from("room_players").select("seat")
      .eq("room_id", room.id).eq("device_id", d.deviceId).maybeSingle();
    if (!player) throw new Error("No estàs en aquesta sala");

    const wasPaused = !!(room as any).paused_at;
    const nowIso = new Date().toISOString();
    await admin.from("rooms").update({
      paused_at: paused ? nowIso : null,
      updated_at: nowIso,
    }).eq("id", room.id);

    // When resuming, kick bots so the round can continue immediately.
    if (wasPaused && !paused && (room as any).match_state) {
      const state = (room as any).match_state as MatchState;
      const eff = await effectiveSeatKinds(room.id, room.seat_kinds as SeatKind[]);
      const intents: BotIntents = (room as any).bot_intents ?? {};
      const prevTurnStartedAt = (room as any).turn_started_at as string | null | undefined ?? null;
      await advanceBots(room.id, state, eff, intents, prevTurnStartedAt);
    }
    return { ok: true, paused };
  },

  async adminCloseRoom(d) {
    const expected = Deno.env.get("ADMIN_PASSWORD") ?? "";
    if (!expected) throw new Error("Admin no configurat al servidor");
    if (typeof d?.password !== "string" || d.password !== expected) {
      throw new Error("Contrasenya d'administrador incorrecta");
    }
    if (typeof d?.roomId !== "string" || !d.roomId) throw new Error("roomId requerit");
    const { error } = await admin
      .from("rooms")
      .update({ status: "abandoned", updated_at: new Date().toISOString() })
      .eq("id", d.roomId);
    if (error) throw new Error(error.message);
    return { ok: true };
  },
};

// ──────────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  try {
    const body = await req.json();
    const { fn, data } = body;
    const handler = handlers[fn];
    if (!handler) return jsonResponse(400, { error: `Unknown fn: ${fn}` });
    const result = await handler(data ?? {});
    return jsonResponse(200, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[rooms-rpc]", msg);
    return jsonResponse(400, { error: msg });
  }
});
