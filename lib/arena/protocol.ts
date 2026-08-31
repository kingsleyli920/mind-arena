export const ARENA_PROTOCOL_VERSION = "0.1.0";

export type MatchMode = "model-v-model" | "human-v-model";
export type MatchStyle = "benchmark" | "persona";
export type ModuleStatus = "prototype" | "research" | "planned";

export interface ArenaGameModule {
  id: string;
  title: string;
  status: ModuleStatus;
  decisionWindow: string;
  actionBudget: number;
}

export interface MatchSpec {
  gameId: string;
  mode: MatchMode;
  style: MatchStyle;
  contenderA: string;
  contenderB: string;
  seed: string;
}

export interface ObservationEnvelope<TState = unknown> {
  protocolVersion: typeof ARENA_PROTOCOL_VERSION;
  matchId: string;
  turn: number;
  actorId: string;
  state: TState;
  legalActions: string[];
  deadlineMs: number;
}

export interface DecisionEnvelope<TAction = unknown> {
  protocolVersion: typeof ARENA_PROTOCOL_VERSION;
  matchId: string;
  turn: number;
  actorId: string;
  action: TAction;
  explanation?: string;
}

export interface ReplayEvent<TPayload = unknown> {
  sequence: number;
  turn: number;
  type: "observation" | "decision" | "validation" | "resolution";
  actorId?: string;
  payload: TPayload;
  stateHash: string;
}

export function normalizeSeed(input: string): string {
  const trimmed = input.trim();
  return trimmed || "mind-arena-001";
}

export function createMatchId(spec: MatchSpec): string {
  const source = [
    spec.gameId,
    spec.mode,
    spec.style,
    spec.contenderA,
    spec.contenderB,
    normalizeSeed(spec.seed),
  ].join("|");

  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `MA-${spec.gameId}-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export function canConfigureMatch(moduleStatus: ModuleStatus): boolean {
  return moduleStatus === "prototype";
}
