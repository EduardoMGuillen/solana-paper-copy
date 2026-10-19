import { describe, expect, it } from "vitest";
import { parseTopStakers, pickTopVault, TOP_COUNT } from "./meteora";

describe("Meteora Stake2Earn parser", () => {
  it("picks the vault with the most staked USD", () => {
    const vault = pickTopVault([
      { vault_address: "small", total_staked_amount_usd: 10, token_a_symbol: "A", token_b_symbol: "SOL" },
      { vault_address: "large", total_staked_amount_usd: "250.5", token_a_symbol: "NATION", token_b_symbol: "SOL" },
    ]);
    expect(vault?.vault_address).toBe("large");
  });

  it("keeps Meteora's stake order and only the top 7 owners", () => {
    const entries = Array.from({ length: 9 }, (_, index) => ({
      owner: `Owner${index}1111111111111111111111111111111111`.slice(0, 44),
      staked_amount: 90 - index * 10,
      token_a_accumulated_reward_usd: index,
      token_b_accumulated_reward_usd: 1,
    }));
    const top = parseTopStakers(entries.reverse());
    expect(top).toHaveLength(TOP_COUNT);
    expect(top[0].rank).toBe(1);
    expect(top[0].stakedAmount).toBe(90);
    expect(top[6].stakedAmount).toBe(30);
    expect(top.every((item) => item.address.length >= 32)).toBe(true);
  });
});
