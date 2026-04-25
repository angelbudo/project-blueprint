import { useState, useCallback } from "react";
import { PlayerId } from "@/game/types";
import { ChatMessage, ChatPhraseId } from "@/game/phrases";

const DEFAULT_MESSAGE_DURATION_MS = 4500;

export function usePlayerChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const say = useCallback((
    player: PlayerId,
    phraseId: ChatPhraseId,
    durationMs: number = DEFAULT_MESSAGE_DURATION_MS,
    vars?: Record<string, string | number>,
  ) => {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      player,
      phraseId,
      timestamp: Date.now(),
      vars,
    };
    setMessages(prev => [...prev.filter(m => m.player !== player), msg]);
    window.setTimeout(() => {
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    }, durationMs);
  }, []);

  return { messages, say };
}
