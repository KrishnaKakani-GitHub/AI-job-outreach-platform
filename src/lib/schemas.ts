/**
 * Domain schemas. Every value that crosses a boundary (AI output, IndexedDB,
 * API request bodies) is parsed with one of these. AI output is never trusted
 * until it passes a schema here and the deterministic checks in validators.ts.
 */
import { z } from "zod";

export const DOC_KINDS = ["resume", "background", "job_description", "recipient_profile", "message", "other"] as const;
export const DocKind = z.enum(DOC_KINDS);
export type DocKind = z.infer<typeof DocKind>;

export const RECIPIENT_TYPES = ["alum", "recruiter", "hr", "hiring_manager", "team_member"] as const;
export const RecipientType = z.enum(RECIPIENT_TYPES);
export type RecipientType = z.infer<typeof RecipientType>;

export const STAGES = ["invite_note", "accepted_followup", "referral_ask"] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

export const CHANNELS = ["linkedin", "email", "platform_message"] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;

export const SENIORITIES = ["intern", "entry", "mid", "senior", "unknown"] as const;
export const Seniority = z.enum(SENIORITIES);
export type Seniority = z.infer<typeof Seniority>;

export const COMPANY_TYPES = ["startup", "growth", "enterprise", "nonprofit", "agency", "unknown"] as const;
export const CompanyType = z.enum(COMPANY_TYPES);
export type CompanyType = z.infer<typeof CompanyType>;

/** Fixed gap taxonomy so gaps can be counted across applications. */
export const GAP_TAGS = [
  "ownership",
  "domain_visibility",
  "quantified_impact",
  "summary_role_match",
  "requirement_evidence",
  "seniority",
  "tooling",
] as const;
export const GapTag = z.enum(GAP_TAGS);
export type GapTag = z.infer<typeof GapTag>;

export const EVIDENCE = ["strong", "partial", "missing"] as const;
export const Evidence = z.enum(EVIDENCE);
export type Evidence = z.infer<typeof Evidence>;

export const RequirementRating = z.object({
  requirement: z.string().min(1).max(300),
  evidence: Evidence,
  /** Verbatim line from the resume that supports the rating, if any. */
  resumeQuote: z.string().max(400).nullable(),
  gapTag: GapTag.nullable(),
  weight: z.number().min(0.5).max(2).default(1),
});
export type RequirementRating = z.infer<typeof RequirementRating>;

export const JobMeta = z.object({
  role: z.string().max(120),
  company: z.string().max(120).nullable(),
  seniority: Seniority,
  companyType: CompanyType,
});
export type JobMeta = z.infer<typeof JobMeta>;

export const FitReport = z.object({
  meta: JobMeta,
  ratings: z.array(RequirementRating).min(1).max(25),
  /** Computed by lib/fit.ts — never accepted from the model. */
  score: z.number().min(0).max(100),
  gaps: z.array(GapTag),
  source: z.enum(["ai", "rules"]),
});
export type FitReport = z.infer<typeof FitReport>;

export const ANATOMY_PARTS = ["connection", "background", "learn", "ask"] as const;
export const AnatomyPart = z.enum(ANATOMY_PARTS);
export type AnatomyPart = z.infer<typeof AnatomyPart>;

/** A personalized claim must point at verbatim text in one of the sources. */
export const Claim = z.object({
  text: z.string().min(1),
  source: z.enum(["recipient", "me", "job"]),
  quote: z.string().min(1),
});
export type Claim = z.infer<typeof Claim>;

export const DraftSegment = z.object({
  part: AnatomyPart,
  text: z.string().min(1).max(900),
  claims: z.array(Claim).default([]),
});
export type DraftSegment = z.infer<typeof DraftSegment>;

export const Draft = z.object({
  subject: z.string().max(140).nullable(),
  segments: z.array(DraftSegment).min(1).max(6),
  greeting: z.string().max(80),
  signoff: z.string().max(80),
});
export type Draft = z.infer<typeof Draft>;

export const SharedGround = z.object({
  label: z.string().max(120),
  kind: z.enum(["school", "employer", "location", "domain", "affiliation"]),
  meQuote: z.string(),
  recipientQuote: z.string(),
});
export type SharedGround = z.infer<typeof SharedGround>;

export const RecipientMeta = z.object({
  firstName: z.string().max(60).nullable(),
  title: z.string().max(160).nullable(),
  recipientType: RecipientType,
  reason: z.string().max(160),
});
export type RecipientMeta = z.infer<typeof RecipientMeta>;

export const SimilarCompany = z.object({
  name: z.string().max(80),
  why: z.string().max(300),
});
export type SimilarCompany = z.infer<typeof SimilarCompany>;

// ---- Persisted (IndexedDB) records ----

export const APP_STAGES = ["saved", "applied", "responded", "interview", "final_round", "offer", "rejected"] as const;
export const AppStage = z.enum(APP_STAGES);
export type AppStage = z.infer<typeof AppStage>;

export const CONTACT_STAGES = ["drafted", "sent", "accepted", "messaged", "replied", "referral"] as const;
export const ContactStage = z.enum(CONTACT_STAGES);
export type ContactStage = z.infer<typeof ContactStage>;

export const Profile = z.object({
  id: z.literal("me"),
  name: z.string().max(80).default(""),
  background: z.string().max(2000).default(""),
  resume: z.string().max(40000).default(""),
  resumeVersion: z.string().max(40).default("v1"),
  linkedinPremium: z.boolean().default(false),
  signoff: z.string().max(80).default(""),
});
export type Profile = z.infer<typeof Profile>;

export const StageEvent = z.object({ stage: z.string(), at: z.number() });

export const Application = z.object({
  id: z.string(),
  createdAt: z.number(),
  role: z.string(),
  company: z.string().nullable(),
  seniority: Seniority,
  companyType: CompanyType,
  stage: AppStage,
  history: z.array(StageEvent),
  jobText: z.string(),
  resumeVersion: z.string(),
  fit: FitReport.nullable(),
  demo: z.boolean().default(false),
});
export type Application = z.infer<typeof Application>;

export const Contact = z.object({
  id: z.string(),
  applicationId: z.string().nullable(),
  createdAt: z.number(),
  firstName: z.string().nullable(),
  title: z.string().nullable(),
  recipientType: RecipientType,
  stage: ContactStage,
  history: z.array(StageEvent),
  variant: z.enum(["A", "B"]),
  channel: Channel,
  demo: z.boolean().default(false),
});
export type Contact = z.infer<typeof Contact>;

// ---- Experiment events (the only thing that reaches the server) ----

export const EVENT_TYPES = ["exposure", "draft_generated", "copied", "edited", "stage_changed"] as const;
export const ExperimentEvent = z.object({
  anonId: z.string().regex(/^[a-z0-9-]{8,64}$/),
  experiment: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  variant: z.enum(["A", "B"]),
  type: z.enum(EVENT_TYPES),
  /** Small numeric metadata only — never text. */
  value: z.number().finite().nullable().default(null),
});
export type ExperimentEvent = z.infer<typeof ExperimentEvent>;
