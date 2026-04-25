// Canal de presència global per a jugadors online.
// Usa Supabase Realtime Presence: cada client publica la seua identitat i
// veu la resta de jugadors connectats. La neteja és automàtica en desconnectar.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface OnlinePlayer {
  deviceId: string;
  name: string;
  /** Codi de la taula on està assegut, si n'hi ha. */
  roomCode: string | null;
}

interface PresenceState {
  deviceId: string;
  name: string;
  roomCode: string | null;
  joinedAt: number;
}

const CHANNEL_NAME = "lobby:presence";

export function useLobbyPresence({
  deviceId,
  name,
  roomCode = null,
  enabled = true,
}: {
  deviceId: string;
  name: string;
  roomCode?: string | null;
  enabled?: boolean;
}): OnlinePlayer[] {
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);

  useEffect(() => {
    if (!enabled || !deviceId || !name) {
      setPlayers([]);
      return;
    }
    const channel = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: deviceId } },
    });

    const syncPlayers = () => {
      const state = channel.presenceState<PresenceState>();
      const seen = new Map<string, OnlinePlayer>();
      for (const [key, metas] of Object.entries(state)) {
        const meta = metas[0];
        if (!meta || !meta.name) continue;
        seen.set(key, {
          deviceId: meta.deviceId ?? key,
          name: meta.name,
          roomCode: meta.roomCode ?? null,
        });
      }
      setPlayers(Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)));
    };

    channel
      .on("presence", { event: "sync" }, syncPlayers)
      .on("presence", { event: "join" }, syncPlayers)
      .on("presence", { event: "leave" }, syncPlayers)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            deviceId,
            name,
            roomCode,
            joinedAt: Date.now(),
          } satisfies PresenceState);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, name, roomCode, enabled]);

  return players;
}
