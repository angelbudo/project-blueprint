import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PlayerId } from "@/game/types";
import type { RoomTextMessage } from "@/online/useRoomTextChat";

const MAX_LEN = 200;

interface TableChatProps {
  messages: RoomTextMessage[];
  mySeat: PlayerId;
  seatNames: Record<PlayerId, string>;
  onSend: (text: string) => Promise<void>;
  /** Si és true, deshabilita l'input i el botó d'enviar (p.ex. en pausa). */
  disabled?: boolean;
}

/** Mini-xat de text lliure que s'incrusta sota les cartes del jugador.
 *  Pensat per a la mesa online — manté l'historial visible i un input
 *  amb límit de 200 caràcters. Auto-scroll al darrer missatge. */
export function TableChat({ messages, mySeat, seatNames, onSend, disabled = false }: TableChatProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="relative z-0 mx-2 mb-2 rounded-lg border border-primary/30 bg-background/80 flex flex-col"
      aria-label="Xat de la mesa"
    >
      <div
        ref={scrollRef}
        className="px-2 py-1.5 max-h-24 overflow-y-auto text-xs space-y-0.5"
      >
        {messages.length === 0 ? (
          <p className="text-muted-foreground italic text-center py-1">
            Encara no hi ha missatges
          </p>
        ) : (
          messages.map((m) => {
            const isMine = m.seat === mySeat;
            return (
              <div key={m.id} className="leading-snug">
                <span
                  className={cn(
                    "font-semibold mr-1",
                    isMine ? "text-primary" : "text-foreground",
                  )}
                >
                  {seatNames[m.seat] ?? `Seient ${m.seat + 1}`}:
                </span>
                <span className="text-foreground/90 break-words">{m.text}</span>
              </div>
            );
          })
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1 border-t border-primary/20 p-1"
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          placeholder={disabled ? "Partida pausada…" : "Escriu un missatge…"}
          maxLength={MAX_LEN}
          disabled={sending || disabled}
          className="h-8 text-xs flex-1 bg-background/80"
          aria-label="Missatge"
        />
        <Button
          type="submit"
          size="sm"
          variant="default"
          disabled={sending || disabled || !text.trim()}
          className="h-8 w-8 p-0 shrink-0"
          aria-label="Enviar"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </form>
    </section>
  );
}
