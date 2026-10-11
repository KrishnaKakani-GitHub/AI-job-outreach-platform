import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { ResultsView } from "./ResultsView";

export const metadata: Metadata = { title: "A/B results · AI Job Tracker", description: "Live results of the template vs. AI-draft experiment." };

export default function ResultsPage() {
  return (
    <PageShell current="/results">
      <ResultsView />
    </PageShell>
  );
}
