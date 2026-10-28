---
name: demo-video
description: Use when the user asks for a demo video of a feature, a screen recording of the app, or to record a walkthrough of a web app running locally. Scripts a headless Chrome through a scenario and produces a captioned, fast-forwarded video file.
argument-hint: "[feature to show]"
---

# Demo video

Record a narrated demo of a local web app: you write a **scenario** (plain
JavaScript, one `section` per part of the story), `scripts/run-scenario.mjs`
drives headless system Chrome through it, captures screencast frames, and
encodes a video. Captions explain each step, a visible cursor shows each
click, waits are squeezed under a « ⏩ » badge, and the rest plays at a quick
human pace. Chrome does the encoding, so no external binary is needed; when
`ffmpeg -version` works, the output is an MP4 instead of a WebM.

`S` below is `${CLAUDE_SKILL_DIR}/scripts`. Every command runs from the app's
project root, so the project's Playwright package is found.

## Step 1 — Plan the story

Read what the feature changed (the branch diff or the PR), the app's routes,
and the test accounts and seeds the project already has. Write the plan as a
numbered list of sections: the happy path, then edge cases, settings on and
off, other roles or locales. For each section, name what is on screen that
**proves** the behaviour: a text, a badge, a state. For AI features, give test
entities unmistakable instructions (« Start every answer with AGENT-ALPHA »)
so the video itself shows which one answered.

Show the plan to the user and wait for their go. Done when the user has
approved the section list.

## Step 2 — Prepare the machine and the app

1. Check the machine: `uptime`, and `memory_pressure -Q` on macOS. Recording
   and encoding each need a quiet machine; stop the project's other dev
   instances, and ask before stopping anything that is not the project's own.
   Run nothing heavy (type checks, tests, another browser) until the video is
   delivered.
2. Start the app locally and reset its test data. Changes without a UI go
   through SQL against the **local** database only (`config.db.command`).
3. Credentials come from environment variables listed in `config.env`. Each
   Bash call starts a fresh shell, so put them in a git-ignored file named by
   `config.envFile`, filled from the project's seed or example config, or ask
   the user to fill it. Keep their values out of the chat and the scenario.

Done when the app answers at its base URL with fresh test data.

## Step 3 — Write the scenario

Copy `${CLAUDE_SKILL_DIR}/templates/scenario.example.mjs` to the session
scratchpad as `demo-video/<name>.mjs` and replace its sections with the
approved plan. The template lists every helper on `demo` and every config
key. Write it to these rules:

- **One caption per idea**, in the user's language, as a title and an
  optional sub-line. A caption holds at real speed long enough to read; pass
  a longer hold for a screen the viewer must study.
- **Unambiguous targets.** Prefer `page.getByRole(role, { name, exact: true })`,
  and scope by container: `page.locator("form", { has: page.locator("input[type=email]") })`.
  A cookie banner is a form with submit buttons too. Every action is a real
  mouse or keyboard event, which Radix and shadcn pickers need.
- **Every wait goes through a helper** (`waitFor`, `waitForNew`, `goto`,
  `fastForward`), so it is squeezed in the video. For an AI answer, use
  `waitForNew` on the element that appears when a reply is complete.
- **Proof as checks.** After each behaviour, `expectText` the marker that
  proves it; checks are counted in the report.
- **Off-camera work** (a second tab deleting something) goes in
  `offCamera`, announced by a caption.
- A section that may legitimately fail gets `{ optional: true }`.

Done when every approved section is in the scenario.

## Step 4 — Smoke test and dry run

```bash
node S/run-scenario.mjs SCENARIO --smoke
node S/run-scenario.mjs SCENARIO --dry-run
```

`--smoke` captures 3 s and checks that the frames are the viewport's size; it
also estimates the frames' disk use per minute. `--dry-run` runs every step at
full speed without recording. Fix selectors and timing here, never during the
take: a failing section prints its error and a screenshot path, so read the
screenshot. Exit code 1 means a section failed, 3 means a check failed.

If Playwright is not found, the error gives a one-line install of
`playwright-core` into a cache folder (no browser download). Ask the user
before running it.

Done when the dry run exits 0: every section passes and every check is ✓.

## Step 5 — Record

```bash
node S/run-scenario.mjs SCENARIO [--name NAME] [--out DIR] [--format webm|mp4]
```

Run it in the background: recording takes the real duration of the scenario,
and WebM encoding takes about the video's length again. The video goes to
`~/Movies/demo-videos/` (or `~/Videos`) unless `--out` says otherwise, with a
`.chapters.txt` beside it. The frames are deleted after a successful encode;
pass `--keep-frames` to re-encode later with other timing, without recording
again (the report prints the `encode.mjs` command).

Done when the report prints `Video` with a length.

## Step 6 — Verify

The report lists a `Samples` folder: one frame per section, taken during its
last caption, plus the last frame. Look at every sample image and confirm
that the caption matches the section, the important UI is in frame and not
cut off, and the proof the plan named is visible. Compare the measured
length with the planned one.

When something is wrong, fix the scenario and go back to step 4. Done when
every sample shows what its section promises.

## Step 7 — Deliver

Give the user the video path, its format, length and size, the chapter list
with timestamps, the checks result, and the disk the frames used. Say how to
play it: a WebM opens in Chrome, Firefox or VLC, not QuickTime. Then delete
the work folder named in the report (samples, error screenshots).
