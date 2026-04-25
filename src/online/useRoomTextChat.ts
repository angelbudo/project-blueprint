import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reportChannel, clearChannel } from "./diagnostics";
import type { PlayerId } from "@/game/types";

export interface RoomTextMessage {
  id: number;
  seat: PlayerId;
  text: string;
  createdAt: number;
}

interface Row {
  id: number;
  room_id: string;
  seat: number;
  text: string;
  created_at: string;
}

const MAX_MESSAGES = 50;

/** Subscriu-se als missatges de text lliure d'una sala. Manté un buffer
 *  acumulatiu (no com el de frases, que es buida amb temporitzador). */
export function useRoomTextChat(roomId: string | null) {
  const [messages, setMessages] = useState<RoomTextMessage[]>([]);

  useEffect(() => {
    if (!roomId) { setMessages([]); return; }
    let cancelled = false;

    const toMsg = (r: Row): RoomTextMessage => ({
      id: r.id,
      seat: r.seat as PlayerId,
      text: r.text,
      createdAt: new Date(r.created_at).getTime(),
    });

    supabase
      .from("room_text_chat")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(MAX_MESSAGES)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setMessages((data as Row[]).map(toMsg));
      });

    const chanName = `room-text-chat-${roomId}`;
    reportChannel("text-chat", chanName, "subscribing");
    const channel = supabase
      .channel(chanName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_text_chat", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (cancelled) return;
          const msg = toMsg(payload.new as Row);
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            const next = [...prev, msg];
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
          });
        },
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") reportChannel("text-chat", chanName, "joined");
        else if (status === "CLOSED") reportChannel("text-chat", chanName, "closed");
        else if (status === "CHANNEL_ERROR") reportChannel("text-chat", chanName, "error");
        else if (status === "TIMED_OUT") reportChannel("text-chat", chanName, "timeout");
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      clearChannel("text-chat", chanName);
    };
  }, [roomId]);

  return messages;
}
