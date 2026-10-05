import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const out = process.env.SHOTS_DIR ?? "screenshots";
mkdirSync(out, { recursive: true });
const base = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function run(name, { width = 1360, height = 860, dark = false, variant = "B", steps = async () => {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${base}/?variant=${variant}`);
  await page.waitForSelector("nav[aria-label=Conversations]");
  await steps(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await ctx.close();
}
const example = async (page) => {
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  await page.waitForSelector('[aria-label="Outreach draft"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
};
const which = process.argv[2] ?? "all";
if (which === "all" || which === "empty") await run("01-empty");
if (which === "all" || which === "flow") await run("02-flow-b", { steps: example });
if (which === "all" || which === "flowA") await run("03-flow-a", { variant: "A", steps: example });
if (which === "all" || which === "dark") await run("04-dark", { dark: true, steps: example });
if (which === "all" || which === "mobile") await run("05-mobile", { width: 390, height: 844, steps: example });
if (which === "all" || which === "insights") await run("06-insights", { steps: async (page) => {
  await page.getByRole("switch", { name: "Demo data" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Insights/ }).first().click();
  await page.waitForTimeout(800);
}});
if (which === "all" || which === "strategy") await run("07-strategy", { steps: async (page) => {
  await page.getByRole("switch", { name: "Demo data" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /What should I do next/ }).click();
  await page.waitForSelector('[aria-label="Next steps"]', { timeout: 20000 });
  await page.waitForTimeout(500);
}});

if (which === "all" || which === "followup") await run("08-followup", { dark: true, steps: async (page) => {
  await example(page);
  await page.getByLabel("Stage").selectOption("accepted_followup");
  await page.waitForTimeout(1500);
}});

const demoOn = async (page) => {
  await page.getByRole("switch", { name: "Demo data" }).click();
  await page.waitForTimeout(600);
};
if (which === "all" || which === "tracker") await run("09-tracker", { steps: async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: "Tracker" }).first().click();
  await page.waitForTimeout(700);
}});
if (which === "all" || which === "network") await run("10-network", { steps: async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: "Tracker" }).first().click();
  await page.getByRole("tab", { name: /Network/ }).click();
  await page.waitForTimeout(500);
}});
if (which === "all" || which === "outcome") await run("11-outcome", { steps: async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: "Tracker" }).first().click();
  await page.getByRole("button", { name: "Log outcome" }).first().click();
  await page.waitForTimeout(500);
}});
if (which === "all" || which === "addapp") await run("12-add-app", { width: 390, height: 844, steps: async (page) => {
  await page.getByRole("button", { name: "Tracker" }).first().click().catch(async () => {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Tracker" }).first().click();
  });
  await page.getByRole("button", { name: "Add application" }).click();
  await page.waitForTimeout(500);
}});

if (which === "all" || which === "craft") await run("13-craft", { height: 1100, steps: async (page) => {
  await demoOn(page);
  await example(page);
  await page.evaluate(() => document.querySelector('[aria-label="Craft this application"]')?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(800);
}});
if (which === "all" || which === "playbook") await run("14-playbook", { height: 1000, steps: async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: /^Insights/ }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Use this rule" }).first().click();
  await page.waitForTimeout(400);
}});
if (which === "all" || which === "working") await run("15-whats-working", { height: 1000, steps: async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: /^Insights/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByText("Which openings get accepted").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
}});

const sampleCraft = async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: /Try it with a sample/ }).click();
  await page.waitForSelector('[aria-label="Craft this application"]', { timeout: 30000 });
};
const tailor = async (page) => {
  await sampleCraft(page);
  await page.getByRole("button", { name: "Tailor my resume for this job" }).click();
  await page.waitForSelector('[aria-label="Tailored resume"]', { timeout: 30000 });
};
const reveal = (label) => (page) => page.evaluate((l) => document.querySelector(`[aria-label="${l}"]`)?.scrollIntoView({ block: "start" }), label);
if (which === "all" || which === "skills") await run("20-skills", { steps: async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: "Skills" }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^ATS optimizer/ }).click();
  await page.waitForTimeout(400);
}});
if (which === "all" || which === "tailor") await run("21-tailor", { height: 1000, steps: async (page) => {
  await tailor(page);
  await reveal("Tailored resume")(page);
  await page.waitForTimeout(500);
}});
if (which === "all" || which === "compare") await run("22-compare", { height: 1000, steps: async (page) => {
  await tailor(page);
  await page.getByRole("tab", { name: "Compare with baseline skills" }).click();
  await page.waitForTimeout(2000);
  await reveal("Tailored resume")(page);
  await page.waitForTimeout(400);
}});
if (which === "all" || which === "jobtypes") await run("23-jobtypes", { height: 1000, steps: async (page) => {
  await demoOn(page);
  await page.getByRole("button", { name: /^Insights/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByText("By job type").scrollIntoViewIfNeeded();
}});
if (which === "all" || which === "interview") await run("25-interview", { height: 1000, steps: async (page) => {
  await sampleCraft(page);
  await page.waitForSelector('[aria-label="Outreach draft"]', { timeout: 30000 });
  await page.getByRole("textbox").first().fill("interview prep please");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[aria-label="Interview prep"] ol', { timeout: 30000 });
  await reveal("Interview prep")(page);
  await page.waitForTimeout(400);
}});

// Public pages
if (which === "all" || which === "pages") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pages: ${e.message}`));
  for (const p of ["results", "case", "changelog"]) {
    await page.goto(`${base}/${p}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/page-${p}.png`, fullPage: true });
  }
  await page.goto(`${base}/lab`);
  await page.getByRole("button", { name: /Run 1,500/ }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/page-lab.png`, fullPage: true });
  await ctx.close();
  console.log(errors.length ? errors.join("\n") : "pages ok");
}

await browser.close();
console.log(errors.length ? errors.join("\n") : "no console errors");
