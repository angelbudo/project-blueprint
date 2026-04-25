import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getRoom, heartbeat } from "./rooms.functions";
import { reportChannel, clearChannel } from "./diagnostics";
import type { RoomDTO, RoomFullDTO, RoomPlayerDTO, SeatKind } from "./types";
import type { MatchState, PlayerId } from "@/game/types";

/**
 * Masks other players' hands with placeholder cards that are stable across
 * renders. Keeps `state.round` referentially equal when the hands (by count)
 * haven't actually changed for any seat — this lets React.memo and keyed
 * children avoid unnecessary work when a single move arrives.
 */
function maskMatchStateForSeat(state: MatchState, mySeat: PlayerId | null, prev: MatchState | null): MatchState {
  const hands = state.round.hands;
  const prevHands = prev?.round.hands;
  const masked: MatchState["round"]["hands"] = { 0: [], 1: [], 2: [], 3: [] };
  let handsChanged = false;
  for (const p of [0, 1, 2, 3] as PlayerId[]) {
    if (p === mySeat) {
      masked[p] = hands[p];
      if (!prevHands || prevHands[p] !== hands[p]) handsChanged = true;
      continue;
    }
    const len = hands[p].length;
    const prevMasked = prevHands?.[p];
    if (prevMasked && prevMasked.length === len) {
      // Reuse prior placeholder array so references stay stable.
      masked[p] = prevMasked;
    } else {
      masked[p] = Array.from({ length: len }, (_, i) => ({
        id: `hidden-${p}-${i}`,
        suit: "oros" as const,
        rank: 1 as const,
      }));
      handsChanged = true;
    }
  }
  const round = handsChanged ? { ...state.round, hands: masked } : { ...state.round, hands: prev!.round.hands };
  return { ...state, round };
}

interface RoomRowPayload {
  id: string;
  code: string;
  status: RoomDTO["status"];
  target_cames: number;
  initial_mano: number;
  seat_kinds: SeatKind[];
  host_device: string;
  match_state: MatchState | null;
  turn_started_at: string | null;
  paused_at: string | null;
}

/**
 * Subscribe a la sala via Supabase Realtime. Quan arriba una nova versió de la
 * fila `rooms` apliquem el `match_state` nou directament sobre el DTO actual
 * (mantenint jugadors i mySeat), evitant una crida extra al servidor i deixant
 * que els components animin el moviment en lloc de re-renderitzar-se sencer.
 * Els canvis a `room_players` (unions, noms, presència) sí que disparen
 * `getRoom` perquè cal la llista d'ocupants autoritativa. Les insercions a
 * `room_actions` es descarten: el state final ja arriba pel canvi a `rooms`.
 */
export function useRoomRealtime(code: string | null, deviceId: string) {
  const [data, setData] = useState<RoomFullDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dataRef = useRef<RoomFullDTO | null>(null);
  dataRef.current = data;

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const dto = await getRoom({ data: { code, deviceId: deviceId || null } });
      setData(dto);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, deviceId]);

  // Apply a server-pushed `rooms` row without re-fetching. Keeps `players`
  // and `mySeat` as-is (they live on the other table) so downstream memoised
  // components see identity-stable references for unchanged branches.
  const applyRoomRow = useCallback((row: RoomRowPayload) => {
    const prev = dataRef.current;
    if (!prev) return;
    if (row.id !== prev.room.id) return;
    const prevState = prev.room.matchState;
    const nextState = row.match_state
      ? maskMatchStateForSeat(row.match_state, prev.mySeat, prevState)
      : null;
    const seatKindsChanged =
      row.seat_kinds.length !== prev.room.seatKinds.length ||
      row.seat_kinds.some((k, i) => k !== prev.room.seatKinds[i]);
    const nextRoom: RoomDTO = {
      id: row.id,
      code: row.code,
      status: row.status,
      targetCames: row.target_cames,
      initialMano: row.initial_mano as PlayerId,
      seatKinds: seatKindsChanged ? row.seat_kinds : prev.room.seatKinds,
      hostDevice: row.host_device,
      matchState: nextState,
      turnStartedAt: row.turn_started_at ?? null,
      pausedAt: row.paused_at ?? null,
    };
    const nextDTO: RoomFullDTO = {
      room: nextRoom,
      players: prev.players,
      mySeat: prev.mySeat,
    };
    setData(nextDTO);
  }, []);

  useEffect(() => {
    if (!code) { setLoading(false); return; }
    let cancelled = false;
    refresh();

    const chanName = `room-${code}`;
    const channel = supabase.channel(chanName);
    reportChannel("room", chanName, "subscribing");
    channel
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as RoomRowPayload | null;
          if (!row) return;
          // Fast path: patch local state using the row we just received.
          applyRoomRow(row);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rooms" },
        () => {
          if (!cancelled) refresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players" },
        () => {
          // Player list (seat assignments, presence, names) isn't in the
          // rooms row — we need an authoritative fetch here.
          if (!cancelled) refresh();
        },
      )
      // room_actions inserts are ignored: the authoritative state update
      // arrives via the `rooms` row that immediately follows.
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") reportChannel("room", chanName, "joined");
        else if (status === "CLOSED") reportChannel("room", chanName, "closed");
        else if (status === "CHANNEL_ERROR") reportChannel("room", chanName, "error");
        else if (status === "TIMED_OUT") reportChannel("room", chanName, "timeout");
      });

    const heartbeatTimer = window.setInterval(() => {
      const roomId = dataRef.current?.room.id;
      if (roomId && deviceId) heartbeat({ data: { roomId, deviceId } }).catch(() => {});
    }, 15000);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      clearChannel("room", chanName);
      window.clearInterval(heartbeatTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, deviceId]);

  return { data, error, loading, refresh };
}

// re-export to avoid circular util usage above
export type { RoomFullDTO, RoomPlayerDTO };
