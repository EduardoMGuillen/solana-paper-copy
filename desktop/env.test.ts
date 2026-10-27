import { describe, expect, it } from "vitest";
import { maskRpc, parseEnv, setEnvValue } from "./env";

describe("config.env", () => {
  it("reads keys, skips comments and blanks, and drops matching quotes", () => {
    const text = "# comment\r\nTELEGRAM_BOT_TOKEN=abc:123\n\n  LIVE_LP_MAX_SOL = 0.3  \nSOLANA_RPC_URL=\"https://rpc.example\"\n# WALLET_DIR=/x\nBOT_PASSWORD='p=w'\nEMPTY=\n";
    expect(parseEnv(text)).toEqual({
      TELEGRAM_BOT_TOKEN: "abc:123",
      LIVE_LP_MAX_SOL: "0.3",
      SOLANA_RPC_URL: "https://rpc.example",
      BOT_PASSWORD: "p=w",
      EMPTY: "",
    });
  });

  it("ignores lines that are not assignments", () => {
    expect(parseEnv("export\n1BAD=x\nno equals here")).toEqual({});
  });

  it("replaces a key in place and keeps comments and other keys", () => {
    const text = "# rpc\nSOLANA_RPC_URL=\nLIVE_LP_MAX_SOL=0.6\n";
    expect(setEnvValue(text, "SOLANA_RPC_URL", "https://a.example/?k=1")).toBe("# rpc\nSOLANA_RPC_URL=https://a.example/?k=1\nLIVE_LP_MAX_SOL=0.6\n");
  });

  it("appends a missing key and ignores a commented-out one", () => {
    expect(setEnvValue("# SOLANA_RPC_URL=old\nA=1", "SOLANA_RPC_URL", "x")).toBe("# SOLANA_RPC_URL=old\nA=1\nSOLANA_RPC_URL=x\n");
  });

  it("refuses values that would break the file", () => {
    expect(() => setEnvValue("", "SOLANA_RPC_URL", "a\nB=1")).toThrow();
  });
});

describe("rpc mask", () => {
  it("hides key-like query values and path tokens", () => {
    expect(maskRpc("https://mainnet.helius-rpc.com/?api-key=00000000-1111-2222-3333-444455556666")).toBe("mainnet.helius-rpc.com/?api-key=0000…666");
    expect(maskRpc("https://x.solana-mainnet.quiknode.pro/0123456789abcdef0123/")).toBe("x.solana-mainnet.quiknode.pro/0123…123/");
  });

  it("returns null when there is no RPC and a placeholder for junk", () => {
    expect(maskRpc("")).toBeNull();
    expect(maskRpc(undefined)).toBeNull();
    expect(maskRpc("not a url")).toBe("(invalid URL)");
  });
});
