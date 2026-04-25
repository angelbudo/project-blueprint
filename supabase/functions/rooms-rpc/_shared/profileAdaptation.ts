// Mirror of src/game/profileAdaptation.ts for the edge function.
export interface PlayerProfile {
  device_id?: string;
  games_played: number;
  aggressiveness: number;
  bluff_rate: number;
  accept_threshold: number;
}

export interface BotTuning {
  callPropensity: number;
  bluffPropensity: number;
  acceptThresholdDelta: number;
  envitAcceptDelta: number;
  consultRate: number;
  /** Conservative-mode hard rule for envit acceptance (see client mirror). */
  conservativeMode?: boolean;
}

export const NEUTRAL_TUNING: BotTuning = {
  callPropensity: 1,
  bluffPropensity: 1,
  acceptThresholdDelta: 0,
  envitAcceptDelta: 0,
  consultRate: 1,
  conservativeMode: false,
};

export type BotDifficulty = "conservative" | "balanced" | "aggressive";
export const DEFAULT_DIFFICULTY: BotDifficulty = "conservative";

export function applyDifficulty(t: BotTuning, d: BotDifficulty | null | undefined): BotTuning {
  if (!d || d === "balanced") return { ...t, conservativeMode: false };
  if (d === "conservative") {
    return {
      callPropensity: Math.max(0.4, t.callPropensity * 0.7),
      bluffPropensity: t.bluffPropensity,
      acceptThresholdDelta: t.acceptThresholdDelta + 10,
      envitAcceptDelta: t.envitAcceptDelta - 4,
      consultRate: Math.min(2, t.consultRate * 1.8),
      conservativeMode: true,
    };
  }
  return {
    callPropensity: Math.min(2, t.callPropensity * 1.2),
    bluffPropensity: t.bluffPropensity,
    acceptThresholdDelta: t.acceptThresholdDelta - 7,
    envitAcceptDelta: t.envitAcceptDelta + 2,
    consultRate: Math.max(0.25, t.consultRate * 0.45),
    conservativeMode: false,
  };
}

function influence(gamesPlayed: number): number {
  if (gamesPlayed <= 0) return 0;
  if (gamesPlayed >= 20) return 1;
  return gamesPlayed / 20;
}

export function tuningFromProfile(profile: PlayerProfile | null | undefined): BotTuning {
  if (!profile) return NEUTRAL_TUNING;
  const k = influence(profile.games_played);
  if (k === 0) return NEUTRAL_TUNING;
  const aggDelta = profile.aggressiveness - 0.5;
  const callPropensity = 1 - aggDelta * 0.6 * k;
  const bluffDelta = profile.bluff_rate - 0.15;
  const bluffPropensity = Math.max(0.3, 1 - bluffDelta * 1.2 * k);
  const envitAcceptDelta = bluffDelta * 1.5 * k;
  const acceptDelta = profile.accept_threshold - 0.5;
  const acceptThresholdDelta = -acceptDelta * 15 * k;
  return {
    callPropensity: Math.max(0.4, Math.min(1.6, callPropensity)),
    bluffPropensity: Math.max(0.2, Math.min(2.5, bluffPropensity)),
    acceptThresholdDelta,
    envitAcceptDelta,
    consultRate: 1,
    conservativeMode: false,
  };
}
