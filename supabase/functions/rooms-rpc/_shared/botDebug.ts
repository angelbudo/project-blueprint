// Store en memòria per a les decisions del bot, consumit per la UI de debug.

export interface BotDecisionEntry {
  id: number;
  ts: number;
  player: number;
  kind: "envit" | "truc";
  decision: string;
  level: string | number;
  myEnvit?: number;
  isMano?: boolean;
  pWin?: number;
  evAccept?: number;
  evReject?: number;
  trucStrength?: number;
  trucBonus?: number;
  extra?: string;
}

const MAX_ENTRIES = 30;
let nextId = 1;
const entries: BotDecisionEntry[] = [];
const listeners = new Set<() => void>();

export function recordBotDecision(e: Omit<BotDecisionEntry, "id" | "ts">): void {
  entries.unshift({ ...e, id: nextId++, ts: Date.now() });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  listeners.forEach((l) => l());
}

export function getBotDecisions(): BotDecisionEntry[] {
  return entries;
}

export function subscribeBotDecisions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearBotDecisions(): void {
  entries.length = 0;
  listeners.forEach((l) => l());
}
