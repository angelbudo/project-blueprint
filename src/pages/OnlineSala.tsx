import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { Button } from "@/components/ui/button";
import { usePlayerIdentity } from "@/hooks/usePlayerIdentity";
import { useAdminPassword } from "@/hooks/useAdminPassword";

import { useRoomRealtime } from "@/online/useRoomRealtime";
import { joinRoom, startMatch, setSeatKind, leaveRoom, adminCloseRoom } from "@/online/rooms.functions";
import type { PlayerId } from "@/game/types";
import { Loader2, Copy, ArrowLeft, Check, ShieldX } from "lucide-react";
import { TableSeatPicker, type SeatInfo } from "@/online/TableSeatPicker";
import { useLobbyPresence } from "@/online/useLobbyPresence";
import { useSendInvite } from "@/online/useInvites";
import { OnlinePlayersList } from "@/online/OnlinePlayersList";
import { toast } from "sonner";

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </main>
  );
}

export default function OnlineSalaPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Sala />
    </ClientOnly>
  );
}

function Sala() {
  const { codi = "" } = useParams<{ codi: string }>();
  const navigate = useNavigate();
  const { deviceId, name, hasName, ready } = usePlayerIdentity();
  const code = codi.toUpperCase();
  const { data, error, loading, refresh } = useRoomRealtime(ready ? code : null, deviceId);
  const { password: adminPassword, isAdmin } = useAdminPassword();

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [closingAdmin, setClosingAdmin] = useState(false);

  const onlinePlayers = useLobbyPresence({
    deviceId,
    name,
    roomCode: code,
    enabled: ready && hasName,
  });
  const sendInvite = useSendInvite({ fromDeviceId: deviceId, fromName: name, code });

  useEffect(() => {
    if (!data || !hasName || joining) return;
    if (data.mySeat != null) return;
    if (data.room.status !== "lobby") return;
    const usedSeats = new Set(data.players.map((p) => p.seat));
    const freeHumanSeats = ([0, 1, 2, 3] as PlayerId[]).filter(
      (s) => data.room.seatKinds[s] === "human" && !usedSeats.has(s),
    );
    if (freeHumanSeats.length !== 1) return;
    setJoining(true);
    joinRoom({ data: { code, deviceId, name, preferredSeat: freeHumanSeats[0] } })
      .then(() => refresh())
      .catch((e) => setJoinError(e instanceof Error ? e.message : String(e)))
      .finally(() => setJoining(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasName, name, deviceId, code, joining]);

  useEffect(() => {
    if (data?.room.status === "playing" && data.mySeat != null) {
      navigate(`/online/partida/${code}`);
    }
    if (data?.room.status === "abandoned") {
      navigate("/online/lobby");
    }
  }, [data, code, navigate]);

  // Si l'amfitrió tanca la pestanya, abandona la taula (beacon)
  const roomIdForUnload = data?.room.id;
  const roomStatusForUnload = data?.room.status;
  const isHostForUnload = data?.room.hostDevice === deviceId;
  useEffect(() => {
    if (!roomIdForUnload || !isHostForUnload || roomStatusForUnload === "finished" || roomStatusForUnload === "abandoned") return;
    const handleUnload = () => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rooms-rpc`;
      const body = JSON.stringify({ fn: "leaveRoom", data: { roomId: roomIdForUnload, deviceId } });
      try {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } catch { /* noop */ }
    };
    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [roomIdForUnload, roomStatusForUnload, isHostForUnload, deviceId]);

  if (!ready || loading) return <Loading />;

  if (error) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 px-5">
        <p className="text-destructive text-sm text-center">{error}</p>
        <Button onClick={() => navigate("/")} variant="outline">Tornar a inici</Button>
      </main>
    );
  }
  if (!data) return <Loading />;

  const { room, players } = data;
  const isHost = room.hostDevice === deviceId;
  const expectedHumans = room.seatKinds.filter((k) => k === "human").length;
  const joinedHumans = players.length;
  const totalSeated = players.length + room.seatKinds.filter((k) => k === "bot").length;
  const tableFull = totalSeated >= 4;
  const canStart = isHost && joinedHumans >= expectedHumans && room.status === "lobby";



  const handlePickSeat = async (seat: PlayerId) => {
    // Si sóc l'amfitrió i el seient és humà i està buit, el converteixo a bot
    if (isHost && room.status === "lobby" && room.seatKinds[seat] === "human" && !players.some((p) => p.seat === seat)) {
      try {
        await setSeatKind({ data: { roomId: room.id, deviceId, seat, kind: "bot" } });
        await refresh();
      } catch (e) {
        setJoinError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    // Si sóc l'amfitrió i toco un seient bot, el torne a humà (lliure)
    if (isHost && room.status === "lobby" && room.seatKinds[seat] === "bot") {
      try {
        await setSeatKind({ data: { roomId: room.id, deviceId, seat, kind: "human" } });
        await refresh();
      } catch (e) {
        setJoinError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (!hasName) { setJoinError("Cal introduir un nom"); return; }
    if (data.mySeat != null) return;
    if (room.seatKinds[seat] !== "human") return;
    if (players.some((p) => p.seat === seat)) return;
    setJoining(true);
    setJoinError(null);
    try {
      await joinRoom({ data: { code, deviceId, name, preferredSeat: seat } });
      await refresh();
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
    } finally {
      setJoining(false);
    }
  };

  const seats: SeatInfo[] = ([0, 1, 2, 3] as PlayerId[]).map((seat) => {
    const kind = room.seatKinds[seat];
    const occupant = players.find((p) => p.seat === seat);
    const isMe = occupant?.deviceId === deviceId;
    const isHostSeat = occupant?.deviceId === room.hostDevice;
    if (kind === "bot") {
      return {
        seat,
        kind,
        occupant: { kind: "bot" },
        selectable: isHost && room.status === "lobby",
      };
    }
    if (occupant) {
      return {
        seat,
        kind,
        occupant: isMe
          ? { kind: "me", name: occupant.name }
          : {
              kind: "human",
              name: occupant.name,
              online: occupant.isOnline,
              lastSeen: occupant.lastSeen,
            },
        isHost: isHostSeat,
        selectable: false,
      };
    }
    return {
      seat,
      kind,
      occupant: { kind: "empty" },
      selectable: room.status === "lobby" && (isHost || (data.mySeat == null && hasName)),
    };
  });


  const handleStart = async () => {
    setStarting(true);
    try {
      await startMatch({ data: { roomId: room.id, deviceId } });
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  const handleCloseTable = async () => {
    try {
      await leaveRoom({ data: { roomId: room.id, deviceId } });
      navigate("/online/lobby");
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-5 py-8">
      <div className="w-full max-w-md flex flex-col gap-5">
        <button type="button" onClick={() => navigate("/")} className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <ArrowLeft className="w-3 h-3" /> Inici
        </button>

        <header className="text-center flex flex-col items-center gap-2">
          <h1 className="font-display font-black italic text-gold text-3xl">Taula</h1>
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-primary/60 bg-background/40 hover:bg-primary/10"
          >
            <span className="font-display font-black text-3xl tracking-[0.3em] text-primary">{code}</span>
            {copied ? <Check className="w-4 h-4 text-team-nos" /> : <Copy className="w-4 h-4 text-primary/70" />}
          </button>
          <p className="text-[11px] text-muted-foreground">Comparteix aquest codi amb els altres jugadors</p>
        </header>

        {!hasName && (
          <section className="wood-surface border-2 border-destructive/50 rounded-2xl p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-foreground">Configura el teu nom per asseure't.</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/ajustes")} className="border-primary/40">
              Ajustes
            </Button>
          </section>
        )}

        <section className="wood-surface border-2 border-primary/40 rounded-2xl p-4 flex flex-col gap-3">
          <div className="text-[11px] font-display tracking-widest uppercase text-primary/85 text-center">
            Seients ({joinedHumans}/{expectedHumans} humans)
          </div>
          {data.mySeat == null && hasName && room.status === "lobby" && !isHost && (
            <p className="text-[11px] text-primary/90 text-center -mt-1">Tria una cadira lliure per asseure't</p>
          )}
          {isHost && room.status === "lobby" && (
            <p className="text-[11px] text-primary/90 text-center -mt-1">
              Toca un seient lliure per posar-hi un <strong>bot</strong>, o un bot per tornar-lo a lliure.
            </p>
          )}
          <TableSeatPicker seats={seats} onSeatClick={handlePickSeat} highlightSeat={data.mySeat} />
          {joining && <p className="text-[11px] text-muted-foreground text-center">Reservant seient…</p>}
        </section>

        {hasName && (
          <OnlinePlayersList
            players={onlinePlayers}
            myDeviceId={deviceId}
            excludeDeviceIds={players.map((p) => p.deviceId)}
            onInvite={
              isHost && room.status === "lobby" && !tableFull
                ? (p) => sendInvite(p.deviceId)
                : undefined
            }
            title="Jugadors connectats"
            emptyLabel="No hi ha més jugadors connectats"
          />
        )}

        <p className="text-[11px] text-muted-foreground text-center">
          Cames a guanyar: <strong className="text-foreground">{room.targetCames}</strong>
        </p>

        {joinError && <p className="text-xs text-destructive text-center">{joinError}</p>}

        {isHost && (
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="h-14 bg-primary text-primary-foreground hover:bg-primary/90 font-display font-bold text-lg gold-glow"
              onClick={handleStart}
              disabled={!canStart || starting}
            >
              {starting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
              {tableFull
                ? "Començar partida"
                : canStart
                  ? "Començar partida"
                  : `Esperant humans (${joinedHumans}/${expectedHumans})`}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={handleCloseTable}
            >
              Tancar taula
            </Button>
          </div>
        )}
        {!isHost && room.status === "lobby" && (
          <p className="text-center text-xs text-muted-foreground">Esperant que l'amfitrió comence la partida…</p>
        )}

        {isAdmin && !isHost && (
          <Button
            type="button"
            variant="outline"
            disabled={closingAdmin}
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={async () => {
              setClosingAdmin(true);
              try {
                await adminCloseRoom({ data: { roomId: room.id, password: adminPassword } });
                toast.success("Taula tancada");
                navigate("/online/lobby");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "No s'ha pogut tancar la taula");
                setClosingAdmin(false);
              }
            }}
          >
            {closingAdmin ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldX className="w-4 h-4 mr-2" />}
            Tancar taula (admin)
          </Button>
        )}
      </div>
    </main>
  );
}
