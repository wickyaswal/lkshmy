import type { PairState } from "@/lib/trading/types";

const STATE_TRANSITIONS: Record<PairState, PairState[]> = {
  IDLE: ["ENTERING", "STOPPED"],
  ENTERING: ["IN_POSITION", "IDLE", "STOPPED"],
  IN_POSITION: ["EXITING", "STOPPED"],
  EXITING: ["IDLE", "STOPPED"],
  STOPPED: ["IDLE"]
};

export class PairStateMachine {
  private readonly states = new Map<string, PairState>();

  get(pair: string): PairState {
    return this.states.get(pair) ?? "IDLE";
  }

  transition(pair: string, next: PairState): PairState {
    const current = this.get(pair);
    const allowed = STATE_TRANSITIONS[current];

    if (!allowed.includes(next)) {
      throw new Error(`Invalid state transition for ${pair}: ${current} -> ${next}`);
    }

    this.states.set(pair, next);
    return next;
  }

  force(pair: string, state: PairState): void {
    this.states.set(pair, state);
  }

  snapshot(): Record<string, PairState> {
    return Object.fromEntries(this.states.entries());
  }
}
