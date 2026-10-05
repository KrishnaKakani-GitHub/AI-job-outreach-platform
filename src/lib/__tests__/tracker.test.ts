import { describe, expect, it } from "vitest";
import { applicationsToCSV, connectionKey, parseApplicationsCSV, parseCSV, parseLinkedInConnections, toCSV } from "../csv";
import { buildBackup, newApplication, newContact, parseBackup, upgradeApplication } from "../records";
import { applyOutcome, DAY, filterApplications, isOverdue, moveApplication, trackerSummary } from "../tracker";

const NOW = Date.UTC(2026, 9, 5);
const mk = (over: Partial<Parameters<typeof newApplication>[0]> = {}) =>
  newApplication({ id: over.id ?? "a1", createdAt: NOW - 10 * DAY, role: "Data Analyst", company: "Demo Co", stage: "saved", history: [{ stage: "saved", at: NOW - 10 * DAY }], ...over });

describe("CSV", () => {
  it("handles quotes, commas, escaped quotes, CRLF and newlines inside fields", () => {
    const rows = parseCSV('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
    ]);
  });
  it("round-trips through toCSV", () => {
    const data = [["role", "notes"], ["Analyst", 'He said "maybe", then left']];
    expect(parseCSV(toCSV(data))).toEqual(data);
  });
  it("neutralizes spreadsheet formulas on export", () => {
    expect(toCSV([["=HYPERLINK(1)", "+1", "-x", "@sum", "ok"]])).toBe("'=HYPERLINK(1),'+1,'-x,'@sum,ok");
  });
});

describe("LinkedIn Connections.csv", () => {
  const file = [
    "Notes:",
    '"When exporting your connection data, you may notice that some of the email addresses are missing."',
    "",
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    "Sam,Example,https://www.linkedin.com/in/sam-example,sam@example.com,Demo Co,Technical Recruiter,12 Mar 2026",
    'Priya,Sample,https://www.linkedin.com/in/priya-sample,,"Sample Labs, Inc.",Data Scientist,01 Feb 2026',
  ].join("\n");
  it("skips the notes preamble and drops email addresses", () => {
    const r = parseLinkedInConnections(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1].company).toBe("Sample Labs, Inc.");
    expect(JSON.stringify(r.rows)).not.toContain("@example.com");
  });
  it("rejects files without the header", () => {
    expect(parseLinkedInConnections("a,b\n1,2").ok).toBe(false);
  });
  it("matches duplicates by URL, then by name and company", () => {
    expect(connectionKey({ firstName: "Sam", lastName: "X", company: null, url: "https://linkedin.com/in/sam/" })).toBe(connectionKey({ firstName: "Other", lastName: "Y", company: "Z", linkedinUrl: "https://LinkedIn.com/in/sam" }));
    expect(connectionKey({ firstName: "Sam", lastName: "Ex", company: "Demo" })).toBe(connectionKey({ firstName: " sam", lastName: "ex", company: "demo " }));
  });
});

describe("applications CSV", () => {
  it("round-trips export → import", () => {
    const a = mk({ stage: "applied", appliedAt: Date.UTC(2026, 8, 1), source: "referral", location: "Remote", notes: "=risky" });
    const r = parseApplicationsCSV(applicationsToCSV([a]), () => "new-id", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = newApplication(r.rows[0]);
    expect(back).toMatchObject({ role: "Data Analyst", company: "Demo Co", stage: "applied", source: "referral", location: "Remote", appliedAt: Date.UTC(2026, 8, 1) });
  });
  it("defaults unknown stages and skips rows without a role", () => {
    const r = parseApplicationsCSV("company,role,stage\nX,,applied\nY,Analyst,ghosted\n", () => "id", NOW);
    expect(r.ok && r.skipped).toBe(1);
    expect(r.ok && r.rows[0].stage).toBe("applied");
  });
  it("needs a role column", () => {
    expect(parseApplicationsCSV("company\nX", () => "id").ok).toBe(false);
  });
});

describe("backups", () => {
  it("round-trips and leaves demo records out", () => {
    const real = mk();
    const demo = mk({ id: "d", demo: true });
    const c = newContact({ id: "c1", applicationId: "a1", createdAt: NOW, firstName: "Sam", recipientType: "alum", stage: "sent" });
    const b = buildBackup(null, [real, demo], [c], NOW);
    expect(b.applications.map((a) => a.id)).toEqual(["a1"]);
    const parsed = parseBackup(JSON.stringify(b));
    expect(parsed.ok && parsed.data.contacts[0].applicationId).toBe("a1");
  });
  it("rejects malformed files as a whole", () => {
    expect(parseBackup("not json").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ format: "other" })).ok).toBe(false);
    const bad = { ...buildBackup(null, [mk()], [], NOW), applications: [{ id: "x" }] };
    const r = parseBackup(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/applications/);
  });
  it("unlinks contacts whose application isn't in the file", () => {
    const c = newContact({ id: "c1", applicationId: "missing", createdAt: NOW, firstName: "Sam", recipientType: "alum", stage: "sent" });
    const r = parseBackup(JSON.stringify(buildBackup(null, [], [c], NOW)));
    expect(r.ok && r.data.contacts[0].applicationId).toBeNull();
  });
  it("upgrades v1 records by filling new fields", () => {
    const v1 = { id: "old", createdAt: 1, role: "Analyst", company: null, seniority: "entry", companyType: "startup", stage: "applied", history: [{ stage: "applied", at: 5 }], jobText: "", resumeVersion: "v1", fit: null, demo: false };
    expect(upgradeApplication(v1)).toMatchObject({ source: "cold", outcome: null, tweaks: [], notes: "" });
  });
});

describe("tracker moves", () => {
  it("sets applied date and a follow-up when moving to applied", () => {
    const a = moveApplication(mk(), "applied", NOW);
    expect(a.appliedAt).toBe(NOW);
    expect(a.followUpAt).toBe(NOW + 7 * DAY);
    expect(a.history.at(-1)).toEqual({ stage: "applied", at: NOW });
  });
  it("clears follow-ups when an application closes", () => {
    const a = moveApplication(moveApplication(mk(), "applied", NOW), "rejected", NOW + DAY);
    expect(a.followUpAt).toBeNull();
    expect(isOverdue(a, NOW + 30 * DAY)).toBe(false);
  });
  it("logs outcomes and moves the stage", () => {
    const a = applyOutcome(mk({ stage: "applied" }), { at: NOW, result: "rejected", reasonCategory: "experience_level", reasonSource: "recruiter", notes: "", learning: "" }, NOW);
    expect(a.stage).toBe("rejected");
    expect(a.outcome?.reasonCategory).toBe("experience_level");
  });
  it("summarizes and filters", () => {
    const apps = [mk({ id: "1", stage: "applied", followUpAt: NOW - DAY }), mk({ id: "2", stage: "interview", source: "referral" }), mk({ id: "3", role: "Product Manager", stage: "rejected" })];
    const s = trackerSummary(apps, [], NOW);
    expect(s).toMatchObject({ active: 2, interviews: 1, referrals: 1, nextMove: 1 });
    expect(filterApplications(apps, { q: "product", stage: "all", source: "all" }).map((a) => a.id)).toEqual(["3"]);
    expect(filterApplications(apps, { q: "", stage: "open", source: "referral" }).map((a) => a.id)).toEqual(["2"]);
  });
});
