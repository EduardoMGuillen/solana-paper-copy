import path from "node:path";

export function dataDir(): string {
  return process.env.PAPER_DATA_DIR ?? path.join(process.cwd(), "data");
}
