#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { jpegSize } from "./capture.mjs";
import { closeQuietly, launchChrome, loadPlaywright, log } from "./runtime.mjs";

// Turns captured frames into a video. Default: Chrome replays the frames into a
// <canvas> recorded by MediaRecorder, so no external encoder is needed (real
// time: a 4 min video takes about 4 min). When ffmpeg runs, it can write an
// MP4 instead, much faster, with chapters inside.
//
//   node encode.mjs --work DIR --out video.webm [--speedup 1.7] [--max-wait 1500] …
// re-encodes kept frames with other timing, without recording again.

export const DEFAULTS = {
  width: 1280,
  height: 0, // 0: keep the capture's aspect ratio
  fps: 25,
  bitrate: 1_500_000,
  speedup: 1.7, // normal stretches play this much faster than captured
  maxWait: 1500, // each fast-forwarded stretch lasts at most this long
  maxStill: 2000, // any other gap between frames is capped at this, before speedup
  badge: "⏩ fast-forward",
  accent: "#9333ea",
};

// ---------------------------------------------------------------- timeline

// Splits each frame's time on screen by playback mode and gives every piece its
// video duration. Returns the pieces (short ones merged) and each chapter's start.
export function buildTimeline(capture, options = {}) {
  const { speedup, maxWait, maxStill, fps } = { ...DEFAULTS, ...options };
  const { frames, marks, chapters, end } = capture;
  if (!frames.length) throw new Error("No frames were captured.");
  const segments = marks.map((m, i) => ({ mode: m.mode, start: m.t, end: marks[i + 1]?.t ?? end }));

  // Length of each fast-forwarded stretch, counted from the first frame.
  const start = frames[0].t;
  for (const s of segments) s.length = Math.max(0, Math.min(s.end, end) - Math.max(s.start, start));

  const pieces = [];
  for (let i = 0; i < frames.length; i++) {
    const from = frames[i].t;
    const to = frames[i + 1]?.t ?? end;
    for (const s of segments) {
      const a = Math.max(from, s.start);
      const b = Math.min(to, s.end);
      if (b <= a) continue;
      const real = b - a;
      const dur = s.mode === "ff" ? real * Math.min(1, maxWait / Math.max(s.length, 1))
        : s.mode === "hold" ? real
        : Math.min(real, maxStill) / speedup;
      pieces.push({ file: frames[i].file, start: a, real, dur, ff: s.mode === "ff" });
    }
  }

  // Video time of a capture time, for chapters.
  let out = 0;
  for (const p of pieces) {
    p.out = out;
    out += p.dur;
  }
  const at = (t) => {
    const p = pieces.find((q) => t < q.start + q.real) ?? pieces.at(-1);
    return t <= p.start ? p.out : p.out + Math.min(p.dur, (t - p.start) * (p.dur / Math.max(p.real, 1)));
  };
  const chapterTimes = chapters.map((c) => ({ title: c.title, ms: Math.round(at(c.t)) }));

  // Pieces shorter than one video frame are merged into the next one.
  const minFrame = 1000 / fps;
  const timeline = [];
  let carry = 0;
  for (const p of pieces) {
    carry += p.dur;
    if (carry < minFrame) continue;
    timeline.push({ file: p.file, dur: Math.round(carry), ff: p.ff });
    carry = 0;
  }
  const totalMs = timeline.reduce((sum, f) => sum + f.dur, 0);
  return { timeline, totalMs, chapters: chapterTimes, capturedMs: end - start };
}

export const clock = (ms) => {
  if (!Number.isFinite(ms)) return "unknown";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
};

export function chapterText(chapters, totalMs) {
  return chapters.map((c) => `${clock(c.ms)}  ${c.title}`).join("\n") + `\n${clock(totalMs)}  End\n`;
}

// ---------------------------------------------------------------- ffmpeg

export function ffmpegWorks() {
  const run = spawnSync("ffmpeg", ["-version"], { timeout: 10_000, stdio: "ignore" });
  return run.status === 0;
}

// ---------------------------------------------------------------- encode

function outputSize(framesDir, timeline, options) {
  if (options.height) return { width: options.width, height: options.height };
  const first = readFileSync(join(framesDir, timeline[0].file));
  const size = jpegSize(first) ?? { width: 16, height: 10 };
  const height = Math.round((options.width * size.height) / size.width / 2) * 2;
  return { width: options.width, height };
}

const PLAYER = `<!doctype html><html><body style="margin:0;background:#000"><canvas id="c"></canvas>
<script>
window.encode = async ({ width, height, fps, bitrate, badge, accent }) => {
  const frames = await (await fetch("/timeline.json")).json();
  const canvas = document.getElementById("c");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const stream = canvas.captureStream(fps);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const load = (file) => fetch("/frames/" + file).then((r) => r.blob()).then((b) => createImageBitmap(b));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scale = width / 1280;
  const drawBadge = () => {
    ctx.font = "600 " + Math.round(20 * scale) + "px -apple-system, 'Segoe UI', Roboto, sans-serif";
    const w = ctx.measureText(badge).width + 44 * scale;
    const h = 42 * scale;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.roundRect(width - w - 20 * scale, height - h - 22 * scale, w, h, h / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, width - w - 20 * scale + 22 * scale, height - h / 2 - 22 * scale);
  };
  // The stream only emits a frame when the canvas is painted, so a frame that
  // stays on screen is repainted every 250 ms; otherwise long holds, and the
  // last caption, would be cut short in the recording.
  const paint = (bitmap, ff) => {
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (ff) drawBadge();
  };
  let next = load(frames[0].file);
  recorder.start(1000);
  const t0 = performance.now();
  let at = 0;
  let shown = 0;
  let bitmap = null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    bitmap?.close();
    bitmap = await next;
    if (i + 1 < frames.length) next = load(frames[i + 1].file);
    paint(bitmap, frame.ff);
    at += frame.dur;
    const pct = Math.floor((100 * i) / frames.length / 10) * 10;
    if (pct > shown) { shown = pct; console.log("progress " + pct + "%"); }
    for (let wait = t0 + at - performance.now(); wait > 0; wait = t0 + at - performance.now()) {
      await sleep(Math.min(wait, 250));
      if (t0 + at - performance.now() > 20) paint(bitmap, frame.ff);
    }
  }
  for (const end = performance.now() + 500; performance.now() < end; ) {
    await sleep(100);
    paint(bitmap, frames.at(-1).ff);
  }
  bitmap.close();
  recorder.stop();
  await new Promise((r) => (recorder.onstop = r));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
  a.download = "video.webm";
  document.body.appendChild(a);
  a.click();
};
</script></body></html>`;

// Serves the player, the timeline and the frames to a page under a fake origin.
async function servePlayer(page, framesDir, timeline) {
  await page.route("http://player.local/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/") return route.fulfill({ body: PLAYER, contentType: "text/html" });
    if (pathname === "/timeline.json") return route.fulfill({ body: JSON.stringify(timeline), contentType: "application/json" });
    return route.fulfill({ body: readFileSync(join(framesDir, basename(pathname))), contentType: "image/jpeg" });
  });
}

async function encodeWebm({ chromium, framesDir, out, timeline, size, options }) {
  const browser = await launchChrome(chromium, { ...size, chrome: options.chrome });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: size });
    const page = await context.newPage();
    page.on("console", (m) => m.text().startsWith("progress") && log(`  encoding ${m.text().slice(9)}`));
    await servePlayer(page, framesDir, timeline);
    await page.goto("http://player.local/");
    const download = page.waitForEvent("download", { timeout: 0 });
    await page.evaluate((o) => window.encode(o), {
      ...size, fps: options.fps, bitrate: options.bitrate, badge: options.badge, accent: options.accent,
    });
    await (await download).saveAs(out);
  } finally {
    await closeQuietly(browser);
  }
}

async function encodeMp4({ chromium, framesDir, out, timeline, size, chapters, totalMs, options }) {
  const work = dirname(resolve(out));
  const tmp = (name) => join(framesDir, name);
  const quote = (p) => `'${p.replace(/'/g, "'\\''")}'`;
  const list = ["ffconcat version 1.0"];
  for (const f of timeline) list.push(`file ${quote(join(framesDir, f.file))}`, `duration ${(f.dur / 1000).toFixed(3)}`);
  list.push(`file ${quote(join(framesDir, timeline.at(-1).file))}`);
  writeFileSync(tmp("concat.txt"), list.join("\n"));

  // Fast-forwarded stretches in video time, for the badge.
  const spans = [];
  let t = 0;
  for (const f of timeline) {
    if (f.ff) {
      const last = spans.at(-1);
      if (last && Math.abs(last[1] - t) < 1) last[1] = t + f.dur;
      else spans.push([t, t + f.dur]);
    }
    t += f.dur;
  }
  const inputs = ["-f", "concat", "-safe", "0", "-i", tmp("concat.txt")];
  let graph = `[0:v]scale=${size.width}:${size.height}:flags=lanczos`;
  if (spans.length) {
    await renderBadge(chromium, tmp("badge.png"), size, options);
    inputs.push("-loop", "1", "-i", tmp("badge.png"));
    const enable = spans.map(([a, b]) => `between(t,${(a / 1000).toFixed(3)},${(b / 1000).toFixed(3)})`).join("+");
    graph += `[base];[base][1:v]overlay=x=W-w-${Math.round(20 * size.width / 1280)}:y=H-h-${Math.round(22 * size.width / 1280)}:shortest=1:enable='${enable}'`;
  }
  graph += `,fps=${options.fps},format=yuv420p[v]`;
  const metaIndex = spans.length ? 2 : 1;
  const escape = (s) => s.replace(/[=;#\\\n]/g, (c) => `\\${c}`);
  const meta = [";FFMETADATA1"];
  chapters.forEach((c, i) => meta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${c.ms}`, `END=${chapters[i + 1]?.ms ?? totalMs}`, `title=${escape(c.title)}`));
  writeFileSync(tmp("chapters.ffmeta"), meta.join("\n") + "\n");
  inputs.push("-i", tmp("chapters.ffmeta"));
  const kbps = Math.round(options.bitrate / 1000);
  execFileSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-stats", ...inputs,
    "-filter_complex", graph, "-map", "[v]", "-map_metadata", String(metaIndex), "-map_chapters", String(metaIndex),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", `${kbps}k`, "-bufsize", `${2 * kbps}k`,
    "-movflags", "+faststart", out,
  ], { stdio: "inherit", cwd: work });
}

async function renderBadge(chromium, path, size, options) {
  const browser = await launchChrome(chromium, { width: 800, height: 200, chrome: options.chrome });
  try {
    const page = await browser.newPage();
    const s = size.width / 1280;
    await page.setContent(`<body style="margin:0;background:transparent"><span id="b" style="display:inline-block;
      padding:0 ${22 * s}px;height:${42 * s}px;line-height:${42 * s}px;border-radius:${21 * s}px;background:${options.accent};
      opacity:.92;color:#fff;font:600 ${20 * s}px -apple-system,'Segoe UI',Roboto,sans-serif;white-space:nowrap"></span></body>`);
    await page.locator("#b").evaluate((el, text) => (el.textContent = text), options.badge);
    await page.locator("#b").screenshot({ path, omitBackground: true });
  } finally {
    await closeQuietly(browser);
  }
}

// ---------------------------------------------------------------- webm duration

// MediaRecorder writes WebM without a duration, so players cannot show the
// length or seek well. Insert a Duration element into the Segment's Info.
export function fixWebmDuration(buffer, durationMs) {
  const vint = (pos) => {
    const first = buffer[pos];
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    let value = first & (0xff >> length);
    for (let i = 1; i < length; i++) value = value * 256 + buffer[pos + i];
    const unknown = value === 2 ** (7 * length) - 1;
    return { length, value, unknown };
  };
  const id = (pos) => {
    const { length } = vint(pos);
    return { length, value: buffer.readUIntBE(pos, length) };
  };
  let pos = 0;
  const header = id(pos);
  if (header.value !== 0x1a45dfa3) return null;
  const headerSize = vint(pos + header.length);
  pos += header.length + headerSize.length + headerSize.value;
  const segment = id(pos);
  if (segment.value !== 0x18538067) return null;
  const segmentSize = vint(pos + segment.length);
  pos += segment.length + segmentSize.length;
  while (pos < buffer.length) {
    const el = id(pos);
    const size = vint(pos + el.length);
    const dataStart = pos + el.length + size.length;
    if (el.value === 0x114d9b74 || el.value === 0x1f43b675 || size.unknown) return null; // SeekHead or Cluster first: leave as is
    if (el.value === 0x1549a966) {
      let scale = 1_000_000;
      for (let p = dataStart; p < dataStart + size.value; ) {
        const child = id(p);
        const childSize = vint(p + child.length);
        const childData = p + child.length + childSize.length;
        if (child.value === 0x4489) return null; // already has a duration
        if (child.value === 0x2ad7b1) scale = buffer.readUIntBE(childData, childSize.value);
        p = childData + childSize.value;
      }
      const duration = Buffer.alloc(11);
      duration.writeUInt16BE(0x4489, 0);
      duration[2] = 0x88;
      duration.writeDoubleBE((durationMs * 1_000_000) / scale, 3);
      const body = Buffer.concat([buffer.subarray(dataStart, dataStart + size.value), duration]);
      const newSize = Buffer.alloc(8);
      newSize[0] = 0x01;
      newSize.writeUIntBE(body.length, 2, 6);
      return Buffer.concat([buffer.subarray(0, pos), buffer.subarray(pos, pos + el.length), newSize, body,
        buffer.subarray(dataStart + size.value)]);
    }
    pos = dataStart + size.value;
  }
  return null;
}

// ---------------------------------------------------------------- probe

// Opens the video in Chrome and reads its duration and size. A file:// URL is
// seekable, which a WebM without a duration needs: seeking to the end reveals it.
export async function probeVideo(chromium, file, options = {}) {
  const browser = await launchChrome(chromium, { width: 640, height: 400, chrome: options.chrome });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    return await page.evaluate(() => new Promise((resolve) => {
      const v = document.querySelector("video");
      if (!v) return resolve({ seconds: NaN, width: 0, height: 0, error: "Chrome did not open it as a video" });
      v.muted = true;
      v.pause();
      const done = () => resolve({ seconds: v.duration, width: v.videoWidth, height: v.videoHeight, error: v.error?.message ?? null });
      const measure = () => {
        if (Number.isFinite(v.duration)) return done();
        v.ondurationchange = () => Number.isFinite(v.duration) && done();
        v.currentTime = 1e9;
      };
      v.onerror = done;
      if (v.readyState >= 1) measure();
      else v.onloadedmetadata = measure;
      setTimeout(done, 20_000);
    }));
  } finally {
    await closeQuietly(browser);
  }
}

// ---------------------------------------------------------------- entry

// Encodes `framesDir` (frames + capture.json) to `out` (.webm or .mp4) and
// writes the chapter list next to it. Returns what the report needs.
export async function encode({ framesDir, out, chromium, ...rest }) {
  const options = { ...DEFAULTS, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  const capture = JSON.parse(readFileSync(join(framesDir, "capture.json"), "utf8"));
  const { timeline, totalMs, chapters, capturedMs } = buildTimeline(capture, options);
  const size = outputSize(framesDir, timeline, options);
  log(`encoding ${capture.frames.length} frames → ${timeline.length} video frames, ≈ ${clock(totalMs)} ` +
    `(captured ${clock(capturedMs)}), ${size.width}×${size.height}`);
  const mp4 = out.endsWith(".mp4");
  if (mp4) await encodeMp4({ chromium, framesDir, out, timeline, size, chapters, totalMs, options });
  else await encodeWebm({ chromium, framesDir, out, timeline, size, options });

  let probe = await probeVideo(chromium, out, options);
  if (!mp4 && Number.isFinite(probe.seconds)) {
    const fixed = fixWebmDuration(readFileSync(out), probe.seconds * 1000);
    if (fixed) {
      writeFileSync(out, fixed);
      probe = await probeVideo(chromium, out, options);
    }
  }
  const chaptersFile = out.replace(/\.(webm|mp4)$/, "") + ".chapters.txt";
  writeFileSync(chaptersFile, chapterText(chapters, totalMs));
  return { out, bytes: statSync(out).size, probe, expectedMs: totalMs, capturedMs, chapters, chaptersFile, size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      work: { type: "string" }, out: { type: "string" }, playwright: { type: "string" }, chrome: { type: "string" },
      width: { type: "string" }, height: { type: "string" }, fps: { type: "string" }, bitrate: { type: "string" },
      speedup: { type: "string" }, "max-wait": { type: "string" }, "max-still": { type: "string" },
      badge: { type: "string" }, accent: { type: "string" },
    },
  });
  if (!values.work || !values.out) {
    console.error("usage: encode.mjs --work <dir with frames/> --out <video.webm|video.mp4> [--speedup 1.7] [--max-wait 1500] " +
      "[--max-still 2000] [--width 1280] [--height 0] [--fps 25] [--bitrate 1500000] [--badge '⏩ fast-forward']");
    process.exit(2);
  }
  const num = (v) => (v === undefined ? undefined : Number(v));
  const { chromium } = loadPlaywright(values.playwright);
  const result = await encode({
    framesDir: join(resolve(values.work), "frames"), out: resolve(values.out), chromium, chrome: values.chrome,
    width: num(values.width), height: num(values.height), fps: num(values.fps), bitrate: num(values.bitrate),
    speedup: num(values.speedup), maxWait: num(values["max-wait"]), maxStill: num(values["max-still"]),
    badge: values.badge, accent: values.accent,
  });
  log(`wrote ${result.out} (${(result.bytes / 1e6).toFixed(1)} MB, ${clock(result.probe.seconds * 1000)})`);
  log(`chapters: ${result.chaptersFile}`);
}
