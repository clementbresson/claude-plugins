// Demo scenario: plain JavaScript, run by scripts/run-scenario.mjs.
// Copy this file, set `config`, and write one `demo.section` per part of the story.
// Nothing to import: everything arrives through `demo`.

export const config = {
  name: "invoice-reminders", // video file name
  baseURL: "http://localhost:3000",
  viewport: { width: 1440, height: 900 }, // the video keeps this aspect ratio, encoded at 1280 wide
  locale: "en-US", // browser locale; the app may pick its language from it
  // language: "fr", // language of the fast-forward badge; defaults to the locale's
  env: ["DEMO_PASSWORD"], // env vars the scenario needs; checked before anything starts
  // envFile: ".env.demo", // git-ignored file holding them (relative to where you run the script)
  // db: { command: "docker exec -i myapp-postgres-1 psql -U postgres -d app -tA" }, // enables demo.sql()
  // framework: "auto", // "react" waits for hydration before every action, "none" never does
  // ready: async (page) => page.waitForSelector("[data-app-ready]"), // extra readiness after each goto
  // captionPosition: "top", // or "bottom" when the app's header matters more than its footer
  // accent: "#9333ea", // caption step pill, cursor and badge color
  // onError: "abort", // or "continue": a failing section is logged and the take goes on
  // video: { speedup: 1.7, maxWait: 1500, maxStill: 2000, width: 1280, bitrate: 1500000 },
  // capture: { quality: 70 }, // JPEG quality of the frames; lower saves disk
};

export default async function scenario(demo) {
  const { page } = demo;

  // Each section is a chapter of the video and a numbered pill on its captions.
  await demo.section("Log in", async () => {
    await demo.goto("/login", "form");
    await demo.caption("Invoice reminders", "Acme Billing, from the accountant's point of view", 3500);
    await demo.caption("Log in as an accountant", "accountant@example.com");
    await demo.login({ url: "/login", email: "accountant@example.com", passwordEnv: "DEMO_PASSWORD" });
  });

  await demo.section("Turn reminders on", async () => {
    await demo.goto("/settings/billing", "main");
    await demo.click(page.getByRole("switch", { name: "Send reminders" }));
    await demo.caption("Reminders are on", "Clients get an email 3 days before the due date");
  });

  await demo.section("Ask the assistant", async () => {
    await demo.goto("/assistant", "textarea");
    // Wait for an AI answer: one more « Copy » button once it has finished. The wait is fast-forwarded.
    await demo.waitForNew(page.getByRole("button", { name: "Copy" }), async () => {
      await demo.typeInto(page.locator("textarea"), "Which invoices are overdue?");
      await demo.press("Enter");
    });
    // Prove the behaviour on screen, and record it as a check.
    await demo.expectText("INV-2041");
    await demo.caption("The assistant lists the overdue invoice", "INV-2041, due 12 days ago");
  });

  // An optional section may fail without stopping the take.
  await demo.section("Tooltip on a locked field", async () => {
    await demo.hover(page.getByText("Due date"), 2000);
    await demo.caption("Locked once the invoice is sent", "The tooltip explains why");
  }, { optional: true });

  await demo.section("Deleted in another tab", async () => {
    await demo.caption("Meanwhile, in another tab, the invoice is deleted…", "", 1800);
    await demo.offCamera(async (other) => {
      await other.goto(demo.url("/invoices/2041"));
      await other.getByRole("button", { name: "Delete" }).click();
      await other.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    });
    await demo.click(page.getByRole("button", { name: "Send reminder" }));
    await demo.caption("A clear error, no crash", "« This invoice no longer exists »");
  });

  // Test data without a UI: SQL through config.db.command. Local databases only.
  // demo.sql(`update "User" set locale = 'fr-BE' where email = 'accountant@example.com'`);

  await demo.caption("End of the demo", "", 2500);
}

// Helpers on `demo` (targets are Playwright locators or CSS selectors):
//   section(title, fn, { optional })       chapter; a failure stops the take unless optional
//   caption(title, sub?, holdMs?)          banner, held at real speed (≥ 1.2 s, longer for long text)
//   clearCaption()  hold(ms)  pause(ms)    real-time hold vs. normal (sped-up) pause
//   goto(path, readySelector?)             navigate, wait for readiness and hydration, reject cookies
//   click(t)  typeInto(t, text)  typeSecret(t, ENV)  hover(t, ms)  press(key)  scroll(dy)  moveTo(t)
//   waitFor(t | text | async fn, { timeout, optional })   fast-forwarded wait
//   waitForNew(t, action, { timeout })     action, then wait until t matches more elements
//   fastForward(async fn)                  squeeze any wait
//   expectText(text)  check(name, ok)      record proof on screen; never throws
//   login({ url, email, passwordEnv, emailField, passwordField, submit, until })
//   dismissCookies()  sql(query)  offCamera(async (page) => …)  newPage()  ready(t)  url(path)
//   page, context, config, dryRun, log
