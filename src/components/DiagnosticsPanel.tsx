import { useEffect, useMemo, useState } from "react";
import { Activity, X, Trash2, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  clearErrors,
  getDiagnostics,
  probeHealth,
  subscribeDiagnostics,
  type ChannelStatus,
  type ConnectionHealth,
  type DiagnosticsState,
} from "@/online/diagnostics";

const STORAGE_KEY = "diagnostics-panel-open";

function ago(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 1) return "ara";
  if (s < 60) return `fa ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `fa ${m} min`;
  const h = Math.floor(m / 60);
  return `fa ${h} h`;
}

const HEALTH_COLOR: Record<ConnectionHealth, string> = {
  unknown: "bg-muted text-muted-foreground",
  ok: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  degraded: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  down: "bg-destructive/15 text-destructive border-destructive/40",
};

const CHANNEL_COLOR: Record<ChannelStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  subscribing: "bg-amber-500/15 text-amber-600",
  joined: "bg-emerald-500/15 text-emerald-600",
  closed: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
  timeout: "bg-destructive/15 text-destructive",
};

export function DiagnosticsPanel() {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [state, setState] = useState<DiagnosticsState>(() => getDiagnostics());
  // Re-render every 5s so "fa Xs" labels stay fresh.
  const [, setTick] = useState(0);

  useEffect(() => subscribeDiagnostics(setState), []);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);

  // Keyboard shortcut: Alt+D
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  const channels = useMemo(
    () => Object.values(state.channels).sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name)),
    [state.channels],
  );

  // Floating launcher button. Always visible, bottom-right.
  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        title="Diagnòstic (Alt+D)"
        className={cn(
          "fixed bottom-3 right-3 z-50 inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-medium shadow-md backdrop-blur",
          "border-border/60 bg-background/80 text-foreground hover:bg-background",
          state.health === "degraded" && "border-amber-500/60 text-amber-600",
          state.health === "down" && "border-destructive/60 text-destructive animate-pulse",
        )}
      >
        <Activity className="w-3 h-3" />
        <span>Diag</span>
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            state.health === "ok" && "bg-emerald-500",
            state.health === "degraded" && "bg-amber-500",
            state.health === "down" && "bg-destructive",
            state.health === "unknown" && "bg-muted-foreground/60",
          )}
        />
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-50 w-[min(92vw,360px)] max-h-[80vh] overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-xl backdrop-blur flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Activity className="w-3.5 h-3.5" />
          Diagnòstic online
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label="Tancar"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="overflow-auto p-3 flex flex-col gap-3 text-xs">
        {/* Health summary */}
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-display tracking-widest uppercase text-[10px] text-muted-foreground">
              Servidor
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => probeHealth()}
              className="h-6 px-2 text-[10px]"
            >
              <RefreshCcw className="w-3 h-3 mr-1" /> Provar
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase", HEALTH_COLOR[state.health])}>
              {state.health}
            </span>
            <span className="text-muted-foreground">OK: {ago(state.lastOkAt)}</span>
            <span className="text-muted-foreground">Err: {ago(state.lastErrorAt)}</span>
          </div>
        </section>

        {/* Realtime socket */}
        <section className="flex items-center justify-between">
          <span className="font-display tracking-widest uppercase text-[10px] text-muted-foreground">
            Realtime socket
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              state.realtime === "open" && "bg-emerald-500/15 text-emerald-600 border-emerald-500/40",
              state.realtime === "connecting" && "bg-amber-500/15 text-amber-600 border-amber-500/40",
              state.realtime === "closing" && "bg-amber-500/15 text-amber-600 border-amber-500/40",
              state.realtime === "closed" && "bg-muted text-muted-foreground border-border",
              state.realtime === "unknown" && "bg-muted text-muted-foreground border-border",
            )}
          >
            {state.realtime}
          </span>
        </section>

        {/* Channels */}
        <section className="flex flex-col gap-1.5">
          <span className="font-display tracking-widest uppercase text-[10px] text-muted-foreground">
            Canals ({channels.length})
          </span>
          {channels.length === 0 ? (
            <p className="text-muted-foreground italic">Cap canal actiu</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {channels.map((c) => (
                <li
                  key={`${c.scope}:${c.name}`}
                  className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1"
                >
                  <div className="min-w-0 flex flex-col">
                    <span className="truncate font-mono text-[11px]">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground">{c.scope} · {ago(c.updatedAt)}</span>
                  </div>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase shrink-0", CHANNEL_COLOR[c.status])}>
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Errors */}
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-display tracking-widest uppercase text-[10px] text-muted-foreground">
              Errors recents ({state.errors.length})
            </span>
            {state.errors.length > 0 && (
              <button
                type="button"
                onClick={() => clearErrors()}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3 h-3" /> Buidar
              </button>
            )}
          </div>
          {state.errors.length === 0 ? (
            <p className="text-muted-foreground italic">Cap error registrat</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-48 overflow-auto">
              {state.errors.map((e) => (
                <li key={e.id} className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-destructive">{e.source}</span>
                    <span className="text-[10px] text-muted-foreground">{ago(e.at)}</span>
                  </div>
                  <p className="text-[11px] text-foreground/90 break-words">{e.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[10px] text-muted-foreground/70 text-center">Alt+D per obrir/tancar</p>
      </div>
    </div>
  );
}
