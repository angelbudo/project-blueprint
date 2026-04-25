// Lightweight global diagnostics store for online play.
// Tracks: Supabase REST/Functions health, realtime channel states,
// and recent errors. Subscribers (the diagnostics panel) get notified
// on every change. Designed to be importable from anywhere without
// pulling React.

import { supabase } from "@/integrations/supabase/client";

export type ChannelStatus =
  | "idle"
  | "subscribing"
  | "joined"
  | "closed"
  | "error"
  | "timeout";

export interface ChannelInfo {
  /** Human-readable label, e.g. "room-ABC123" or "lobby-rooms" */
  name: string;
  /** Logical scope: "room", "lobby", "chat", "text-chat", "presence", "invites", "active-rooms" */
  scope: string;
  status: ChannelStatus;
  /** Last status change timestamp (ms). */
  updatedAt: number;
}

export interface DiagError {
  id: number;
  /** Where it happened: "rpc:fn", "channel:scope", "fetch", … */
  source: string;
  message: string;
  at: number;
}

export type ConnectionHealth = "unknown" | "ok" | "degraded" | "down";

export interface DiagnosticsState {
  health: ConnectionHealth;
  /** Last successful round-trip to the edge function (ms). */
  lastOkAt: number | null;
  /** Last failure timestamp (ms). */
  lastErrorAt: number | null;
  /** Current realtime websocket state, derived from supabase.realtime. */
  realtime: "connecting" | "open" | "closing" | "closed" | "unknown";
  channels: Record<string, ChannelInfo>; // keyed by `${scope}:${name}`
  errors: DiagError[]; // newest-first, capped
}

const MAX_ERRORS = 30;

const state: DiagnosticsState = {
  health: "unknown",
  lastOkAt: null,
  lastErrorAt: null,
  realtime: "unknown",
  channels: {},
  errors: [],
};

type Listener = (s: DiagnosticsState) => void;
const listeners = new Set<Listener>();
let nextErrorId = 1;

function emit() {
  for (const l of listeners) l(state);
}

export function subscribeDiagnostics(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => {
    listeners.delete(l);
  };
}

export function getDiagnostics(): DiagnosticsState {
  return state;
}

// ─── Channel tracking ──────────────────────────────────────────────
function chanKey(scope: string, name: string) {
  return `${scope}:${name}`;
}

export function reportChannel(scope: string, name: string, status: ChannelStatus) {
  state.channels = {
    ...state.channels,
    [chanKey(scope, name)]: { scope, name, status, updatedAt: Date.now() },
  };
  if (status === "error" || status === "timeout") {
    pushError(`channel:${scope}`, `${name} → ${status}`);
  }
  emit();
}

export function clearChannel(scope: string, name: string) {
  const key = chanKey(scope, name);
  if (!(key in state.channels)) return;
  const next = { ...state.channels };
  delete next[key];
  state.channels = next;
  emit();
}

// ─── RPC / fetch tracking ──────────────────────────────────────────
export function reportRpcOk() {
  state.lastOkAt = Date.now();
  // Health: ok unless we had a very recent error (<5s ago).
  if (!state.lastErrorAt || Date.now() - state.lastErrorAt > 5000) {
    state.health = "ok";
  } else {
    state.health = "degraded";
  }
  emit();
}

export function reportRpcError(source: string, message: string) {
  pushError(source, message);
  state.lastErrorAt = Date.now();
  state.health = "degraded";
  emit();
}

export function pushError(source: string, message: string) {
  state.errors = [
    { id: nextErrorId++, source, message, at: Date.now() },
    ...state.errors,
  ].slice(0, MAX_ERRORS);
  emit();
}

export function clearErrors() {
  state.errors = [];
  emit();
}

// ─── Realtime socket state ─────────────────────────────────────────
// Poll the underlying socket every second; cheap and avoids depending
// on private SDK events.
let socketTimer: number | null = null;
function startSocketWatcher() {
  if (typeof window === "undefined" || socketTimer !== null) return;
  const map: Record<number, DiagnosticsState["realtime"]> = {
    0: "connecting",
    1: "open",
    2: "closing",
    3: "closed",
  };
  const tick = () => {
    try {
      // @ts-expect-error - private but stable enough for diagnostics
      const ws = supabase.realtime?.conn as WebSocket | undefined;
      const next = ws ? (map[ws.readyState] ?? "unknown") : "unknown";
      if (next !== state.realtime) {
        state.realtime = next;
        emit();
      }
    } catch {
      /* ignore */
    }
  };
  tick();
  socketTimer = window.setInterval(tick, 1000);
}

if (typeof window !== "undefined") startSocketWatcher();

// ─── Active health probe ───────────────────────────────────────────
/** Pings the edge function with a cheap noop call. */
export async function probeHealth(): Promise<void> {
  const t0 = Date.now();
  try {
    const { data, error } = await supabase.functions.invoke("rooms-rpc", {
      body: { fn: "ping", data: {} },
    });
    if (error) throw error;
    void data;
    void t0;
    reportRpcOk();
  } catch (e) {
    reportRpcError("probe", e instanceof Error ? e.message : String(e));
  }
}
