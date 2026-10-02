import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { LabView } from "./LabView";

export const metadata: Metadata = { title: "Experiment lab · Warm Intro", description: "Simulations that check the A/B statistics before any real traffic." };

export default function LabPage() {
  return (
    <PageShell current="/lab">
      <LabView />
    </PageShell>
  );
}
