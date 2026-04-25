import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reportChannel, clearChannel } from "./diagnostics";
import type { ChatMessage, ChatPhraseId } from "@/game/phrases";
import type { PlayerId } from "@/game/types";

const VISIBLE_MS = 4500;

interface ChatRow {
  id: number;
  room_id: string;
  seat: number;
  phrase_id: string;
  created_at: string;
}

/** Subscriu-se als missatges de xat d'una sala i els converteix en
 *  ChatMessage[] perquè <TrucBoard> els puga pintar com a globus. */
export function useRoomChat(roomId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!roomId) { setMessages([]); return; }
    let cancelled = false;

    const addRow = (row: ChatRow) => {
      const msg: ChatMessage = {
        id: `${row.id}`,
        player: row.seat as PlayerId,
        phraseId: row.phrase_id as ChatPhraseId,
        timestamp: new Date(row.created_at).getTime(),
      };
      setMessages((prev) => [
        ...prev.filter((m) => m.player !== msg.player),
        msg,
      ]);
      window.setTimeout(() => {
        if (cancelled) return;
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      }, VISIBLE_MS);
    };

    // Carrega els últims segons (per si l'usuari acaba d'arribar).
    const since = new Date(Date.now() - VISIBLE_MS).toISOString();
    supabase
      .from("room_chat")
      .select("*")
      .eq("room_id", roomId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        for (const r of data as ChatRow[]) addRow(r);
      });

    const chanName = `room-chat-${roomId}`;
    reportChannel("chat", chanName, "subscribing");
    const channel = supabase
      .channel(chanName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_chat", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (cancelled) return;
          addRow(payload.new as ChatRow);
        },
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") reportChannel("chat", chanName, "joined");
        else if (status === "CLOSED") reportChannel("chat", chanName, "closed");
        else if (status === "CHANNEL_ERROR") reportChannel("chat", chanName, "error");
        else if (status === "TIMED_OUT") reportChannel("chat", chanName, "timeout");
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      clearChannel("chat", chanName);
    };
  }, [roomId]);

  return messages;
}
