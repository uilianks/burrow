// Records the demo video shown on the download page (site/demo.mp4).
// Run `npm run demo`: it builds the app, serves out/, drives it in Chromium with Playwright
// and turns the recording into an mp4 with ffmpeg.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const OUT_DIR = new URL("../out/", import.meta.url).pathname;
const TARGET = new URL("../site/demo.mp4", import.meta.url).pathname;
const POSTER = new URL("../site/demo-poster.jpg", import.meta.url).pathname;
const SIZE = { width: 1280, height: 800 };
const SHOTS = process.env.SHOTS; // set to a folder to save a screenshot after each scene instead of judging by video

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
  try {
    const body = await readFile(join(OUT_DIR, path.endsWith("/") ? `${path}index.html` : path));
    response.writeHead(200, { "content-type": types[extname(path)] ?? "text/html" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const videoDir = await mkdtemp(join(tmpdir(), "burrow-demo-"));
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  colorScheme: "light",
  recordVideo: SHOTS ? undefined : { dir: videoDir, size: SIZE },
});
const page = await context.newPage();

// Playwright draws no pointer, so show one that follows the mouse.
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText =
      "position:fixed;z-index:99999;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;" +
      "background:rgb(10 132 255/.35);border:2px solid rgb(10 132 255/.9);pointer-events:none;transition:transform .1s";
    document.body.append(dot);
    addEventListener("mousemove", (e) => (dot.style.left = `${e.clientX}px`, dot.style.top = `${e.clientY}px`), true);
    addEventListener("mousedown", () => (dot.style.transform = "scale(.7)"), true);
    addEventListener("mouseup", () => (dot.style.transform = ""), true);
  });
});

const pause = (ms) => page.waitForTimeout(ms);
const type = (text, delay = 55) => page.keyboard.type(text, { delay });
let shot = 0;
const scene = async (name) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${String(++shot).padStart(2, "0")}-${name}.png`) });
};
/** Where an element is, scrolling it smoothly into view first if it is off screen. */
async function locate(locator) {
  let box = await locator.boundingBox({ timeout: 5000 }).catch(async (error) => {
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "failed.png") });
    throw error;
  });
  if (box.y < 40 || box.y + box.height > SIZE.height - 40) {
    await locator.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await pause(700);
    box = await locator.boundingBox();
  }
  return box;
}
/** Glide the pointer to an element and click it. */
async function click(locator) {
  const box = await locate(locator);
  if (!box) throw new Error(`not visible: ${locator}`);
  await page.mouse.move(box.x + Math.min(box.width / 2, 60), box.y + box.height / 2, { steps: 18 });
  await pause(150);
  await page.mouse.down();
  await page.mouse.up();
}
/** Glide to a native dropdown and pick a value (its open list never shows in a recording). */
async function choose(locator, value) {
  const box = await locate(locator);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await pause(200);
  await locator.selectOption(value);
  await pause(350);
}
/** Open the slash menu, filter it and pick the first match. */
async function slash(query) {
  await type("/");
  await pause(350);
  await type(query, 90);
  await pause(500);
  await page.keyboard.press("Enter");
  await pause(300);
}

await page.goto(url);
await page.mouse.move(640, 400);
await pause(1200);
await scene("start");

// A new page, written with Markdown shortcuts
await click(page.getByText("+ New page"));
await pause(500);
await click(page.locator("[data-placeholder=Untitled]"));
await type("Trip to Lisbon", 70);
await page.keyboard.press("Enter");
await type("A long weekend by the sea. Plans below.");
await page.keyboard.press("Enter");
await type("## Before we go");
await page.keyboard.press("Enter");
await type("[] Book flights");
await page.keyboard.press("Enter");
await type("Reserve a table at the pastelaria");
await page.keyboard.press("Enter");
await type("Check the tram 28 timetable");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await scene("todos");

// A callout from the slash menu, and links that create pages
await slash("callout");
await type("Pack light: everything is uphill.");
await page.keyboard.press("Enter");
await type("See [[Packing list]] and [[Restaurants]], or the [[Getting");
await pause(700);
await page.keyboard.press("Enter");
await pause(400);
await page.keyboard.press("Enter");
await scene("links");

// An equation, typed as LaTeX and rendered on the spot
await slash("equation");
await click(page.getByLabel("Equation in LaTeX"));
await type("\\text{budget} = \\sum_{d=1}^{4} (\\text{hotel} + \\text{food})_d", 25);
await pause(400);
await click(page.getByRole("checkbox", { name: "Done" }).first());
await pause(900);
await scene("equation");

// A database, then the same rows as a board
await click(page.locator("[contenteditable]").last());
await slash("database");
await pause(800);
await scene("database");

await click(page.getByLabel("Database name"));
await type("Places to see");
const places = [["Belém Tower", "Done"], ["LX Factory", "Doing"], ["Sintra day trip", "To do"], ["Time Out Market", "To do"]];
for (const [index, [name, status]] of places.entries()) {
  await click(page.getByText("+ New row"));
  await pause(250);
  await click(page.getByLabel("Row name").nth(index));
  await type(name, 45);
  await choose(page.getByLabel(`Status of ${name}`), status);
}
await pause(500);
await scene("rows");

await choose(page.getByLabel("Add a view"), "board");
await pause(1500);
await scene("board");
if (!SHOTS) await page.screenshot({ path: POSTER, type: "jpeg", quality: 85 });

// Ctrl+K: search every page and jump to one
await page.keyboard.press("Control+k");
await pause(500);
await type("pastelaria", 90);
await pause(1000);
await scene("search");
await page.keyboard.press("Escape");
await pause(400);

// The graph of pages and links
await click(page.getByText("🕸 Graph"));
await pause(2200);
await scene("graph");
await page.keyboard.press("Escape");
await pause(400);

// Dark theme from the command palette
await page.keyboard.press("Control+k");
await pause(400);
await type("Theme: dark", 80);
await pause(500);
await page.keyboard.press("Enter");
await pause(800);
await page.mouse.move(800, 400, { steps: 12 });
for (let i = 0; i < 10; i++) {
  await page.mouse.wheel(0, -60);
  await pause(40);
}
await pause(1800);
await scene("dark");

await pause(1500);
const video = page.video();
await context.close();
await browser.close();
server.close();

if (video) {
  // H.264 plays everywhere, Safari included; faststart lets it begin before it has fully downloaded
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", await video.path(), "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", TARGET], { stdio: "inherit" });
  console.log(`Wrote ${TARGET} and ${POSTER}`);
}
await rm(videoDir, { recursive: true, force: true });
