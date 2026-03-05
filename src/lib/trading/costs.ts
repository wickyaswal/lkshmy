import { getEnv } from "@/lib/env";
import type { CostEstimate } from "@/lib/trading/types";
import { roundTo } from "@/lib/utils";

export const estimateRoundTripCosts = (input: {
  notionalUsdt: number;
  spreadPct: number;
  explicitFeePct?: number;
  slippagePct?: number;
  actualFeeUsdt?: number;
}): CostEstimate => {
  const env = getEnv();
  const feePct = input.explicitFeePct ?? env.demoFeePct;
  const slippagePct = input.slippagePct ?? env.demoSlippagePct;

  const feeEstUsdt = roundTo(input.notionalUsdt * feePct * 2, 8);
  const spreadEstUsdt = roundTo(input.notionalUsdt * input.spreadPct, 8);
  const slippageEstUsdt = roundTo(input.notionalUsdt * slippagePct, 8);
  const feeActualUsdt = roundTo(input.actualFeeUsdt ?? feeEstUsdt, 8);
  const netCostUsdt = roundTo(feeActualUsdt + spreadEstUsdt + slippageEstUsdt, 8);

  return {
    feeEstUsdt,
    feeActualUsdt,
    spreadEstUsdt,
    slippageEstUsdt,
    netCostUsdt
  };
};
