import { describe, expect, it } from "vitest";
import { METEORA_STARTING_SOL, tradesBalanceSol } from "./balances";

describe("separate paper balances", () => {
  it("keeps the full SOL deposit when nothing has been traded", () => {
    const shown = tradesBalanceSol({ startingSol: 1, equitySol: 0.9999, closed: 0, open: 0 });
    expect(shown).toBe(1);
    expect(METEORA_STARTING_SOL).toBe(1);
  });

  it("uses the marked SOL once a paper trade exists", () => {
    expect(tradesBalanceSol({ startingSol: 1, equitySol: 0.94, closed: 2, open: 0 })).toBe(0.94);
    expect(tradesBalanceSol({ startingSol: 1, equitySol: 1.05, closed: 0, open: 1 })).toBe(1.05);
  });
});
