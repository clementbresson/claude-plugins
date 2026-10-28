import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Records a page as JPEG frames through the Chrome DevTools screencast, each with
// a timestamp. Timed marks tell the encoder how to play each stretch:
//   "normal" sped up to a quick human pace, "ff" squeezed (waits), "hold" real time (captions).
// Chapters record where each section starts.
export async function startCapture({ page, dir, quality = 70, everyNthFrame = 1 }) {
  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const frames = [];
  const marks = [{ t: 0, mode: "normal" }];
  const chapters = [];
  let bytes = 0;
  let resolveFirst;
  const first = new Promise((resolve) => (resolveFirst = resolve));
  const session = await page.context().newCDPSession(page);
  session.on("Page.screencastFrame", ({ data, sessionId }) => {
    const buffer = Buffer.from(data, "base64");
    const file = `${String(frames.length).padStart(6, "0")}.jpg`;
    writeFileSync(join(dir, file), buffer);
    bytes += buffer.length;
    frames.push({ file, t: Date.now() - t0 });
    if (frames.length === 1) resolveFirst(jpegSize(buffer));
    session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality, everyNthFrame });
  return {
    // Size of the first frame, or null when none arrives in time. A still page
    // sends a single frame, so an invisible 1 px repaint is nudged until one comes.
    firstFrameSize: async (timeoutMs = 10_000) => {
      let done = false;
      const nudge = async () => {
        for (let i = 0; !done; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (done) break;
          await page.evaluate((n) => {
            let dot = document.getElementById("__demo-nudge");
            if (!dot) {
              dot = document.createElement("div");
              dot.id = "__demo-nudge";
              dot.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647";
              document.documentElement.appendChild(dot);
            }
            dot.style.background = `rgba(0,0,0,${n % 2 ? 0.02 : 0.03})`;
          }, i).catch(() => {});
        }
        await page.evaluate(() => document.getElementById("__demo-nudge")?.remove()).catch(() => {});
      };
      const nudging = nudge();
      const size = await Promise.race([first, new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
      done = true;
      await nudging;
      return size;
    },
    setMode: (mode) => {
      if (marks.at(-1).mode !== mode) marks.push({ t: Date.now() - t0, mode });
    },
    chapter: (title) => chapters.push({ t: Date.now() - t0, title }),
    bytes: () => bytes,
    stop: async () => {
      await session.send("Page.stopScreencast").catch(() => {});
      const end = Date.now() - t0;
      writeFileSync(join(dir, "capture.json"), JSON.stringify({ frames, marks, chapters, end }));
      await session.detach().catch(() => {});
      return { frames: frames.length, bytes, end };
    },
  };
}

// Pixel size from a JPEG's start-of-frame segment.
export function jpegSize(buffer) {
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
    }
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  return null;
}
