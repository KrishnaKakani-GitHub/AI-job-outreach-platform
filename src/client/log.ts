"use client";
/** Client-side structured warnings. Never include document text or contact details. */
export function log(event: string, error?: unknown): void {
  const message = error instanceof Error ? error.message : error === undefined ? undefined : String(error);
  console.warn(JSON.stringify({ level: "warn", event, message, at: new Date().toISOString() }));
}
