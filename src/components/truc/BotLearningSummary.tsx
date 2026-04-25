import { useEffect, useState } from "react";
import { usePlayerIdentity } from "@/hooks/usePlayerIdentity";
import { fetchPlayerProfile } from "@/lib/playerProfile";
import { tuningFromProfile, applyDifficulty, NEUTRAL_TUNING, type PlayerProfile, type BotTuning } from "@/game/profileAdaptation";
import { useGameSettings } from "@/lib/gameSettings";
import { Brain, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Read-only summary of what the bot has learned about the human player and
 * how that translates into its current strategy. Lives inside BotDebugPanel.
 */
export function BotLearningSummary() {
  const { deviceId } = usePlayerIdentity();
  const { settings } = useGameSettings();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const p = await fetchPlayerProfile(deviceId);
      if (p) setProfile(p);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => { void reload(); }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const baseTuning = profile ? tuningFromProfile(profile) : NEUTRAL_TUNING;
  const tuning = applyDifficulty(baseTuning, settings.botDifficulty);
  const patterns = describePatterns(profile);
  const adjustments = describeAdjustments(tuning);

  return (
    <div className="border-b border-border/60 bg-muted/30 px-3 py-2 text-[11px] font-sans">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Brain className="w-3.5 h-3.5 text-primary" />
          Aprenentatge recent
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {profile ? `${profile.games_played} partides` : "—"}
          </span>
          <button
            type="button"
            onClick={() => { void reload(); }}
            className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
            title="Refrescar"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {!profile ? (
        <p className="text-muted-foreground italic">Sense dades encara…</p>
      ) : profile.games_played === 0 ? (
        <p className="text-muted-foreground italic">
          Encara no s'ha jugat cap partida completa. El bot juga amb afinació neutra.
        </p>
      ) : (
        <>
          <div className="mb-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
              Patrons detectats
            </div>
            <ul className="space-y-0.5">
              {patterns.map((p, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-primary mt-0.5">·</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
              Estratègia del bot ({settings.botDifficulty})
            </div>
            <ul className="space-y-0.5">
              {adjustments.map((a, i) => (
                <li key={i} className="flex items-start gap-1">
                  <DeltaIcon delta={a.delta} />
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-1.5 pt-1.5 border-t border-border/40 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
            <span>callProp: <b className="text-foreground">{tuning.callPropensity.toFixed(2)}</b></span>
            <span>bluffProp: <b className="text-foreground">{tuning.bluffPropensity.toFixed(2)}</b></span>
            <span>acceptΔ: <b className="text-foreground">{fmtSigned(tuning.acceptThresholdDelta, 1)}</b></span>
            <span>envitΔ: <b className="text-foreground">{fmtSigned(tuning.envitAcceptDelta, 1)}</b></span>
          </div>
        </>
      )}
    </div>
  );
}

function fmtSigned(n: number, d = 2): string {
  return (n >= 0 ? "+" : "") + n.toFixed(d);
}

function DeltaIcon({ delta }: { delta: "up" | "down" | "neutral" }) {
  if (delta === "up") return <TrendingUp className="w-3 h-3 mt-0.5 text-team-nos shrink-0" />;
  if (delta === "down") return <TrendingDown className="w-3 h-3 mt-0.5 text-team-ells shrink-0" />;
  return <Minus className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />;
}

function describePatterns(p: PlayerProfile | null): string[] {
  if (!p) return [];
  const out: string[] = [];

  // Aggressiveness
  if (p.aggressiveness >= 0.65) {
    out.push(`Jugues agressiu: cantes truc/envit sovint (${pct(p.aggressiveness)}).`);
  } else if (p.aggressiveness <= 0.35) {
    out.push(`Jugues conservador: cantes poc (${pct(p.aggressiveness)}).`);
  } else {
    out.push(`Estil equilibrat de cantes (${pct(p.aggressiveness)}).`);
  }

  // Bluff
  if (p.bluff_rate >= 0.3) {
    out.push(`Faroleges molt: ${pct(p.bluff_rate)} dels teus cantes són amb mà fluixa.`);
  } else if (p.bluff_rate <= 0.08) {
    out.push(`Quasi mai faroleges: ${pct(p.bluff_rate)} de faroles.`);
  } else {
    out.push(`Faroles moderats (${pct(p.bluff_rate)}).`);
  }

  // Acceptance
  if (p.accept_threshold >= 0.65) {
    out.push(`Acceptes amb facilitat (${pct(p.accept_threshold)} dels cantes rivals).`);
  } else if (p.accept_threshold <= 0.35) {
    out.push(`Et plieges molt: només acceptes el ${pct(p.accept_threshold)}.`);
  } else {
    out.push(`Acceptes equilibradament (${pct(p.accept_threshold)}).`);
  }

  out.push(`Mostra basada en ${p.games_played} partides recents.`);

  return out;
}

function describeAdjustments(t: BotTuning): { text: string; delta: "up" | "down" | "neutral" }[] {
  const out: { text: string; delta: "up" | "down" | "neutral" }[] = [];

  // callPropensity
  if (t.callPropensity > 1.1) {
    out.push({ text: `Canta més sovint (×${t.callPropensity.toFixed(2)}) — t'aprofita la cautela.`, delta: "up" });
  } else if (t.callPropensity < 0.9) {
    out.push({ text: `Canta menys (×${t.callPropensity.toFixed(2)}) — evita exposar-se a la teua agressivitat.`, delta: "down" });
  } else {
    out.push({ text: `Freqüència de cantes neutra.`, delta: "neutral" });
  }

  // bluffPropensity
  if (t.bluffPropensity > 1.2) {
    out.push({ text: `Bluffeja més (×${t.bluffPropensity.toFixed(2)}) — t'ha vist plegar fàcil.`, delta: "up" });
  } else if (t.bluffPropensity < 0.8) {
    out.push({ text: `Bluffeja menys (×${t.bluffPropensity.toFixed(2)}) — saps detectar faroles.`, delta: "down" });
  } else {
    out.push({ text: `Freqüència de bluffs neutra.`, delta: "neutral" });
  }

  // accept threshold delta (negative = accept easier)
  if (t.acceptThresholdDelta <= -2) {
    out.push({ text: `Accepta truc més fàcilment (Δ${t.acceptThresholdDelta.toFixed(1)}) — sospita dels teus faroles.`, delta: "up" });
  } else if (t.acceptThresholdDelta >= 2) {
    out.push({ text: `Exigeix més per acceptar truc (Δ+${t.acceptThresholdDelta.toFixed(1)}) — respecta els teus cantes.`, delta: "down" });
  } else {
    out.push({ text: `Llindar d'acceptar truc neutre.`, delta: "neutral" });
  }

  // envit accept delta
  if (t.envitAcceptDelta >= 0.8) {
    out.push({ text: `Accepta envits més lleugers (Δ+${t.envitAcceptDelta.toFixed(1)}) — sap que sovint vas de farol.`, delta: "up" });
  } else if (t.envitAcceptDelta <= -0.8) {
    out.push({ text: `Demana més fort per acceptar envit (Δ${t.envitAcceptDelta.toFixed(1)}).`, delta: "down" });
  } else {
    out.push({ text: `Marge d'acceptar envit neutre.`, delta: "neutral" });
  }

  return out;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
