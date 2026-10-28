#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { startCapture } from "./capture.mjs";
import { clock, DEFAULTS as ENCODE_DEFAULTS, encode, ffmpegWorks } from "./encode.mjs";
import { closeQuietly, createDemo, launchChrome, loadPlaywright, log, machineReport, SectionError, sleep } from "./runtime.mjs";

// Runs a scenario file in headless Chrome and turns it into a video.
//
//   node run-scenario.mjs SCENARIO --smoke      3 s capture, checks the frame size, records nothing
//   node run-scenario.mjs SCENARIO --dry-run    runs every step at full speed, no capture
//   node run-scenario.mjs SCENARIO              records, encodes, keeps sample frames, deletes the rest
//
// Options: --name N  --out DIR  --work DIR  --format auto|webm|mp4  --keep-frames  --playwright DIR

const USAGE = "usage: run-scenario.mjs <scenario.mjs> [--smoke | --dry-run] [--name NAME] [--out DIR] [--work DIR] " +
  "[--format auto|webm|mp4] [--keep-frames] [--playwright DIR]";

const BADGES = { fr: "⏩ accéléré", nl: "⏩ versneld", de: "⏩ beschleunigt", es: "⏩ acelerado", it: "⏩ accelerato" };

const CONFIG_DEFAULTS = {
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  accent: "#9333ea",
  captionPosition: "top",
  framework: "auto", // "react" | "none" | "auto": wait for React hydration before acting
  cookies: true,
  onError: "abort", // or "continue"
  // onCheckFail: "abort" in the take, "continue" on a dry run, unless set
  // setup: async (demo) => {…}, // runs before the scenario, fast-forwarded: reset data and app limits
  env: [], // env var names the scenario needs, checked before anything starts
  capture: { quality: 70, everyNthFrame: 1 }, // 2 halves disk use but can drop the single repaint of a caption change
  video: {},
};

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes > 1e8 ? 0 : 1)} MB`;

// Never overwrites an earlier video: name.webm, then name-2.webm, name-3.webm…
function freePath(dir, name, ext) {
  for (let i = 1; ; i++) {
    const file = join(dir, `${name}${i > 1 ? `-${i}` : ""}.${ext}`);
    if (!existsSync(file)) return file;
  }
}

function defaultOutDir() {
  for (const dir of [join(homedir(), "Movies"), join(homedir(), "Videos")]) {
    if (existsSync(dir)) return join(dir, "demo-videos");
  }
  return resolve("demo-videos");
}

async function loadConfig(scenarioPath, scenario) {
  let project = {};
  for (const dir of [dirname(scenarioPath), process.cwd()]) {
    const file = join(dir, "demo.config.mjs");
    if (existsSync(file)) {
      project = (await import(pathToFileURL(file).href)).default ?? {};
      log(`project config: ${file}`);
      break;
    }
  }
  const own = scenario.config ?? {};
  const config = { ...CONFIG_DEFAULTS, ...project, ...own };
  for (const key of ["viewport", "capture", "video", "db"]) config[key] = { ...CONFIG_DEFAULTS[key], ...project[key], ...own[key] };
  config.badge ??= BADGES[(config.language ?? config.locale).slice(0, 2)] ?? ENCODE_DEFAULTS.badge;
  return config;
}

function loadEnv(config) {
  if (config.envFile) {
    const file = resolve(config.envFile);
    if (!existsSync(file)) throw new Error(`envFile not found: ${file}`);
    process.loadEnvFile(file);
  }
  const missing = (config.env ?? []).filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}. ` +
      "Set them in the shell or in the file named by config.envFile; never put them in the scenario.");
  }
}

// One frame per chapter, taken in the middle of its last hold (usually the caption
// that sums the section up, over its final state), plus the last frame.
function pickSamples(capture) {
  const holds = capture.marks.map((m, i) => ({ mode: m.mode, start: m.t, end: capture.marks[i + 1]?.t ?? capture.end }))
    .filter((s) => s.mode === "hold");
  const times = capture.chapters.length
    ? capture.chapters.map((c, i) => {
      const end = capture.chapters[i + 1]?.t ?? capture.end;
      const hold = holds.findLast((h) => h.start >= c.t && h.start < end);
      return { t: hold ? (hold.start + hold.end) / 2 : Math.min(end, c.t + 1500), label: c.title, section: i + 1 };
    })
    : Array.from({ length: 6 }, (_, i) => ({ t: (capture.end * (i + 0.5)) / 6, label: `at ${clock(capture.end * (i + 0.5) / 6)}` }));
  times.push({ t: capture.end, label: "end" });
  return times.map(({ t, label, section }) => ({ label, section, frame: capture.frames.findLast((f) => f.t <= t) ?? capture.frames[0] }));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      smoke: { type: "boolean" }, "dry-run": { type: "boolean" }, name: { type: "string" }, out: { type: "string" },
      work: { type: "string" }, format: { type: "string", default: "auto" }, "keep-frames": { type: "boolean" },
      playwright: { type: "string" },
    },
  });
  if (positionals.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const scenarioPath = resolve(positionals[0]);
  const scenario = await import(pathToFileURL(scenarioPath).href);
  if (typeof scenario.default !== "function") throw new Error(`${scenarioPath} must export a default async function (demo) => {…}`);
  const config = await loadConfig(scenarioPath, scenario);
  if (!config.baseURL) throw new Error("config.baseURL is required (in the scenario's `config` or in demo.config.mjs).");
  loadEnv(config);

  const name = slug(values.name ?? config.name ?? basename(scenarioPath).replace(/\.[^.]+$/, ""));
  const workDir = resolve(values.work ?? join(tmpdir(), "demo-video", name));
  mkdirSync(workDir, { recursive: true });
  const { width, height } = config.viewport;
  const { chromium, from } = loadPlaywright(values.playwright ?? config.playwright);
  log(`playwright: ${from}`);
  const machine = machineReport(workDir);
  log(`machine: ${machine.lines.join(", ")}`);
  for (const warning of machine.warnings) log(`  ⚠ ${warning}`);

  const browser = await launchChrome(chromium, { width, height, chrome: config.chrome });
  let capture = null;
  const shutdown = async () => {
    log("interrupted: stopping capture and browser");
    await capture?.stop().catch(() => {});
    await closeQuietly(browser, 5000);
    process.exit(130);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: config.locale, ...config.context });
  const page = await context.newPage();
  const framesDir = join(workDir, "frames");

  // ---- smoke: a short capture proves the frame size before anything else
  if (values.smoke) {
    capture = await startCapture({ page, dir: framesDir, ...config.capture });
    await page.goto(config.baseURL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const size = await capture.firstFrameSize();
    // Scroll for 3 s so the disk estimate reflects a page that moves.
    await page.mouse.move(width / 2, height / 2);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, i % 6 < 3 ? 250 : -250);
      await sleep(250);
    }
    const stopped = await capture.stop();
    await closeQuietly(browser);
    rmSync(framesDir, { recursive: true, force: true });
    if (!size) throw new Error(`No frame arrived within 10 s (${stopped.frames} in total). Is the app running at ${config.baseURL}?`);
    const perMinute = (stopped.bytes / (stopped.end / 1000)) * 60;
    if (size.width !== width || size.height !== height) {
      throw new Error(`Frame is ${size.width}×${size.height}, viewport is ${width}×${height}: the capture would crop the page.`);
    }
    log(`smoke ok: frames are ${size.width}×${size.height} = viewport; ${stopped.frames} frames in 3 s of scrolling, ` +
      `up to ≈ ${mb(perMinute)} of frames per minute of busy recording`);
    return 0;
  }

  // ---- dry run or recording
  const dryRun = Boolean(values["dry-run"]);
  if (!dryRun) {
    capture = await startCapture({
      page, dir: framesDir, ...config.capture, expect: { width, height },
      onResize: (size, off) => log(off ? `  ⚠ frames are now ${size.width}×${size.height}, not the ${width}×${height} viewport`
        : `  frames are back to ${size.width}×${size.height}`),
    });
    capture.setMode("ff");
    await page.setContent("<body style='margin:0;background:#fff'></body>");
    const size = await capture.firstFrameSize();
    capture.setMode("normal");
    if (!size || size.width !== width || size.height !== height) {
      await capture.stop();
      await closeQuietly(browser);
      rmSync(framesDir, { recursive: true, force: true });
      throw new Error(size ? `Frame is ${size.width}×${size.height}, viewport is ${width}×${height}: aborting before the take.`
        : "No frame arrived from the screencast: aborting before the take.");
    }
  }
  const demo = await createDemo({ context, page, config, capture, dryRun, workDir });
  log(dryRun ? `dry run of ${basename(scenarioPath)} against ${config.baseURL}` : `recording ${name}…`);
  let failure = null;
  const started = Date.now();
  try {
    if (config.setup) {
      log("setup");
      await demo.fastForward(() => config.setup(demo));
    }
    await scenario.default(demo);
  } catch (error) {
    failure = error;
  }
  await demo.settle();
  const stopped = capture ? await capture.stop() : null;
  await closeQuietly(browser);
  const { checks, failures, sections } = demo.results();
  const passed = checks.filter((c) => c.ok).length;
  const report = { name, scenario: scenarioPath, dryRun, sections, checks, failures, machine: machine.lines };

  if (failure) {
    log(failure instanceof SectionError ? `✗ ${failure.message}` : `✗ scenario crashed: ${failure.stack ?? failure}`);
    if (stopped && !values["keep-frames"]) rmSync(framesDir, { recursive: true, force: true });
    writeFileSync(join(workDir, "report.json"), JSON.stringify({ ...report, error: String(failure.message) }, null, 2));
    log(`report: ${join(workDir, "report.json")}`);
    return 1;
  }
  if (dryRun) {
    log(`dry run done in ${clock(Date.now() - started)}: ${sections} sections, ${failures.length} failed, ` +
      `checks ${passed}/${checks.length} passed`);
    for (const c of checks.filter((x) => !x.ok)) log(`  ✗ §${c.section} ${c.name}${c.screenshot ? `  (${c.screenshot})` : ""}`);
    writeFileSync(join(workDir, "report.json"), JSON.stringify(report, null, 2));
    return failures.length ? 1 : passed < checks.length ? 3 : 0;
  }

  // ---- samples, encode, clean up
  const captureData = JSON.parse(readFileSync(join(framesDir, "capture.json"), "utf8"));
  const samplesDir = join(workDir, "samples");
  rmSync(samplesDir, { recursive: true, force: true });
  mkdirSync(samplesDir);
  const samples = pickSamples(captureData).map(({ label, section, frame }, i) => {
    const file = join(samplesDir, `${String(i + 1).padStart(2, "0")}-${slug(label).slice(0, 40)}.jpg`);
    copyFileSync(join(framesDir, frame.file), file);
    return { file, section };
  });
  // Sections with a failure or a failed check: their samples are looked at first.
  const flagged = new Set([...failures, ...checks.filter((c) => !c.ok)].map((x) => x.section));
  const review = samples.filter((s) => flagged.has(s.section));

  const format = values.format === "auto" ? (ffmpegWorks() ? "mp4" : "webm") : values.format;
  const outDir = resolve(values.out ?? defaultOutDir());
  mkdirSync(outDir, { recursive: true });
  const out = freePath(outDir, name, format);
  const result = await encode({
    framesDir, out, chromium, chrome: config.chrome, badge: config.badge, accent: config.accent, ...config.video,
  });
  if (!values["keep-frames"]) rmSync(framesDir, { recursive: true, force: true });

  const lines = [
    `Video     ${result.out}`,
    `Format    ${format.toUpperCase()} ${result.size.width}×${result.size.height}` +
      (format === "webm" ? " (plays in Chrome, Firefox or VLC; not QuickTime)" : ""),
    `Length    ${clock(result.probe.seconds * 1000)} (captured ${clock(result.capturedMs)}, planned ${clock(result.expectedMs)})`,
    `Size      ${mb(result.bytes)}`,
    `Chapters  ${result.chaptersFile}`,
    ...result.chapters.map((c) => `            ${clock(c.ms).padStart(5)}  ${c.title}`),
    `Checks    ${passed}/${checks.length} passed` + (failures.length ? `, ${failures.length} optional section(s) failed` : ""),
    ...checks.filter((c) => !c.ok).map((c) => `            ✗ §${c.section} ${c.name}${c.screenshot ? `  (${c.screenshot})` : ""}`),
    ...failures.filter((f) => !f.check).map((f) => `            ✗ §${f.section} « ${f.title} »: ${f.message}  (${f.screenshot})`),
    `Frames    ${stopped.frames} frames, ${mb(stopped.bytes)} on disk — ` +
      (values["keep-frames"]
        ? `kept in ${framesDir}; re-encode with: node ${join(import.meta.dirname, "encode.mjs")} --work ${workDir} --out <file>`
        : "deleted"),
    `Samples   ${samplesDir} (${samples.length} frames to check)`,
    ...(review.length ? [`Review    first: ${review.map((s) => basename(s.file)).join(", ")}`] : []),
  ];
  const cropped = stopped.sizes.find((s) => s.width !== width || s.height !== height);
  if (cropped) {
    lines.push(`⚠ frames left the ${width}×${height} viewport from capture time ${clock(cropped.t)} (${cropped.width}×${cropped.height})`);
  }
  if (result.probe.error) lines.push(`⚠ the video did not load in Chrome: ${result.probe.error}`);
  writeFileSync(join(workDir, "report.json"), JSON.stringify({ ...report, video: result, samples, frames: stopped }, null, 2));
  console.log("\n" + lines.join("\n"));
  return result.probe.error ? 1 : 0;
}

main().then((code) => process.exit(code), (error) => {
  log(`✗ ${error.message}`);
  process.exit(1);
});
