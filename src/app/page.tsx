import { Desk } from "@/components/desk";
import { readBot } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function Page() {
  const view = await readBot();
  return <Desk initialView={view} />;
}
