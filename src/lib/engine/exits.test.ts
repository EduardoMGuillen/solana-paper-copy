import { describe, expect, it } from "vitest";
import { proportionalSellFraction } from "./exits";

describe("proportional exits", () => {
  it("mirrors a 50% leader sale", () => {
    expect(proportionalSellFraction(1000, 500)).toBeCloseTo(0.5);
  });

  it("mirrors a full exit and a quarter exit", () => {
    expect(proportionalSellFraction(80, 0)).toBeCloseTo(1);
    expect(proportionalSellFraction(80, 60)).toBeCloseTo(0.25);
  });

  it("returns zero when the leader did not reduce", () => {
    expect(proportionalSellFraction(0, 0)).toBe(0);
    expect(proportionalSellFraction(40, 40)).toBe(0);
    expect(proportionalSellFraction(40, 50)).toBe(0);
  });
});
