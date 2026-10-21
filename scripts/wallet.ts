/**
 * Create the dedicated wallet once, outside the repo, and print only the address.
 * Running it again does not rotate the key.
 */
import { createDedicatedWallet, walletDir } from "../src/lib/exec/wallet";

const address = createDedicatedWallet(walletDir());
process.stdout.write(`${address}\n`);
