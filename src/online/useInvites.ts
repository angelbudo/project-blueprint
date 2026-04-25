// Canal d'invitacions 1:1. Cada jugador escolta un canal nomenat pel seu
// deviceId. Qualsevol amfitrió pot enviar-hi un broadcast amb el codi de taula.
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface InvitePayload {
  fromName: string;
  fromDeviceId: string;
  code: string;
}

const EVENT = "invite";

function channelName(deviceId: string) {
  return `invite:${deviceId}`;
}

/** Escolta invitacions dirigides al meu deviceId i mostra toast amb acció. */
export function useIncomingInvites({
  deviceId,
  enabled = true,
}: {
  deviceId: string;
  enabled?: boolean;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled || !deviceId) return;
    const channel = supabase.channel(channelName(deviceId));
    channel
      .on("broadcast", { event: EVENT }, ({ payload }) => {
        const p = payload as InvitePayload;
        if (!p?.code || !p?.fromName) return;
        toast(`${p.fromName} t'invita a jugar`, {
          description: `Taula ${p.code}`,
          duration: 15000,
          action: {
            label: "Acceptar",
            onClick: () => navigate(`/online/sala/${p.code}`),
          },
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId, enabled, navigate]);
}

/** Retorna una funció per enviar invitacions a altres jugadors pel seu deviceId. */
export function useSendInvite({
  fromDeviceId,
  fromName,
  code,
}: {
  fromDeviceId: string;
  fromName: string;
  code: string;
}) {
  const pendingRef = useRef<Set<string>>(new Set());

  const send = useCallback(
    async (targetDeviceId: string) => {
      if (!targetDeviceId || !code || !fromName) return;
      if (pendingRef.current.has(targetDeviceId)) return;
      pendingRef.current.add(targetDeviceId);
      const channel: RealtimeChannel = supabase.channel(channelName(targetDeviceId));
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("timeout")), 4000);
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              window.clearTimeout(timeout);
              resolve();
            }
          });
        });
        await channel.send({
          type: "broadcast",
          event: EVENT,
          payload: {
            fromName,
            fromDeviceId,
            code,
          } satisfies InvitePayload,
        });
        toast.success("Invitació enviada");
      } catch {
        toast.error("No s'ha pogut enviar la invitació");
      } finally {
        // Mantenim el canal uns segons perquè el broadcast arribe, després netegem.
        window.setTimeout(() => {
          supabase.removeChannel(channel);
          pendingRef.current.delete(targetDeviceId);
        }, 1000);
      }
    },
    [fromDeviceId, fromName, code],
  );

  return send;
}
