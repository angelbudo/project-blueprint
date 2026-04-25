import { useEffect, useState } from "react";
import {
  getBotDecisions,
  subscribeBotDecisions,
  clearBotDecisions,
  type BotDecisionEntry,
} from "@/game/botDebug";
import { Button } from "@/components/ui/button";
import { Bug, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { BotLearningSummary } from "./BotLearningSummary";

function fmt(n: number | undefined, d = 2): string {
  return typeof n === "number" ? n.toFixed(d) : "—";
}

function envitLegend(
  level: string | number,
  evAccept: number | undefined,
  evReject: number | undefined,
): string {
  // Punts en joc segons nivell de l'envit actual.
  let win: number, lose: number, costRebuig: number, nom: string;
  if (level === 2) {
    nom = "envit"; win = 2; lose = 2; costRebuig = 1;
  } else if (level === 4) {
    nom = "renvit"; win = 4; lose = 4; costRebuig = 2;
  } else {
    nom = "falta-envit"; win = 8; lose = 8; costRebuig = 2;
  }
  const ev1 = fmt(evAccept);
  const ev2 = fmt(evReject);
  return (
    `Nivell ${nom}: si vull, +${win} pts si guanye / −${lose} si perd. ` +
    `Si no vull, perd ${costRebuig} pt segur. ` +
    `EV+ (${ev1}) = pWin·${win} − (1−pWin)·${lose} + bonus truc. ` +
    `EV− (${ev2}) = −${costRebuig}.`
  );
}

function decisionReason(e: BotDecisionEntry): string {
  if (e.kind !== "envit") return "";
  const pWin = e.pWin ?? 0;
  const evA = e.evAccept ?? 0;
  const evR = e.evReject ?? 0;
  const env = e.myEnvit ?? 0;
  const lvl = e.level;

  if (e.decision.startsWith("pujar")) {
    if (lvl === 2) {
      return `Pujo: pWin ${pWin.toFixed(2)} ≥ 0.70 i envit ${env} ≥ 33 (llindar de renvit).`;
    }
    if (lvl === 4) {
      return `Pujo: pWin ${pWin.toFixed(2)} ≥ 0.80 i envit ${env} ≥ 35 (llindar de falta).`;
    }
    return `Pujo: condicions de llindar superades.`;
  }
  if (e.decision === "vull") {
    return `Vull perquè EV+ (${evA.toFixed(2)}) > EV− (${evR.toFixed(2)}).`;
  }
  if (e.decision.startsWith("vull (bluff")) {
    return `Vull (bluff): EV+ (${evA.toFixed(2)}) molt prop d'EV− (${evR.toFixed(2)}); aposta marginal.`;
  }
  // no-vull
  if (evA <= evR) {
    return `No vull: EV+ (${evA.toFixed(2)}) ≤ EV− (${evR.toFixed(2)}); pWin ${pWin.toFixed(2)} insuficient.`;
  }
  return `No vull: pWin ${pWin.toFixed(2)} no arriba al llindar mínim per a este nivell.`;
}

type DebugFilter = "all" | "answer" | "raise";

export function BotDebugPanel() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<DebugFilter>("all");
  const [entries, setEntries] = useState<BotDecisionEntry[]>(getBotDecisions());

  useEffect(() => {
    return subscribeBotDecisions(() => setEntries([...getBotDecisions()]));
  }, []);

  const filtered = entries.filter((e) => {
    if (filter === "all") return true;
    if (filter === "raise") return e.decision.startsWith("pujar");
    // "answer" = vull / no-vull (no pujades)
    return !e.decision.startsWith("pujar");
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-3 right-3 z-[60] rounded-full bg-primary/90 text-primary-foreground p-2 shadow-lg backdrop-blur hover:bg-primary"
        aria-label="Bot debug panel"
        title="Bot debug"
      >
        <Bug className="w-4 h-4" />
      </button>

      {open && (
        <div
          className={cn(
            "fixed bottom-14 right-3 z-[60] w-[min(92vw,380px)] max-h-[70vh]",
            "rounded-lg border border-border bg-background/95 backdrop-blur shadow-xl",
            "flex flex-col text-xs",
          )}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="font-semibold flex items-center gap-1.5">
              <Bug className="w-3.5 h-3.5" /> Decisions del bot
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => clearBotDecisions()}
                title="Buidar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => setOpen(false)}
                title="Tancar"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <BotLearningSummary />

          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/60 text-[10px]">
            {([
              { id: "all", label: "Totes" },
              { id: "answer", label: "Vull / No-vull" },
              { id: "raise", label: "Pujades" },
            ] as { id: DebugFilter; label: string }[]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={cn(
                  "px-2 py-0.5 rounded uppercase tracking-wide transition-colors",
                  filter === opt.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            ))}
            <span className="ml-auto text-muted-foreground">
              {filtered.length}/{entries.length}
            </span>
          </div>

          <div className="overflow-y-auto p-2 space-y-1.5">
            {filtered.length === 0 && (
              <div className="text-muted-foreground text-center py-6">
                Cap decisió encara.
              </div>
            )}
            {filtered.map((e) => {
              const goodEv = (e.evAccept ?? 0) > (e.evReject ?? 0);
              return (
                <div
                  key={e.id}
                  className="rounded border border-border/60 bg-muted/40 p-2 font-mono"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">
                      P{e.player} · {e.kind} · niv {String(e.level)}
                    </span>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide",
                        e.decision.startsWith("vull") || e.decision.startsWith("pujar")
                          ? "bg-primary/20 text-primary"
                          : "bg-destructive/20 text-destructive",
                      )}
                    >
                      {e.decision}
                    </span>
                  </div>
                  {e.kind === "envit" && (
                    <>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                        <span>envit: <b>{e.myEnvit}</b></span>
                        <span>mà: <b>{e.isMano ? "sí" : "no"}</b></span>
                        <span>pWin: <b>{fmt(e.pWin)}</b></span>
                        <span>truc: <b>{fmt(e.trucStrength)}</b></span>
                        <span className={goodEv ? "text-primary" : ""}>
                          EV+: <b>{fmt(e.evAccept)}</b>
                        </span>
                        <span>EV-: <b>{fmt(e.evReject)}</b></span>
                      </div>
                      <div className="mt-1 pt-1 border-t border-border/40 text-[10px] text-foreground/80 leading-snug font-sans">
                        <b>Motiu:</b> {decisionReason(e)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground leading-snug font-sans">
                        {envitLegend(e.level, e.evAccept, e.evReject)}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
