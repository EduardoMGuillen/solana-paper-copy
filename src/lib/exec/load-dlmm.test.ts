import { createRequire } from "node:module";
import path from "node:path";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { positionBytes } from "./lp-chain";
import { MAX_EXTENDED_BINS, STANDARD_POSITION_BINS } from "./lp-plan";

type Sdk = {
  create: unknown;
  StrategyType: { BidAsk: number };
  DEFAULT_BIN_PER_POSITION: BN;
  MAX_BINS_PER_POSITION: BN;
  calculatePositionSize: (bins: BN) => BN;
};

function loadSdk(): Sdk {
  const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
  return nodeRequire(path.join(process.cwd(), "src", "lib", "exec", "load-dlmm.cjs")) as Sdk;
}

describe("dlmm loader", () => {
  // The SDK pulls in Anchor and web3; a cold load can take several seconds.
  it("loads the CommonJS build that Node can resolve", () => {
    const sdk = loadSdk();
    expect(typeof sdk.create).toBe("function");
    expect(sdk.StrategyType.BidAsk).toBe(2);
  }, 30_000);

  it("agrees with the SDK on position sizes", () => {
    const sdk = loadSdk();
    expect(Number(sdk.DEFAULT_BIN_PER_POSITION.toString())).toBe(STANDARD_POSITION_BINS);
    expect(Number(sdk.MAX_BINS_PER_POSITION.toString())).toBe(MAX_EXTENDED_BINS);
    for (const bins of [57, 70, 112, 140, 200]) {
      expect(positionBytes(bins)).toBe(Number(sdk.calculatePositionSize(new BN(bins)).toString()));
    }
  }, 30_000);
});
