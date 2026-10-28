import { execSync } from "node:child_process";
import { existsSync, readdirSync, statfsSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, freemem, homedir, loadavg, platform, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";

// Browser launch, the on-screen overlay (caption + cursor) and the helpers a
// scenario receives. Nothing here knows about a particular app.

export const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "demo-video");
const PLAYWRIGHT_NAMES = ["playwright-core", "playwright", "@playwright/test"];
const require = createRequire(import.meta.url);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
const firstLine = (text) => String(text ?? "").split("\n").find((line) => line.trim()) ?? "";

// ---------------------------------------------------------------- playwright

// Playwright comes from, in order: an explicit path, the project (cwd upward),
// a package of a pnpm/workspace monorepo, then the skill's cache install.
export function loadPlaywright(explicit) {
  const candidates = explicit ? [resolve(explicit)] : [];
  for (const base of [process.cwd(), CACHE_DIR]) {
    const local = createRequire(join(base, "noop.js"));
    for (const name of PLAYWRIGHT_NAMES) {
      try {
        candidates.push(dirname(local.resolve(`${name}/package.json`)));
      } catch {}
    }
    if (base === process.cwd()) candidates.push(...nestedPlaywright(base));
  }
  for (const dir of candidates) {
    try {
      const mod = require(dir);
      if (mod.chromium) return { chromium: mod.chromium, from: dir };
    } catch {}
  }
  throw new Error(
    "Playwright not found in this project. Install the browser-free core once:\n" +
      `  npm install --prefix ${CACHE_DIR} playwright-core\n` +
      "It downloads no browser: the system Google Chrome is used. Or pass --playwright <package dir>.",
  );
}

function nestedPlaywright(root) {
  const found = [];
  const pnpm = join(root, "node_modules", ".pnpm");
  if (existsSync(pnpm)) {
    for (const entry of readdirSync(pnpm).sort().reverse()) {
      const match = /^(playwright-core|playwright)@\d[\w.-]*$/.exec(entry);
      if (match) found.push(join(pnpm, entry, "node_modules", match[1]));
    }
  }
  for (const group of ["apps", "packages"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const pkg of readdirSync(dir)) {
      for (const name of PLAYWRIGHT_NAMES) {
        const candidate = join(dir, pkg, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) found.push(candidate);
      }
    }
  }
  return found;
}

// Headless system Chrome. The window size must equal the viewport, or the
// screencast captures a smaller area and cuts off the bottom of the page.
export async function launchChrome(chromium, { width, height, chrome }) {
  const options = { headless: true, args: [`--window-size=${width},${height}`] };
  if (chrome) options.executablePath = chrome;
  else options.channel = "chrome";
  try {
    return await chromium.launch(options);
  } catch (error) {
    throw new Error(`Could not start Google Chrome: ${firstLine(error.message)}\n` +
      "Install Google Chrome, or set `chrome` in the config to a Chrome executable.");
  }
}

// Closes without ever hanging the run.
export async function closeQuietly(browser, timeoutMs = 15_000) {
  if (!browser) return;
  const closed = await Promise.race([browser.close().then(() => true, () => true), sleep(timeoutMs).then(() => false)]);
  if (!closed) log("browser did not close in time; it is killed when this process exits");
}

// ---------------------------------------------------------------- machine

export function machineReport(workDir) {
  const lines = [];
  const warnings = [];
  const load = loadavg()[0];
  const cores = cpus().length;
  lines.push(`load ${load.toFixed(1)} on ${cores} cores`);
  if (load > cores) warnings.push(`load ${load.toFixed(1)} is above ${cores} cores`);
  let freePct = Math.round((100 * freemem()) / totalmem());
  if (platform() === "darwin") {
    try {
      const out = execSync("memory_pressure -Q", { timeout: 5000 }).toString();
      const match = /free percentage:\s*(\d+)%/.exec(out);
      if (match) freePct = Number(match[1]);
    } catch {}
  }
  lines.push(`memory ${freePct}% free`);
  if (freePct < 20) warnings.push(`only ${freePct}% memory free`);
  try {
    const fs = statfsSync(existsSync(workDir) ? workDir : dirname(workDir));
    const gb = (fs.bavail * fs.bsize) / 1e9;
    lines.push(`disk ${gb.toFixed(1)} GB free`);
    if (gb < 3) warnings.push(`only ${gb.toFixed(1)} GB free disk for frames`);
  } catch {}
  return { lines, warnings };
}

// ---------------------------------------------------------------- overlay

// Runs in every page and frame before the page's own scripts. Caption and cursor
// state live in Node (exposed as __demoState) and in sessionStorage, so they
// come back after a navigation, even to another origin.
function installOverlay({ accent, position }) {
  if (window.top !== window) return;
  const KEY = "__demoOverlay";
  const install = () => {
    if (document.getElementById("demo-overlay")) return;
    // A closed shadow root keeps the overlay out of the app's styles and out of
    // every locator: a check must never pass on the caption's own text.
    const host = document.createElement("div");
    host.id = "demo-overlay";
    host.style.cssText = "all: initial";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      #demo-caption { position: fixed; ${position === "bottom" ? "bottom: 18px" : "top: 14px"}; left: 50%;
        transform: translateX(-50%); z-index: 2147483647; max-width: min(980px, calc(100vw - 40px));
        padding: 12px 22px; border-radius: 14px; background: rgba(17, 24, 39, .92); color: #fff;
        font: 500 17px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.25);
        pointer-events: none; text-align: center; transition: opacity .25s; }
      #demo-caption:empty { opacity: 0; }
      #demo-caption .step { display: inline-block; margin-right: 10px; padding: 2px 9px; border-radius: 999px;
        background: ${accent}; font-size: 13px; font-weight: 700; vertical-align: 1px; }
      #demo-caption .sub { display: block; margin-top: 3px; font-size: 14px; font-weight: 400; color: #d1d5db; }
      #demo-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px;
        border-radius: 50%; background: color-mix(in srgb, ${accent} 25%, transparent); border: 2px solid ${accent};
        pointer-events: none; left: -100px; top: -100px; transition: transform .15s; }
      #demo-cursor.down { transform: scale(.6); background: color-mix(in srgb, ${accent} 55%, transparent); }`;
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    root.append(style, caption, cursor);
    document.body.append(host);
    const apply = (state) => {
      if (!state) return;
      caption.replaceChildren();
      const c = state.caption;
      if (c) {
        if (c.step) caption.append(Object.assign(document.createElement("span"), { className: "step", textContent: c.step }));
        caption.append(c.title);
        if (c.sub) caption.append(Object.assign(document.createElement("span"), { className: "sub", textContent: c.sub }));
      }
      if (state.cursor) {
        cursor.style.left = state.cursor[0] + "px";
        cursor.style.top = state.cursor[1] + "px";
      }
    };
    window.__demoApply = (state) => {
      try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch {}
      apply(state);
    };
    try { apply(JSON.parse(sessionStorage.getItem(KEY) || "null")); } catch {}
    window.__demoState?.().then(apply, () => {});
    addEventListener("mousemove", (e) => {
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
    }, true);
    addEventListener("mousedown", () => cursor.classList.add("down"), true);
    addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  };
  if (document.body) install();
  else document.addEventListener("DOMContentLoaded", install);
}

// ---------------------------------------------------------------- helpers

const COOKIE_REJECT =
  /^(reject|decline|refuse|deny)( all)?\b|only (necessary|essential)|(necessary|essential) only|refuser|tout refuser|alles weigeren|weigeren|ablehnen|rechazar/i;

export class SectionError extends Error {}
export class CheckError extends SectionError {}

// Everything a scenario receives. `capture` is null on a dry run, where holds
// are skipped and pauses shrink to a short settle: skipping them too lets a
// check read a page that is still redirecting, a race the take never has.
export async function createDemo({ context, page, config, capture, dryRun, workDir }) {
  const state = { caption: null, cursor: null };
  const checks = [];
  const failures = [];
  const screenshots = [];
  const modes = ["normal"];
  let section = 0;
  const base = config.baseURL;
  // A failed check in the take means the video shows the wrong thing: stop early.
  const onCheckFail = config.onCheckFail ?? (dryRun ? "continue" : "abort");

  await context.exposeBinding("__demoState", () => state);
  await context.addInitScript(installOverlay, { accent: config.accent, position: config.captionPosition });

  const pause = (ms) => sleep(dryRun ? Math.min(ms, 250) : ms);
  const withMode = async (mode, work) => {
    modes.push(mode);
    capture?.setMode(mode);
    try {
      return await work();
    } finally {
      modes.pop();
      capture?.setMode(modes.at(-1));
    }
  };
  const locate = (target, on = page) => (typeof target === "string" ? on.locator(target) : target);
  const byText = (text, within) => (within ? locate(within) : page).getByText(text);
  const push =() => page.evaluate((s) => window.__demoApply?.(s), state).catch(() => {});

  // React apps render forms before they work: acting before hydration submits
  // them natively (once, a password ended up in the URL). Wait for React's
  // keys on the element; an element React never manages is let through once
  // the rest of the page shows React keys.
  const isReact = (on) =>
    on.evaluate(() => Boolean(window.__NEXT_DATA__ || window.__next_f || window.__remixContext ||
      window.__reactRouterContext || document.querySelector("#__next, [data-reactroot]") ||
      [...document.querySelectorAll("body *")].slice(0, 300).some((el) => Object.keys(el).some((k) => k.startsWith("__react")))))
      .catch(() => false);
  async function ready(target) {
    if (config.framework === "none") return;
    const loc = locate(target);
    const on = loc.page();
    if (config.framework !== "react" && !(await isReact(on))) return;
    const handle = await loc.elementHandle({ timeout: 30_000 });
    try {
      const start = Date.now();
      await withMode("ff", () => on.waitForFunction(([el, since]) => {
        const keyed = (node) => Object.keys(node).some((k) => k.startsWith("__react"));
        if (keyed(el)) return true;
        return Date.now() - since > 15_000 &&
          [...document.querySelectorAll("body *")].slice(0, 300).some(keyed);
      }, [handle, start], { timeout: 90_000, polling: 100 }));
    } finally {
      await handle.dispose().catch(() => {});
    }
  }

  async function moveTo(target) {
    const loc = locate(target);
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) return;
    const to = [box.x + box.width / 2, box.y + box.height / 2];
    const from = state.cursor ?? [to[0], to[1]];
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    await page.mouse.move(to[0], to[1], { steps: dryRun ? 1 : Math.round(Math.min(30, Math.max(8, distance / 25))) });
    state.cursor = to;
    await pause(250);
  }

  async function visible(loc, timeout = 30_000) {
    if (await loc.isVisible().catch(() => false)) return;
    await withMode("ff", () => loc.waitFor({ state: "visible", timeout }));
  }

  // True once any match is visible. Unlike locator.waitFor, several matches are
  // fine, and hidden copies are skipped (Radix keeps a hidden native <select>
  // beside its picker, so .first() would wait on an element nobody sees).
  async function anyVisible(loc, timeout) {
    for (const end = Date.now() + timeout; ; await sleep(200)) {
      const count = Math.min(await loc.count().catch(() => 0), 50);
      for (let i = 0; i < count; i++) {
        if (await loc.nth(i).isVisible().catch(() => false)) return true;
      }
      if (Date.now() >= end) return false;
    }
  }

  // A page outside the video, in its own browser context with the main one's
  // cookies and localStorage. A second tab in the main context shrinks its
  // screencast frames (1440×813 for a 1440×900 viewport) for the rest of the take.
  const sideContext = async () =>
    context.browser().newContext({ locale: config.locale, ...config.context, storageState: await context.storageState() });

  const demo = {
    page,
    context,
    config,
    dryRun,
    log,
    url: (path) => new URL(path, base).href,

    // A numbered chapter. A failure stops the run, unless the section is optional
    // or the config says onError: "continue"; a screenshot is kept either way.
    // Frames that stop matching the viewport fail the section: the rest would be cropped.
    async section(title, work, { optional = false } = {}) {
      section += 1;
      capture?.chapter(`${section}. ${title}`);
      log(`§${section} ${title}`);
      try {
        await work();
        const size = capture?.mismatch();
        if (size) {
          const { width, height } = config.viewport;
          throw new Error(`frames are ${size.width}×${size.height}, not the ${width}×${height} viewport: the video is cropped from here on`);
        }
      } catch (error) {
        let screenshot = checks.at(-1)?.screenshot;
        if (!(error instanceof CheckError)) {
          screenshot = join(workDir, `error-section-${section}.png`);
          await page.screenshot({ path: screenshot }).catch(() => {});
        }
        failures.push({ section, title, message: firstLine(error.message), screenshot, check: error instanceof CheckError });
        log(`  ✗ §${section} failed: ${firstLine(error.message)}`);
        if (!(error instanceof CheckError)) log(`    screenshot: ${screenshot}`);
        if (!optional && config.onError !== "continue") {
          throw new SectionError(`Section ${section} « ${title} » failed: ${firstLine(error.message)}`);
        }
      }
    },

    // Shows a caption, then holds it at real speed long enough to read.
    async caption(title, sub = "", holdMs) {
      state.caption = title ? { step: section ? String(section) : "", title, sub } : null;
      await push();
      log(`  » ${title}${sub ? ` — ${sub}` : ""}`);
      const reading = 1200 + 40 * (title.length + sub.length);
      await demo.hold(Math.max(1200, holdMs ?? Math.min(6000, reading)));
    },
    async clearCaption() {
      state.caption = null;
      await push();
    },
    // Real-time stretch: never sped up in the video.
    hold: (ms) => (dryRun ? Promise.resolve() : withMode("hold", () => sleep(ms))),
    // Plays at the normal, sped-up pace.
    pause,
    // Squeezes whatever the work waits for (`fastForward(work)`, or `fastForward(speed, work)`).
    fastForward: (a, b) => withMode("ff", typeof a === "function" ? a : b),

    async goto(path, readySelector) {
      await withMode("ff", async () => {
        await page.goto(demo.url(path), { waitUntil: "domcontentloaded", timeout: 120_000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        if (config.ready) await config.ready(page);
        if (readySelector) {
          const loc = locate(readySelector).first();
          await loc.waitFor({ state: "visible", timeout: 60_000 });
          await ready(loc);
        }
      });
      await demo.dismissCookies();
      await pause(400);
    },

    async click(target, { after = 600 } = {}) {
      const loc = locate(target);
      await visible(loc);
      await ready(loc);
      await moveTo(loc);
      await loc.click();
      await pause(after);
    },
    async typeInto(target, text, { delay = 22, clear = true, after = 400 } = {}) {
      const loc = locate(target);
      await demo.click(loc, { after: 150 });
      if (clear) await loc.fill("");
      await loc.pressSequentially(text, { delay: dryRun ? 0 : delay });
      await pause(after);
    },
    // Fills a secret from an environment variable; the value is never logged.
    async typeSecret(target, envName) {
      const secret = process.env[envName];
      if (!secret) throw new Error(`Environment variable ${envName} is not set`);
      const loc = locate(target);
      await demo.click(loc, { after: 100 });
      await loc.fill(secret);
      await pause(300);
    },
    async hover(target, holdMs = 1500) {
      const loc = locate(target);
      await visible(loc);
      await moveTo(loc);
      await loc.hover();
      await demo.hold(holdMs);
    },
    async press(key, { after = 300 } = {}) {
      await page.keyboard.press(key);
      await pause(after);
    },
    async scroll(dy, { after = 600 } = {}) {
      await page.mouse.wheel(0, dy);
      await pause(after);
    },
    moveTo,
    ready,

    // Waits for a locator, a text (in `within` when given), or an async function;
    // squeezed in the video.
    async waitFor(target, { timeout = 60_000, ff = true, optional = false, within } = {}) {
      const work = typeof target === "function" ? target : async () => {
        const loc = typeof target === "string" ? byText(target, within) : target;
        if (!(await anyVisible(loc, timeout))) {
          throw new Error(`nothing visible after ${timeout / 1000} s: ${typeof target === "string" ? `« ${target} »` : loc}`);
        }
      };
      try {
        await (ff ? withMode("ff", work) : work());
        return true;
      } catch (error) {
        if (!optional) throw error;
        log(`  ⚠ gave up waiting: ${firstLine(error.message)}`);
        return false;
      }
    },
    // Runs `action`, then waits until `target` matches more elements than before,
    // e.g. one more « Copy » button once an AI answer has finished. Logs and
    // continues on timeout. `failOn` (a locator, or a text) is the app's error
    // state: when it gains a match, the wait throws at once instead of timing out.
    async waitForNew(target, action, { timeout = 120_000, failOn } = {}) {
      const loc = locate(target);
      const fail = typeof failOn === "string" ? page.getByText(failOn) : failOn;
      const before = await loc.count();
      const failsBefore = fail ? await fail.count() : 0;
      await action();
      const outcome = await withMode("ff", async () => {
        for (const end = Date.now() + timeout; Date.now() < end; await sleep(400)) {
          if ((await loc.count()) > before) return "new";
          if (fail && (await fail.count()) > failsBefore) return "failed";
        }
        return "timeout";
      });
      if (outcome === "failed") throw new Error(`the app showed its error state (failOn: ${typeof failOn === "string" ? `« ${failOn} »` : failOn})`);
      if (outcome === "timeout") log(`  ⚠ nothing new after ${timeout / 1000} s, continuing`);
      return outcome === "new";
    },

    // Records whether a text proving the behaviour is visible, in `within` when
    // given (scope it to where the proof lives, e.g. the conversation).
    async expectText(text, { timeout = 5000, within } = {}) {
      const ok = await withMode("ff", () => anyVisible(byText(text, within), timeout));
      return demo.check(`text « ${text} »${within ? ` in ${typeof within === "string" ? within : "scope"}` : ""}`, ok);
    },
    // A failed check gets a screenshot; in the take it also fails its section
    // (config.onCheckFail: "continue" keeps going), on a dry run it never throws.
    check(name, ok) {
      const entry = { section, name, ok: Boolean(ok) };
      checks.push(entry);
      log(`  ${entry.ok ? "✓" : "✗"} ${name}`);
      if (entry.ok) return true;
      entry.screenshot = join(workDir, `check-${checks.length}.png`);
      log(`    screenshot: ${entry.screenshot}`);
      screenshots.push(page.screenshot({ path: entry.screenshot }).catch(() => delete entry.screenshot));
      if (onCheckFail === "abort") throw new CheckError(`check failed: ${name}`);
      return false;
    },

    // Generic form login: waits for hydration, fills the email, the password from
    // an env var, submits the form that holds the password field.
    async login({ url = "/login", email, passwordEnv = "DEMO_PASSWORD", emailField, passwordField = "input[type=password]", submit, until } = {}) {
      await demo.goto(url, passwordField);
      const form = page.locator("form", { has: page.locator(passwordField) });
      const emailInput = form.locator(emailField ?? "input[type=email], input[name=email], input[name=username], input[autocomplete=username]").first();
      if (email) await demo.typeInto(emailInput, email, { delay: 12, after: 150 });
      await demo.typeSecret(form.locator(passwordField), passwordEnv);
      const button = submit ? locate(submit) : form.locator("button[type=submit], input[type=submit]").first();
      const loginPath = new URL(demo.url(url)).pathname;
      await demo.click(button, { after: 300 });
      await withMode("ff", () => (until
        ? locate(until).first().waitFor({ state: "visible", timeout: 60_000 })
        : page.waitForURL((u) => u.pathname !== loginPath, { timeout: 60_000 })));
      await pause(800);
    },

    // Rejects optional cookies when a consent banner shows (the privacy-preserving choice).
    async dismissCookies() {
      if (config.cookies === false) return false;
      const buttons = page.getByRole("button", { name: config.cookieReject ?? COOKIE_REJECT });
      const count = Math.min(await buttons.count().catch(() => 0), 5);
      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i);
        if (!(await button.isVisible().catch(() => false))) continue;
        const inBanner = await button.evaluate((el) => {
          for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
            const text = node.textContent ?? "";
            if (text.length > 5000) return false;
            if (/cookie|consent|gdpr|rgpd|privacy|confidentialit|privacybeleid/i.test(text)) return true;
          }
          return false;
        }).catch(() => false);
        if (!inBanner) continue;
        await moveTo(button);
        await button.click().catch(() => {});
        await pause(300);
        log("  cookie banner: optional cookies rejected");
        return true;
      }
      return false;
    },

    // Runs SQL through the project's command (config.db.command reads the query on stdin).
    sql(query) {
      if (!config.db?.command) throw new Error("sql() needs config.db.command, e.g. docker exec -i <db> psql -U postgres -d app -tA");
      log(`  sql: ${query.replace(/\s+/g, " ").slice(0, 90)}`);
      return execSync(config.db.command, { input: query, stdio: ["pipe", "pipe", "inherit"] }).toString().trim();
    },

    // Pages the video does not show (see sideContext); say what happens there in a caption.
    async newPage() {
      const side = await sideContext();
      const other = await side.newPage();
      other.once("close", () => side.close().catch(() => {}));
      return other;
    },
    async offCamera(work) {
      const side = await sideContext();
      try {
        return await withMode("ff", async () => work(await side.newPage()));
      } finally {
        await side.close().catch(() => {});
        await page.bringToFront().catch(() => {});
      }
    },

    // Waits for the screenshots of failed checks; call before closing the browser.
    settle: () => Promise.all(screenshots),
    results: () => ({ checks, failures, sections: section }),
  };
  return demo;
}
