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
  await page.getByRole("switch").check();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Insights/ }).first().click();
  await page.waitForTimeout(800);
}});
if (which === "all" || which === "strategy") await run("07-strategy", { steps: async (page) => {
  await page.getByRole("switch").check();
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
