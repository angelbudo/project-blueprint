import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { Button } from "@/components/ui/button";
import { usePlayerIdentity } from "@/hooks/usePlayerIdentity";

import { joinRoom, listLobbyRooms, adminCloseRoom, type LobbyRoomDTO } from "@/online/rooms.functions";
import { TableSeatPicker, type SeatInfo } from "@/online/TableSeatPicker";
import type { PlayerId } from "@/game/types";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Loader2, Plus, RefreshCw, Settings, ShieldX } from "lucide-react";
import { useLobbyPresence } from "@/online/useLobbyPresence";
import { OnlinePlayersList } from "@/online/OnlinePlayersList";
import { useAdminPassword } from "@/hooks/useAdminPassword";
import { toast } from "sonner";

const VISIBLE_TABLES = 4;

function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </main>
  );
}

export default function OnlineLobbyPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Lobby />
    </ClientOnly>
  );
}

function Lobby() {
  const navigate = useNavigate();
  const { deviceId, name, hasName, ready } = usePlayerIdentity();
  const { password: adminPassword, isAdmin } = useAdminPassword();
  const [rooms, setRooms] = useState<LobbyRoomDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  const onlinePlayers = useLobbyPresence({
    deviceId,
    name,
    roomCode: null,
    enabled: ready && hasName,
  });

  const handleAdminClose = useCallback(async (roomId: string) => {
    setClosingId(roomId);
    try {
      await adminCloseRoom({ data: { roomId, password: adminPassword } });
      toast.success("Taula tancada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No s'ha pogut tancar la taula");
    } finally {
      setClosingId(null);
    }
  }, [adminPassword]);

  const refresh = useCallback(async () => {
    try {
      const { rooms } = await listLobbyRooms({ data: {} });
      setRooms(rooms);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de connexió");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("lobby-rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players" }, () => refresh())
      .subscribe();
    const interval = window.setInterval(refresh, 15000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [refresh]);

  // Mostrem taules en lobby amb seients lliures + taules jugant (plenes, no unibles).
  const visibleRooms = useMemo(
    () => rooms.filter((r) => {
      if (r.status === "playing") return true;
      if (r.status !== "lobby") return false;
      const usedSeats = new Set(r.players.map((p) => p.seat));
      return r.seatKinds.some((k, i) => k === "human" && !usedSeats.has(i as PlayerId));
    }),
    [rooms],
  );
  const joinable = useMemo(() => visibleRooms.filter((r) => r.status === "lobby"), [visibleRooms]);
  const visible = useMemo(() => visibleRooms.slice(0, VISIBLE_TABLES), [visibleRooms]);

  const handleJoinSeat = async (room: LobbyRoomDTO, seat: PlayerId) => {
    if (!hasName) {
      setError("Cal configurar el teu nom a Ajustes abans d'unir-te");
      return;
    }
    if (room.seatKinds[seat] !== "human") {
      setError("Eixe seient no està disponible per a humans");
      return;
    }
    setJoiningCode(room.code);
    setError(null);
    try {
      await joinRoom({ data: { code: room.code, deviceId, name, preferredSeat: seat } });
      navigate(`/online/sala/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No s'ha pogut unir");
      setJoiningCode(null);
    }
  };

  if (!ready || loading) return <Loading />;

  return (
    <main className="min-h-screen flex flex-col items-center px-5 py-8">
      <div className="w-full max-w-3xl flex flex-col gap-5">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="w-3 h-3" /> Inici
        </button>

        <header className="text-center">
          <h1 className="font-display font-black italic text-gold text-3xl">Taules disponibles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Toca un seient lliure per unir-te a la partida.
          </p>
        </header>

        {!hasName && (
          <section className="wood-surface border-2 border-destructive/50 rounded-2xl p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-foreground">Cal configurar el teu nom abans d'unir-te.</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/ajustes")} className="border-primary/40">
              <Settings className="w-3 h-3 mr-1" /> Ajustes
            </Button>
          </section>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            className="border-primary/40 text-primary hover:bg-primary/10"
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Refrescar
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("/online/nou")}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4 mr-1" /> Crear nova
          </Button>
        </div>

        {error && <p className="text-xs text-destructive text-center">{error}</p>}

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible.length === 0 ? (
            <div className="col-span-full flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : (
            visible.map((room, i) => (
              <TableCard
                key={room.id}
                index={i}
                room={room}
                myDeviceId={deviceId}
                joining={joiningCode === room.code}
                onSeatClick={(seat) => handleJoinSeat(room, seat)}
                isAdmin={isAdmin}
                closing={closingId === room.id}
                onAdminClose={() => handleAdminClose(room.id)}
              />
            ))
          )}
        </section>

        {hasName && (
          <OnlinePlayersList
            players={onlinePlayers}
            myDeviceId={deviceId}
            title="Jugadors connectats al lobby"
            emptyLabel="Ningú més connectat ara mateix"
          />
        )}

        <p className="text-[10px] text-muted-foreground/70 text-center">
          {joinable.length} taul{joinable.length === 1 ? "a" : "es"} amb seients lliures
          {visibleRooms.length - joinable.length > 0 ? ` · ${visibleRooms.length - joinable.length} en joc` : ""}
        </p>
      </div>
    </main>
  );
}

function TableCard({
  index: _index,
  room,
  myDeviceId: _myDeviceId,
  joining,
  onSeatClick,
  isAdmin = false,
  closing = false,
  onAdminClose,
}: {
  index: number;
  room: LobbyRoomDTO;
  myDeviceId: string;
  joining: boolean;
  onSeatClick: (seat: PlayerId) => void;
  isAdmin?: boolean;
  closing?: boolean;
  onAdminClose?: () => void;
}) {

  const isPlaying = room.status === "playing";
  const playersBySeat = new Map(room.players.map((p) => [p.seat, p]));
  const seats: SeatInfo[] = ([0, 1, 2, 3] as PlayerId[]).map((s) => {
    const kind = room.seatKinds[s];
    const player = playersBySeat.get(s);
    if (kind === "bot") {
      return { seat: s, kind, occupant: { kind: "bot" }, selectable: false };
    }
    if (player) {
      return {
        seat: s,
        kind,
        occupant: { kind: "human", name: player.name, online: player.isOnline },
        isHost: false,
        selectable: false,
      };
    }
    return {
      seat: s,
      kind,
      occupant: { kind: "empty" },
      selectable: !isPlaying && kind === "human" && joining === false,
    };
  });

  const humansJoined = room.players.length;
  const humanSeats = room.seatKinds.filter((k) => k === "human").length;

  return (
    <div className={`wood-surface border-2 rounded-2xl p-3 flex flex-col gap-2 ${isPlaying ? "border-muted/40 opacity-70" : "border-primary/40"}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-display tracking-widest uppercase text-primary/85">
          Taula {room.code}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {isPlaying ? (
            <span className="text-destructive font-semibold uppercase">En joc</span>
          ) : (
            <>{humansJoined}/{humanSeats} humans · {room.targetCames} cam{room.targetCames === 1 ? "a" : "es"}</>
          )}
        </span>
      </div>
      <TableSeatPicker seats={seats} onSeatClick={onSeatClick} showTeams={false} />
      {isPlaying && (
        <div className="text-[10px] text-muted-foreground text-center uppercase tracking-wider">
          Partida en curs · no es pot unir
        </div>
      )}
      {joining && (
        <div className="flex items-center justify-center gap-2 text-xs text-primary">
          <Loader2 className="w-3 h-3 animate-spin" /> Unint-te…
        </div>
      )}
      {isAdmin && onAdminClose && (
        <Button
          size="sm"
          variant="outline"
          onClick={onAdminClose}
          disabled={closing}
          className="border-destructive/50 text-destructive hover:bg-destructive/10 h-8 text-[11px]"
        >
          {closing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ShieldX className="w-3 h-3 mr-1" />}
          Tancar (admin)
        </Button>
      )}
    </div>
  );
}
