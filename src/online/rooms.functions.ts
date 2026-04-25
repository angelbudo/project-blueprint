// Client-side wrapper for rooms server functions.
// Calls the `rooms-rpc` edge function with { fn, data } body.
import { supabase } from "@/integrations/supabase/client";
import type { PlayerId } from "@/game/types";
import type { Action } from "@/game/types";
import type { RoomFullDTO, SeatKind } from "./types";
import type { ChatPhraseId } from "@/game/phrases";
import { reportRpcError, reportRpcOk } from "./diagnostics";

async function rpc<T>(fn: string, data: unknown): Promise<T> {
  try {
    const { data: result, error } = await supabase.functions.invoke("rooms-rpc", {
      body: { fn, data },
    });
    if (error) {
      // Try to extract message from edge function response body
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const j = await ctx.json();
          if (j?.error) throw new Error(j.error);
        } catch (e) {
          if (e instanceof Error && e.message && e.message !== "Unexpected end of JSON input") throw e;
        }
      }
      throw new Error(error.message || "Error de connexió");
    }
    if (result && typeof result === "object" && "error" in result && (result as any).error) {
      throw new Error((result as any).error);
    }
    reportRpcOk();
    return result as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    reportRpcError(`rpc:${fn}`, msg);
    throw e;
  }
}

/**
 * The original TanStack Start `serverFn` exposed handlers as
 * `someFn({ data: {...} })`. We replicate that signature here so that the
 * existing call sites do not need to change.
 */
function makeFn<I, O>(fn: string) {
  return ({ data }: { data: I }) => rpc<O>(fn, data);
}

export interface CreateRoomInput {
  hostDevice: string;
  hostName: string;
  targetCames: number;
  initialMano: PlayerId;
  seatKinds: SeatKind[];
  hostSeat: PlayerId;
}
export const createRoom = makeFn<CreateRoomInput, { code: string; roomId: string }>("createRoom");

export interface JoinRoomInput {
  code: string;
  deviceId: string;
  name: string;
  preferredSeat?: PlayerId | null;
}
export const joinRoom = makeFn<JoinRoomInput, { roomId: string; code: string; seat: PlayerId }>("joinRoom");

export interface GetRoomInput {
  code: string;
  deviceId?: string | null;
}
export const getRoom = makeFn<GetRoomInput, RoomFullDTO>("getRoom");

export interface StartMatchInput {
  roomId: string;
  deviceId: string;
}
export const startMatch = makeFn<StartMatchInput, { ok: true }>("startMatch");

export interface SubmitActionInput {
  roomId: string;
  deviceId: string;
  action: Action;
}
export const submitAction = makeFn<SubmitActionInput, { ok: true }>("submitAction");

export interface UpdatePlayerNameInput {
  roomId: string;
  deviceId: string;
  name: string;
}
export const updatePlayerName = makeFn<UpdatePlayerNameInput, { ok: true }>("updatePlayerName");

export interface HeartbeatInput {
  roomId: string;
  deviceId: string;
}
export const heartbeat = makeFn<HeartbeatInput, { ok: true }>("heartbeat");

export interface SetSeatKindInput {
  roomId: string;
  deviceId: string;
  seat: PlayerId;
  kind: SeatKind;
}
export const setSeatKind = makeFn<SetSeatKindInput, { ok: true }>("setSeatKind");

export interface LeaveRoomInput {
  roomId: string;
  deviceId: string;
}
export const leaveRoom = makeFn<LeaveRoomInput, { ok: true; abandoned?: boolean }>("leaveRoom");

export interface LobbyRoomDTO {
  id: string;
  code: string;
  status: "lobby" | "playing" | "finished" | "abandoned";
  targetCames: number;
  seatKinds: SeatKind[];
  hostDevice: string;
  players: { seat: PlayerId; name: string; isOnline: boolean }[];
}
export const listLobbyRooms = makeFn<Record<string, never>, { rooms: LobbyRoomDTO[] }>("listLobbyRooms");

export interface SendChatPhraseInput {
  roomId: string;
  deviceId: string;
  phraseId: ChatPhraseId;
}
export const sendChatPhrase = makeFn<SendChatPhraseInput, { ok: true }>("sendChatPhrase");

export interface SendTextMessageInput {
  roomId: string;
  deviceId: string;
  text: string;
}
export const sendTextMessage = makeFn<SendTextMessageInput, { ok: true }>("sendTextMessage");

export interface AdminCloseRoomInput {
  roomId: string;
  password: string;
}
export const adminCloseRoom = makeFn<AdminCloseRoomInput, { ok: true }>("adminCloseRoom");

export interface MyActiveRoomDTO {
  id: string;
  code: string;
  status: "playing";
  targetCames: number;
  updatedAt: string;
  mySeat: PlayerId | null;
}
export const listMyActiveRooms = makeFn<{ deviceId: string }, { rooms: MyActiveRoomDTO[] }>(
  "listMyActiveRooms",
);

export interface SetPausedInput {
  roomId: string;
  deviceId: string;
  paused: boolean;
}
export const setPaused = makeFn<SetPausedInput, { ok: true; paused: boolean }>("setPaused");
