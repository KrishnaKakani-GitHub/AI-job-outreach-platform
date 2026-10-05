import { expect, test } from "@playwright/test";

test("sample flow produces a fit check and a grounded draft (AI-draft arm)", async ({ page }) => {
  await page.goto("/?variant=B");
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  const fit = page.getByRole("article", { name: "Fit check" });
  await expect(fit).toBeVisible();
  await expect(fit.getByRole("img", { name: /Fit score \d+ out of 100/ })).toBeVisible();
  const draft = page.getByRole("article", { name: "Outreach draft" });
  await expect(draft).toBeVisible();
  await expect(draft.getByText("Lakeshore College").first()).toBeVisible();
  await expect(draft.getByLabel("Recipient")).toHaveValue("recruiter");
  // Changing the stage redrafts in place.
  await draft.getByLabel("Stage").selectOption("accepted_followup");
  await expect(draft.getByText("Why I fit")).toBeVisible();
});

test("template arm shows blanks to fill", async ({ page }) => {
  await page.goto("/?variant=A");
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  const draft = page.getByRole("article", { name: "Outreach draft" });
  await expect(draft.getByText("Fill in the bracketed parts before sending.")).toBeVisible();
});

test("copying a draft records experiment events and marks the contact sent", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const before = await (await page.request.get("/api/results")).json();
  const drafted = (r: { arms: { drafted: number; copied: number }[] }) => r.arms.reduce((s, a) => s + a.drafted, 0);
  const copied = (r: { arms: { drafted: number; copied: number }[] }) => r.arms.reduce((s, a) => s + a.copied, 0);
  await page.goto("/");
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  await page.getByRole("article", { name: "Outreach draft" }).getByRole("button", { name: "Copy" }).click();
  await expect.poll(async () => drafted(await (await page.request.get("/api/results")).json())).toBeGreaterThan(drafted(before));
  await expect.poll(async () => copied(await (await page.request.get("/api/results")).json())).toBeGreaterThan(copied(before));
  await page.getByRole("button", { name: "Tracker" }).first().click();
  await expect(page.getByLabel(/Stage for Sam/)).toHaveValue("sent");
});

test("public pages render", async ({ page }) => {
  for (const [path, heading] of [
    ["/results", /live results/],
    ["/lab", /Experiment lab/],
    ["/case", /Case study/],
    ["/changelog", /Changelog/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  }
});

import AxeBuilder from "@axe-core/playwright";

test("no serious accessibility violations on key screens", async ({ page }) => {
  await page.goto("/?variant=B");
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  await expect(page.getByRole("article", { name: "Outreach draft" })).toBeVisible();
  const targets = [page.url(), "/results", "/lab", "/case"];
  for (const t of targets) {
    if (t !== page.url()) await page.goto(t);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${t}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
});

test("tracker: add an application, filter, log an outcome, export a backup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tracker" }).first().click();
  await page.getByRole("button", { name: "Add application" }).click();
  const dlg = page.getByRole("dialog", { name: "Add application" });
  await dlg.getByLabel("Role").fill("Analytics Engineer");
  await dlg.getByLabel("Company").fill("Example Health");
  await dlg.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText("Analytics Engineer", { exact: true })).toBeVisible();

  await page.getByLabel("Search applications").fill("no-such-role");
  await expect(page.getByText("No applications match these filters.")).toBeVisible();
  await page.getByLabel("Search applications").fill("");

  await page.getByRole("button", { name: "Log outcome" }).first().click();
  const o = page.getByRole("dialog", { name: "Log an outcome" });
  await o.getByLabel("What happened").selectOption("rejected");
  await o.getByLabel(/^Reason/).selectOption("experience_level");
  await o.getByLabel("Where the reason came from").selectOption("recruiter");
  await o.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText(/Rejected · Experience level/)).toBeVisible();

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export backup" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^warm-intro-backup-.*\.json$/);
});

test("craft card starts from the job post, then gets personal with history", async ({ page }) => {
  await page.goto("/?variant=B");
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  const fresh = page.getByRole("article", { name: "Craft this application" });
  await expect(fresh.getByText("Based on this job post").first()).toBeVisible();

  await page.getByRole("button", { name: /New chat/ }).click();
  await page.getByRole("switch", { name: "Demo data" }).click();
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  const craft = page.getByRole("article", { name: "Craft this application" });
  await expect(craft.getByText(/Pattern|Early signal/).first()).toBeVisible();
  await expect(craft.getByText(/\d+ of \d+/).first()).toBeVisible();
});

test("playbook: learned rules can be accepted from Insights", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("switch", { name: "Demo data" }).click();
  await page.getByRole("button", { name: /^Insights/ }).first().click();
  const panel = page.getByRole("dialog", { name: /Insights/ });
  await expect(panel.getByText("Your playbook")).toBeVisible();
  await panel.getByRole("button", { name: "Use this rule" }).first().click();
  await expect(panel.getByText("In use").first()).toBeVisible();
});

test("tracker and insights have no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("switch", { name: "Demo data" }).click();
  for (const name of ["Tracker", "Insights"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
    await expect(page.getByRole("dialog", { name: new RegExp(name) })).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
    await page.keyboard.press("Escape");
  }
});
