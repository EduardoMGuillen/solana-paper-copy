import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("dlmm loader", () => {
  it("loads the CommonJS build that Node can resolve", () => {
    const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
    const sdk = nodeRequire(path.join(process.cwd(), "src", "lib", "exec", "load-dlmm.cjs")) as {
      create: unknown;
      StrategyType: { BidAsk: number };
    };
    expect(typeof sdk.create).toBe("function");
    expect(sdk.StrategyType.BidAsk).toBe(2);
  });
});
