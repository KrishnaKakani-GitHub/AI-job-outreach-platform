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

export const APP_STAGES = ["saved", "applied", "responded", "interview", "final_round", "offer", "rejected", "withdrawn"] as const;
export const AppStage = z.enum(APP_STAGES);
export type AppStage = z.infer<typeof AppStage>;

export const CONTACT_STAGES = ["not_contacted", "drafted", "sent", "accepted", "messaged", "replied", "referral"] as const;
export const ContactStage = z.enum(CONTACT_STAGES);
export type ContactStage = z.infer<typeof ContactStage>;

/** How the application started. "referral" means someone referred you in. */
export const APP_SOURCES = ["cold", "referral", "recruiter", "other"] as const;
export const AppSource = z.enum(APP_SOURCES);
export type AppSource = z.infer<typeof AppSource>;

export const OUTCOME_RESULTS = ["rejected", "no_response", "withdrawn", "offer"] as const;
export const OutcomeResult = z.enum(OUTCOME_RESULTS);
export type OutcomeResult = z.infer<typeof OutcomeResult>;

/** Reason categories, kept small so they can be counted across applications. */
export const REASON_CATEGORIES = [
  "none_given",
  "experience_level",
  "skills_gap",
  "domain",
  "position_filled",
  "internal_candidate",
  "other_candidates",
  "location_or_visa",
  "other",
] as const;
export const ReasonCategory = z.enum(REASON_CATEGORIES);
export type ReasonCategory = z.infer<typeof ReasonCategory>;

/** Where the reason came from. Only employer-sourced reasons count as "stated". */
export const REASON_SOURCES = ["rejection_email", "recruiter", "interviewer_feedback", "my_guess", "none"] as const;
export const ReasonSource = z.enum(REASON_SOURCES);
export type ReasonSource = z.infer<typeof ReasonSource>;

export const OutcomeLog = z.object({
  at: z.number(),
  result: OutcomeResult,
  reasonCategory: ReasonCategory.default("none_given"),
  reasonSource: ReasonSource.default("none"),
  notes: z.string().max(2000).default(""),
  learning: z.string().max(1000).default(""),
});
export type OutcomeLog = z.infer<typeof OutcomeLog>;

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

/** Job types the learning loop compares. The app guesses one from the title; the user can override it. */
export const JOB_TYPES = [
  "data_analytics",
  "analytics_engineering",
  "data_engineering",
  "product",
  "data_science_ml",
  "growth",
  "ai_engineering",
  "software_engineering",
  "other",
] as const;
export const JobType = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobType>;

/** The resume that actually went out with an application, frozen when it was applied for or tailored. */
export const CvSnapshot = z.object({
  text: z.string().max(40000),
  /** Master resume version it was built from. */
  base: z.string().max(40),
  tailored: z.boolean(),
  /** Skill rule ids the tailoring applied (baseline or learned). */
  rules: z.array(z.string().max(200)).max(80).default([]),
  at: z.number(),
});
export type CvSnapshot = z.infer<typeof CvSnapshot>;

export const Application = z.object({
  id: z.string().min(1).max(80),
  createdAt: z.number(),
  role: z.string().max(200),
  company: z.string().max(200).nullable(),
  seniority: Seniority.default("unknown"),
  companyType: CompanyType.default("unknown"),
  stage: AppStage,
  history: z.array(StageEvent).default([]),
  jobText: z.string().max(30000).default(""),
  resumeVersion: z.string().max(40).default("v1"),
  fit: FitReport.nullable().default(null),
  demo: z.boolean().default(false),
  jobUrl: z.string().max(2000).nullable().default(null),
  location: z.string().max(200).nullable().default(null),
  appliedAt: z.number().nullable().default(null),
  source: AppSource.default("cold"),
  nextStep: z.string().max(300).nullable().default(null),
  followUpAt: z.number().nullable().default(null),
  notes: z.string().max(5000).default(""),
  outcome: OutcomeLog.nullable().default(null),
  /** Gap fixes the user says they applied to the resume for this application. */
  tweaks: z.array(GapTag).default([]),
  /** User override of the guessed job type; null = use the guess. */
  jobType: JobType.nullable().default(null),
  cv: CvSnapshot.nullable().default(null),
  /** Skill rule ids the sent resume satisfied, computed when it was frozen. Null = unknown. */
  trace: z.array(z.string().max(200)).max(120).nullable().default(null),
  /** When an interview prep card was made for this application. */
  prepAt: z.number().nullable().default(null),
});
export type Application = z.infer<typeof Application>;

/** How a message opened. Used to learn which openings get accepted. */
export const OPENERS = ["shared_school", "shared_employer", "shared_field", "shared_other", "role_led", "template"] as const;
export const Opener = z.enum(OPENERS);
export type Opener = z.infer<typeof Opener>;

export const MessageFeatures = z.object({
  stage: Stage,
  channel: Channel,
  opener: Opener,
  chars: z.number().int().min(0),
  editRatio: z.number().min(0).max(1).nullable().default(null),
  copiedAt: z.number().nullable().default(null),
  /** Message-skill rule ids this message satisfied. */
  ruleTrace: z.array(z.string().max(200)).max(40).default([]),
  /** The resume line the message led with, if it cited one. */
  leadQuote: z.string().max(400).nullable().default(null),
});
export type MessageFeatures = z.infer<typeof MessageFeatures>;

export const CONTACT_SOURCES = ["chat", "manual", "linkedin_import"] as const;

export const Contact = z.object({
  id: z.string().min(1).max(80),
  applicationId: z.string().nullable().default(null),
  createdAt: z.number(),
  firstName: z.string().max(80).nullable(),
  lastName: z.string().max(80).nullable().default(null),
  title: z.string().max(200).nullable().default(null),
  company: z.string().max(200).nullable().default(null),
  recipientType: RecipientType,
  stage: ContactStage,
  history: z.array(StageEvent).default([]),
  /** A/B arm of the drafted message; null for contacts added without a draft. */
  variant: z.enum(["A", "B"]).nullable().default(null),
  channel: Channel.default("linkedin"),
  demo: z.boolean().default(false),
  source: z.enum(CONTACT_SOURCES).default("chat"),
  linkedinUrl: z.string().max(500).nullable().default(null),
  connectedOn: z.string().max(40).nullable().default(null),
  notes: z.string().max(2000).default(""),
  message: MessageFeatures.nullable().default(null),
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
