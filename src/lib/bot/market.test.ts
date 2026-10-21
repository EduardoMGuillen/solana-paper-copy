import { describe, expect, it } from "vitest";
import { parseTickerPrice } from "./market";

describe("SOL dollar price", () => {
  it("reads a positive ticker and rejects anything else", () => {
    expect(parseTickerPrice({ price: "179.5" })).toBe(179.5);
    expect(parseTickerPrice({ price: "0" })).toBeNull();
    expect(parseTickerPrice({ price: "no" })).toBeNull();
    expect(parseTickerPrice(null)).toBeNull();
  });
});
