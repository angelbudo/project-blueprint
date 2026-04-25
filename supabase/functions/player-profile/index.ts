// Edge function for the player adaptive profile.
// Body: { fn: "get" | "track", data: {...} }
// Public access (no auth) — identity is the client-generated device_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

interface ProfileRow {
  device_id: string;
  games_played: number;
  envit_called: number;
  envit_called_bluff: number;
  envit_accepted: number;
  envit_rejected: number;
  truc_called: number;
  truc_called_bluff: number;
  truc_accepted: number;
  truc_rejected: number;
  envit_strength_sum: number;
  envit_strength_n: number;
  truc_strength_sum: number;
  truc_strength_n: number;
  aggressiveness: number;
  bluff_rate: number;
  accept_threshold: number;
}

const EMPTY = (deviceId: string): ProfileRow => ({
  device_id: deviceId,
  games_played: 0,
  envit_called: 0,
  envit_called_bluff: 0,
  envit_accepted: 0,
  envit_rejected: 0,
  truc_called: 0,
  truc_called_bluff: 0,
  truc_accepted: 0,
  truc_rejected: 0,
  envit_strength_sum: 0,
  envit_strength_n: 0,
  truc_strength_sum: 0,
  truc_strength_n: 0,
  aggressiveness: 0.5,
  bluff_rate: 0.15,
  accept_threshold: 0.5,
});

function recompute(p: ProfileRow): ProfileRow {
  const totalCalls = p.envit_called + p.truc_called;
  const totalResp = p.envit_accepted + p.envit_rejected + p.truc_accepted + p.truc_rejected;
  // Aggressiveness: how often the player calls/raises vs. how many opportunities (proxy: games).
  const callsPerGame = p.games_played > 0 ? totalCalls / p.games_played : 0;
  // Anchored: 0 calls/game → 0.3, 4+ calls/game → 0.85. Linear inbetween.
  const agg = Math.max(0.15, Math.min(0.9, 0.3 + (callsPerGame / 4) * 0.55));
  const bluffNum = p.envit_called_bluff + p.truc_called_bluff;
  const bluff = totalCalls > 0 ? Math.max(0.02, Math.min(0.6, bluffNum / Math.max(1, totalCalls))) : 0.15;
  const acceptN = p.envit_accepted + p.truc_accepted;
  const acceptRate = totalResp > 0 ? acceptN / totalResp : 0.5;
  // Player who accepts a lot → bot can call more bluffs against them.
  // Player who folds a lot → bot's bluffs work great. Threshold inversely informs bot.
  const accept = Math.max(0.15, Math.min(0.9, acceptRate));
  return { ...p, aggressiveness: agg, bluff_rate: bluff, accept_threshold: accept };
}

async function loadOrCreate(deviceId: string): Promise<ProfileRow> {
  const { data } = await admin.from("player_profiles").select("*").eq("device_id", deviceId).maybeSingle();
  if (data) return data as ProfileRow;
  const fresh = EMPTY(deviceId);
  await admin.from("player_profiles").insert(fresh);
  return fresh;
}

interface TrackEvent {
  type:
    | "game_started"
    | "envit_called"
    | "truc_called"
    | "envit_response"
    | "truc_response";
  /** For *_called: 20..40 envit value or 0..1 truc strength estimate. */
  strength?: number;
  /** For *_called: was it a bluff (low strength)? */
  bluff?: boolean;
  /** For *_response: did the player accept (true) or reject (false). */
  accepted?: boolean;
}

function applyEvent(p: ProfileRow, ev: TrackEvent): ProfileRow {
  const out = { ...p };
  switch (ev.type) {
    case "game_started":
      out.games_played += 1;
      break;
    case "envit_called":
      out.envit_called += 1;
      if (ev.bluff) out.envit_called_bluff += 1;
      if (typeof ev.strength === "number") {
        out.envit_strength_sum += Math.round(ev.strength);
        out.envit_strength_n += 1;
      }
      break;
    case "truc_called":
      out.truc_called += 1;
      if (ev.bluff) out.truc_called_bluff += 1;
      if (typeof ev.strength === "number") {
        out.truc_strength_sum += Math.round(ev.strength * 100);
        out.truc_strength_n += 1;
      }
      break;
    case "envit_response":
      if (ev.accepted) out.envit_accepted += 1;
      else out.envit_rejected += 1;
      break;
    case "truc_response":
      if (ev.accepted) out.truc_accepted += 1;
      else out.truc_rejected += 1;
      break;
  }
  return recompute(out);
}

const handlers: Record<string, (data: any) => Promise<unknown>> = {
  async get(d) {
    const deviceId = String(d.deviceId ?? "").trim();
    if (!deviceId) throw new Error("deviceId requerido");
    const p = await loadOrCreate(deviceId);
    return { profile: p };
  },
  async track(d) {
    const deviceId = String(d.deviceId ?? "").trim();
    if (!deviceId) throw new Error("deviceId requerido");
    const events = Array.isArray(d.events) ? (d.events as TrackEvent[]) : [];
    if (events.length === 0) {
      const p = await loadOrCreate(deviceId);
      return { profile: p };
    }
    let p = await loadOrCreate(deviceId);
    for (const ev of events) p = applyEvent(p, ev);
    const { error } = await admin.from("player_profiles").update({
      games_played: p.games_played,
      envit_called: p.envit_called,
      envit_called_bluff: p.envit_called_bluff,
      envit_accepted: p.envit_accepted,
      envit_rejected: p.envit_rejected,
      truc_called: p.truc_called,
      truc_called_bluff: p.truc_called_bluff,
      truc_accepted: p.truc_accepted,
      truc_rejected: p.truc_rejected,
      envit_strength_sum: p.envit_strength_sum,
      envit_strength_n: p.envit_strength_n,
      truc_strength_sum: p.truc_strength_sum,
      truc_strength_n: p.truc_strength_n,
      aggressiveness: p.aggressiveness,
      bluff_rate: p.bluff_rate,
      accept_threshold: p.accept_threshold,
    }).eq("device_id", deviceId);
    if (error) throw new Error(error.message);
    return { profile: p };
  },
  async set_difficulty(d) {
    const deviceId = String(d.deviceId ?? "").trim();
    const difficulty = String(d.difficulty ?? "").trim();
    if (!deviceId) throw new Error("deviceId requerido");
    if (!["conservative", "balanced", "aggressive"].includes(difficulty)) {
      throw new Error("difficulty inválida");
    }
    await loadOrCreate(deviceId);
    const { error } = await admin
      .from("player_profiles")
      .update({ bot_difficulty: difficulty })
      .eq("device_id", deviceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  },
  async set_honesty(d) {
    const deviceId = String(d.deviceId ?? "").trim();
    const honesty = String(d.honesty ?? "").trim();
    if (!deviceId) throw new Error("deviceId requerido");
    if (!["sincero", "pillo", "mentider"].includes(honesty)) {
      throw new Error("honesty inválida");
    }
    await loadOrCreate(deviceId);
    const { error } = await admin
      .from("player_profiles")
      .update({ bot_honesty: honesty })
      .eq("device_id", deviceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  let body: { fn?: string; data?: unknown };
  try { body = await req.json(); } catch { return jsonResponse(400, { error: "JSON inválido" }); }
  const fn = String(body.fn ?? "");
  const handler = handlers[fn];
  if (!handler) return jsonResponse(400, { error: `RPC desconegut: ${fn}` });
  try {
    const result = await handler(body.data ?? {});
    return jsonResponse(200, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse(400, { error: msg });
  }
});
