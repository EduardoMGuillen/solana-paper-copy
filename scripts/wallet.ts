/**
 * Dedicated wallet, kept outside the repo. Prints only the address.
 *
 *   npm run wallet                       # create one once; running it again does not rotate the key
 *   npm run wallet -- import [ADDRESS]   # import your key (Phantom base58 or solana-keygen array), typed hidden
 */
import { createDedicatedWallet, importDedicatedWallet, walletDir } from "../src/lib/exec/wallet";

/** Read one line from the terminal without echoing it, so the key never lands in scrollback or shell history. */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("Run the import in a terminal: the key is typed hidden.");
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return done();
        if (char === "\u0003") return done(new Error("Cancelled."));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const [command, expected] = process.argv.slice(2);
  if (command === "import") {
    const secret = await readHidden("Private key (hidden): ");
    process.stdout.write(`${importDedicatedWallet(walletDir(), secret, expected)}\n`);
    return;
  }
  process.stdout.write(`${createDedicatedWallet(walletDir())}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Failed."}\n`);
  process.exit(1);
});
