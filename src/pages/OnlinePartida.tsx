import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { Button } from "@/components/ui/button";
import { usePlayerIdentity } from "@/hooks/usePlayerIdentity";
import { useRoomRealtime } from "@/online/useRoomRealtime";
import { submitAction, sendChatPhrase, sendTextMessage, setPaused } from "@/online/rooms.functions";
import { useRoomChat } from "@/online/useRoomChat";
import { useRoomTextChat } from "@/online/useRoomTextChat";
import { legalActions } from "@/game/engine";
import { computeShoutDisplay } from "@/game/shoutDisplay";
import { useShoutFlash } from "@/game/useShoutFlash";
import type { Action, MatchState, PlayerId } from "@/game/types";
import type { ChatPhraseId } from "@/game/phrases";
import { TrucBoard } from "@/components/truc/TrucBoard";
import { TableChat } from "@/components/truc/TableChat";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useGameSettings, type TurnTimeoutSec } from "@/lib/gameSettings";
import { getPresenceStatus, type PresenceStatus } from "@/online/presence";

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </main>
  );
}

export default function OnlinePartidaPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <PartidaOnline />
    </ClientOnly>
  );
}

function PartidaOnline() {
  const { codi = "" } = useParams<{ codi: string }>();
  const navigate = useNavigate();
  const { deviceId, ready } = usePlayerIdentity();
  const code = codi.toUpperCase();
  const { data, error, loading } = useRoomRealtime(ready ? code : null, deviceId);
  const [submitting, setSubmitting] = useState(false);
  const chatMessages = useRoomChat(data?.room.id ?? null);
  const textMessages = useRoomTextChat(data?.room.id ?? null);
  const { settings, update } = useGameSettings();

  const state = data?.room.matchState ?? null;
  const mySeat = data?.mySeat ?? null;
  const players = data?.players;
  const seatKinds = data?.room.seatKinds;

  // Derived values — memoised against the exact inputs the board needs, so
  // unrelated updates (e.g. a player presence flip) don't rebuild them.
  const myActions = useMemo<Action[]>(
    () => (state && mySeat != null ? legalActions(state, mySeat) : []),
    [state, mySeat],
  );

  // Mateixa font de veritat que la partida offline: tots els carteles
  // (truc, envit, V/X, família, acceptat) es deriven del MatchState.
  const display = useMemo(
    () => state ? computeShoutDisplay(state) : null,
    [state],
  );
  // Flash transitori del cant (1.6s), derivat del log. Mateix hook que offline.
  const shoutFlash = useShoutFlash(state);

  const seatNames = useMemo(() => {
    if (mySeat == null || !players || !seatKinds) {
      return { bottom: "", right: "", top: "", left: "" };
    }
    const nameOf = (seat: PlayerId): string => {
      const occupant = players.find((p) => p.seat === seat);
      if (occupant) return occupant.name;
      return seatKinds[seat] === "bot" ? `Bot ${seat + 1}` : `Seient ${seat + 1}`;
    };
    return {
      bottom: nameOf(mySeat),
      right: nameOf(((mySeat + 1) % 4) as PlayerId),
      top: nameOf(((mySeat + 2) % 4) as PlayerId),
      left: nameOf(((mySeat + 3) % 4) as PlayerId),
    };
  }, [mySeat, players, seatKinds]);

  const dealKey = useMemo(() => {
    if (!state) return null;
    const r = state.round;
    const fullHands = r.hands[0].length + r.hands[1].length + r.hands[2].length + r.hands[3].length;
    const noPlays = r.tricks.length === 1 && r.tricks[0].cards.length === 0;
    return fullHands === 12 && noPlays
      ? `online-${state.history.length}-${state.cames}-${r.mano}`
      : null;
  }, [state]);

  // Re-evaluate derived presence every 10s so seats fade to "away"/"offline"
  // even when no realtime event arrives between heartbeats.
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPresenceTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const { seatPresence, seatPresenceLastSeen } = useMemo(() => {
    const presence: Record<PlayerId, PresenceStatus | null> = { 0: null, 1: null, 2: null, 3: null };
    const lastSeen: Record<PlayerId, string | null> = { 0: null, 1: null, 2: null, 3: null };
    if (!players || !seatKinds) return { seatPresence: presence, seatPresenceLastSeen: lastSeen };
    const now = Date.now();
    for (const seat of [0, 1, 2, 3] as PlayerId[]) {
      if (seatKinds[seat] !== "human") continue;
      const occupant = players.find((p) => p.seat === seat);
      if (!occupant) {
        presence[seat] = "offline";
        continue;
      }
      presence[seat] = getPresenceStatus(occupant.isOnline, occupant.lastSeen, now);
      lastSeen[seat] = occupant.lastSeen;
    }
    return { seatPresence: presence, seatPresenceLastSeen: lastSeen };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, seatKinds, presenceTick]);

  if (!ready || loading) return <Loading />;
  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 px-5">
        <p className="text-destructive text-sm text-center">{error}</p>
        <Button onClick={() => navigate("/")} variant="outline">Tornar a inici</Button>
      </main>
    );
  }
  if (!data || !state) return <Loading />;

  if (mySeat == null) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 px-5">
        <p className="text-sm text-muted-foreground text-center">No estàs en aquesta partida.</p>
        <Button onClick={() => navigate(`/online/sala/${code}`)} variant="outline">Entrar a la sala</Button>
      </main>
    );
  }

  const dispatchAction = async (_player: PlayerId, action: Action) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitAction({ data: { roomId: data.room.id, deviceId, action } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSay = async (phraseId: ChatPhraseId) => {
    try {
      await sendChatPhrase({ data: { roomId: data.room.id, deviceId, phraseId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSendText = async (text: string) => {
    try {
      await sendTextMessage({ data: { roomId: data.room.id, deviceId, text } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePauseToggle = async (next: boolean) => {
    try {
      await setPaused({ data: { roomId: data.room.id, deviceId, paused: next } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const seatNamesBySeat: Record<PlayerId, string> = {
    0: "", 1: "", 2: "", 3: "",
  };
  if (players && seatKinds) {
    for (const seat of [0, 1, 2, 3] as PlayerId[]) {
      const occupant = players.find((p) => p.seat === seat);
      seatNamesBySeat[seat] = occupant
        ? occupant.name
        : seatKinds[seat] === "bot" ? `Bot ${seat + 1}` : `Seient ${seat + 1}`;
    }
  }

  return (
    <TrucBoard
      match={state as MatchState}
      humanActions={myActions}
      dispatch={dispatchAction}
      shoutFlash={shoutFlash}
      lastShoutByPlayer={display!.lastShoutByPlayer}
      shoutLabelByPlayer={display!.shoutLabelByPlayer}
      acceptedShoutByPlayer={display!.acceptedShoutByPlayer}
      shoutFamilyByPlayer={display!.shoutFamilyByPlayer}
      envitShoutByPlayer={display!.envitShoutByPlayer}
      envitShoutLabelByPlayer={display!.envitShoutLabelByPlayer}
      envitOutcomeByPlayer={display!.envitOutcomeByPlayer}
      messages={chatMessages}
      onSay={handleSay}
      onNewGame={() => navigate("/")}
      onAbandon={() => navigate("/")}
      perspectiveSeat={mySeat}
      seatNames={seatNames}
      dealKey={dealKey}
      showBotDebug={false}
      belowHandSlot={
        <TableChat
          messages={textMessages}
          mySeat={mySeat}
          seatNames={seatNamesBySeat}
          onSend={handleSendText}
        />
      }
      turnTimeoutSec={settings.turnTimeoutSec}
      onChangeTurnTimeoutSec={(sec: TurnTimeoutSec) => update({ turnTimeoutSec: sec })}
      turnAnchorAt={data.room.turnStartedAt}
      seatPresence={seatPresence}
      seatPresenceLastSeen={seatPresenceLastSeen}
      onPauseToggle={handlePauseToggle}
      paused={data.room.pausedAt != null}
    />
  );
}
