import { Desk } from "@/components/desk";
import { readDesk } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function Page() {
  const view = await readDesk();
  return <Desk initialView={view} />;
}
