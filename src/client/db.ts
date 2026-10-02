"use client";
/**
 * Local-first storage (IndexedDB via Dexie). Profiles, applications, contacts
 * and chat history live only in this browser. Nothing here is sent to the
 * server except the specific text needed for one AI request.
 */
import Dexie, { type EntityTable } from "dexie";
import type { Application, Contact, Profile } from "@/lib/schemas";

export type MessageKind = "text" | "paste" | "fit" | "draft" | "strategy" | "similar" | "profile" | "notice";

export interface ChatMessage {
  id: string;
  chatId: string;
  createdAt: number;
  role: "user" | "assistant";
  kind: MessageKind;
  text?: string;
  // Card payloads are typed at the component that renders them.
  payload?: unknown;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  applicationId: string | null;
  demo?: boolean;
}

class WarmIntroDB extends Dexie {
  profile!: EntityTable<Profile, "id">;
  applications!: EntityTable<Application, "id">;
  contacts!: EntityTable<Contact, "id">;
  chats!: EntityTable<Chat, "id">;
  messages!: EntityTable<ChatMessage, "id">;

  constructor() {
    super("warm-intro");
    this.version(1).stores({
      profile: "id",
      applications: "id, createdAt, stage",
      contacts: "id, applicationId, createdAt, stage",
      chats: "id, updatedAt, applicationId",
      messages: "id, chatId, createdAt",
    });
  }
}

export const db = new WarmIntroDB();

export const EMPTY_PROFILE: Profile = { id: "me", name: "", background: "", resume: "", resumeVersion: "v1", linkedinPremium: false, signoff: "" };

export async function getProfile(): Promise<Profile> {
  return (await db.profile.get("me")) ?? EMPTY_PROFILE;
}

export async function saveProfile(patch: Partial<Profile>): Promise<Profile> {
  const next = { ...(await getProfile()), ...patch, id: "me" as const };
  await db.profile.put(next);
  return next;
}

export async function addMessage(m: Omit<ChatMessage, "createdAt"> & { createdAt?: number }): Promise<ChatMessage> {
  const msg = { createdAt: Date.now(), ...m };
  await db.messages.put(msg);
  await db.chats.update(m.chatId, { updatedAt: msg.createdAt });
  return msg;
}

export async function updatePayload(id: string, patch: Record<string, unknown>): Promise<void> {
  const m = await db.messages.get(id);
  if (!m) return;
  await db.messages.update(id, { payload: { ...(m.payload as Record<string, unknown>), ...patch } });
}

/** Wipe everything (used by "Delete my data" in the profile panel). */
export async function clearAll(): Promise<void> {
  await Promise.all([db.profile.clear(), db.applications.clear(), db.contacts.clear(), db.chats.clear(), db.messages.clear()]);
}
