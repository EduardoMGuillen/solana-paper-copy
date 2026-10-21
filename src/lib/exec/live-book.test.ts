import { describe, expect, it } from "vitest";
import { closeAllPositions, closeOnePosition, type LivePosition } from "./live-book";

const pool = "EQEu6NyEq8nECAiem1YkTu3uDBiGTEA2tYBLBmr9YJ7Y";
const other = "95zNQQ8juGpu8odzpbp63ZNtXuTnnBeBsHovUjpe32d8";

function row(address: string, signature: string | null): LivePosition {
  return {
    address,
    name: address.slice(0, 4),
    stakeSol: 0.1,
    openedAt: 1,
    signature,
    position: signature ? `${address.slice(0, 32)}position` : null,
    minBinId: signature ? 10 : null,
    maxBinId: signature ? 20 : null,
    solIsY: true,
    tokenMint: null,
    entryPrice: null,
    lastPrice: null,
    range: null,
    binStepBps: null,
    closing: false,
    closeReason: null,
    tokenPct: null,
    positionPct: null,
    note: "",
  };
}

describe("live position closes", () => {
  it("closes every position on stop and keeps a signed one visible while it closes", () => {
    const left = closeAllPositions([row(pool, "sig"), row(other, null)]);
    expect(left).toHaveLength(1);
    expect(left[0]?.address).toBe(pool);
    expect(left[0]?.closing).toBe(true);
    expect(left[0]?.closeReason).toBe("stop");
  });

  it("closes only the chosen pool and leaves the other open", () => {
    const result = closeOnePosition([row(pool, "sig-a"), row(other, "sig-b")], pool);
    expect(result.found).toBe(true);
    expect(result.positions.map((position) => position.address)).toEqual([pool, other]);
    expect(result.positions[0]?.closeReason).toBe("manual");
    expect(result.positions[1]?.closing).toBe(false);
  });

  it("reports a missing pool", () => {
    const result = closeOnePosition([row(pool, null)], other);
    expect(result.found).toBe(false);
    expect(result.positions).toHaveLength(1);
  });
});
