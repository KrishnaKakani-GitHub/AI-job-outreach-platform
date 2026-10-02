/**
 * Structured JSON logging. Logs record who/what/when/why for every AI action,
 * but never the pasted text itself (profiles, resumes, job posts).
 */
type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
