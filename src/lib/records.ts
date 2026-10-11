/**
 * Record constructors and backups. Every record that enters IndexedDB goes
 * through a schema parse here, so defaults are filled and malformed input
 * (from a file import, an old version, or a bug) is rejected, not stored.
 */
import { z } from "zod";
import { Application, Contact, Profile } from "./schemas";

export type ApplicationInput = z.input<typeof Application>;
export type ContactInput = z.input<typeof Contact>;

export function newApplication(input: ApplicationInput): Application {
  return Application.parse(input);
}

export function newContact(input: ContactInput): Contact {
  return Contact.parse(input);
}

/** Fill defaults for records written by an older version; null if unrecoverable. */
export function upgradeApplication(raw: unknown): Application | null {
  const r = Application.safeParse(raw);
  return r.success ? r.data : null;
}

export function upgradeContact(raw: unknown): Contact | null {
  const r = Contact.safeParse(raw);
  return r.success ? r.data : null;
}

export const BACKUP_FORMAT = "warm-intro-backup";
export const BACKUP_VERSION = 2;

export const Backup = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1).max(BACKUP_VERSION),
  exportedAt: z.number(),
  profile: Profile.nullable().default(null),
  applications: z.array(Application).max(5000),
  contacts: z.array(Contact).max(20000),
});
export type Backup = z.infer<typeof Backup>;

export function buildBackup(profile: Profile | null, applications: Application[], contacts: Contact[], now = Date.now()): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    profile,
    applications: applications.filter((a) => !a.demo),
    contacts: contacts.filter((c) => !c.demo),
  };
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Validate a backup file. Any invalid record rejects the whole file, so nothing half-imports. */
export function parseBackup(text: string): ParseResult<Backup> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  const r = Backup.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    return { ok: false, error: `This doesn't look like an AI Job Tracker backup (${first ? `${first.path.join(".") || "file"}: ${first.message}` : "unknown format"}).` };
  }
  const ids = new Set(r.data.applications.map((a) => a.id));
  const dangling = r.data.contacts.filter((c) => c.applicationId && !ids.has(c.applicationId)).length;
  // Contacts pointing at applications that aren't in the file are kept but unlinked.
  const contacts = dangling ? r.data.contacts.map((c) => (c.applicationId && !ids.has(c.applicationId) ? { ...c, applicationId: null } : c)) : r.data.contacts;
  return { ok: true, data: { ...r.data, contacts } };
}
