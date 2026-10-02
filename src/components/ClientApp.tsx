"use client";
import dynamic from "next/dynamic";

// The app is local-first (IndexedDB, localStorage), so it renders only in the browser.
const WarmIntroApp = dynamic(() => import("./WarmIntroApp"), {
  ssr: false,
  loading: () => <div className="grid h-dvh place-items-center text-[14px] text-ink-3">Loading Warm Intro…</div>,
});

export default function ClientApp() {
  return <WarmIntroApp />;
}
