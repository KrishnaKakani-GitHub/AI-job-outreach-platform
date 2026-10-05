/** Display labels shared by cards, panels and the tracker. */
import type { AppSource, AppStage, CompanyType, ContactStage, Opener, OutcomeResult, ReasonCategory, ReasonSource, Seniority } from "./schemas";

export const SENIORITY_LABEL: Record<Seniority, string> = {
  intern: "Internship",
  entry: "Entry level",
  mid: "Mid level",
  senior: "Senior",
  unknown: "Level not stated",
};

export const COMPANY_LABEL: Record<CompanyType, string> = {
  startup: "Startup",
  growth: "Growth stage",
  enterprise: "Large company",
  nonprofit: "Nonprofit",
  agency: "Agency",
  unknown: "Company type not stated",
};

export const APP_STAGE_LABEL: Record<AppStage, string> = {
  saved: "Saved",
  applied: "Applied",
  responded: "Responded",
  interview: "Interview",
  final_round: "Final round",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const CONTACT_STAGE_LABEL: Record<ContactStage, string> = {
  not_contacted: "Not contacted",
  drafted: "Drafted",
  sent: "Sent",
  accepted: "Accepted",
  messaged: "Messaged",
  replied: "Replied",
  referral: "Referral",
};

/** Label for a stored enum value, falling back to a capitalized raw value. */
export function labelFor(map: Record<string, string>, key: string): string {
  return map[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

export const SOURCE_LABEL: Record<AppSource, string> = {
  cold: "Applied cold",
  referral: "Referral",
  recruiter: "Recruiter reached out",
  other: "Other",
};

export const OUTCOME_LABEL: Record<OutcomeResult, string> = {
  rejected: "Rejected",
  no_response: "No response",
  withdrawn: "I withdrew",
  offer: "Offer",
};

export const REASON_LABEL: Record<ReasonCategory, string> = {
  none_given: "No reason given",
  experience_level: "Experience level",
  skills_gap: "Missing skills",
  domain: "Domain or industry fit",
  position_filled: "Position filled or closed",
  internal_candidate: "Internal candidate",
  other_candidates: "Went with other candidates",
  location_or_visa: "Location or work authorization",
  other: "Other",
};

export const REASON_SOURCE_LABEL: Record<ReasonSource, string> = {
  rejection_email: "Rejection email",
  recruiter: "Recruiter told me",
  interviewer_feedback: "Interviewer feedback",
  my_guess: "My own guess",
  none: "No reason given",
};

/** Employer-sourced reasons count as stated; everything else is a hypothesis. */
export function isStatedReason(source: ReasonSource): boolean {
  return source === "rejection_email" || source === "recruiter" || source === "interviewer_feedback";
}

export const OPENER_LABEL: Record<Opener, string> = {
  shared_school: "Shared school",
  shared_employer: "Shared employer",
  shared_field: "Shared field",
  shared_other: "Other shared ground",
  role_led: "Role-led",
  template: "Fill-in template",
};
