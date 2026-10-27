import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

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
});
