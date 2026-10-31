---
name: orca-new-task
description: Use when a session running inside an Orca terminal is asked to start a new task, hand work to a worker, or run several tasks at once. The agent in the main checkout stays orchestrator and a supervised worker does the work in its own worktree. Not for sessions outside Orca.
argument-hint: "[what the task is]"
---

# Start a task

The request is: $ARGUMENTS

You are the orchestrator. You hold the big picture: you investigate, plan, review and relay. You never do the work: no
edit, commit or fix of your own, however small. A worker does it in its own worktree and reports back.

Run this skill in the main session, never in a subagent. It needs AskUserQuestion and a background wait the user can
talk over.

`START` below is `bash ${CLAUDE_SKILL_DIR}/scripts/start-task.sh`. Always call it through `bash`, once per Bash call and
once per task, so one start's failure can't hide another's.

## 1. Check the start is possible

Run `START check` before anything else, and add the main checkout's path if the task belongs to another repo. On a
refusal, stop and give the user the reason, and don't do the task some other way. This skill only exists inside Orca: the
script refuses when Orca is missing or unreachable, when this session isn't in an Orca terminal, when Orca doesn't manage
the repo, and from a linked worktree.

## 2. Learn Orca's flow

Run `orca skills get orchestration` and follow it, including the reference it names for what you are doing. It matches
the installed Orca, so it wins over this file on how a command behaves.

## 3. Write the brief

Investigate read-only until you can write what the worker needs, then write one brief per task to a file in your
scratchpad. It must stand alone, since the worker sees nothing else. Use these headings:

- **Goal**: the result, and why it matters.
- **Done criteria**: conditions anyone can check.
- **Findings**: what you found, as `file:line`, so the worker need not search again.
- **Decisions**: what the user or you already settled, so it isn't reopened.
- **Constraints**: the repo's rules still apply. Start no other worktree or agent.
- **Verification**: the commands or checks to run, and the result expected.
- **What not to do**: the worker never commits or lands. Work outside this brief is reported, not done, unless the goal
  requires it, and then it is flagged. Questions go to the coordinator through the preamble's `ask`, never through
  AskUserQuestion, which you cannot answer.
- **Report back**: write the full report to a file from `mktemp`, outside the repo, and pass it to `worker_done` with
  `--report-path`, since the summary holds only three sentences. It states the outcome, files changed, verification run
  with results, anything beyond the brief, what was not tested, and risks.

Never put a brief on a command line. The script reads it from the file, so quoting and hooks that scan commands can't
touch it.

## 4. Get the user's confirmation

Ask with AskUserQuestion, one single-select question per task, with the exact brief in the approving option's `preview`.
Don't use multiSelect, which has no preview. A dialog holds four questions, so more tasks take another dialog.

Approval covers that one call of that one brief.

- Notes with no option selected are not approval. Revise the brief and ask again.
- Any change to an approved brief needs a new approval.
- Earlier approvals, or a task that looks like an approved one, never carry over.

## 5. Start the worker

Bind one Run per session, once, before the first start:

```
orca orchestration run-create --objective "<what this session is working on>" --json
```

Then, for each approved task, with a lowercase hyphenated name:

```
START start <name> <brief-file> [<other repo's main checkout>]
```

The script refuses as in step 1, fetches the base, runs `worker-start` in a new top-level worktree and reveals it in the
Orca app, which `worker-start` alone leaves in the background. It prints the receipt, then `revealed:` or `not revealed:`
with the reason. Tell the user when a worktree wasn't revealed; the worker is running either way.

A non-zero exit means no `ready` worker. Never run it again blind: a retry can duplicate the worktree. Read `failedStage`,
`residualResources` and `nextCommands` in the receipt, and load Orca's `references/recovery-and-cleanup.md`.

The worker may stop on a permission prompt in its own tab. Your approval doesn't cover it, and only the user can answer
it there. If a worker goes quiet, look with `orca orchestration worker-read --dispatch <id> --limit 50 --json`, and name
the prompt to the user.

## 6. Wait in the background

Keep exactly one wait running while any worker is unsettled, as a background Bash so the user can keep talking:

```
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json
```

You are woken when it exits. Don't poll. When new workers start, the running wait covers them too.

For each message in the delivery:

- **question or escalation**: answer with `orca orchestration reply --id <message_id> --body "<answer>" --json`. Ask the
  user first when the answer is theirs to give, and say so to the worker if that takes time.
- **worker_done**: review it in step 7.

Then acknowledge the whole delivery and wait again, always in a background Bash:

```
orca orchestration check --ack <delivery_id> --wait --types worker_done,escalation,question --timeout-ms 900000 --json
```

An empty or timed-out result is a checkpoint, not a failure. After three in a row, follow Orca's guide and enumerate with
`worker-list --run <run_id>`. Never stop, retry or abandon a worker without the positive proof Orca's guide requires.

## 7. Review and relay

Check the `worker_done` against the expected dispatch and read the file in `payload.reportPath`. If there is none, use
`worker-read`. Check its claims against the worktree where you can, then tell the user, for each outcome:

- the outcome, and the evidence behind it
- files changed, and what was verified and how
- anything beyond the brief, what was not tested, and risks
- the repo's own landing step, if its docs name one. Don't assume a mechanism: a merge script in one repo, a PR in
  another. The user lands the work, not you and not the worker.

Then settle the worker, before acknowledging the delivery:

```
orca orchestration worker-retain --dispatch <dispatch_id> --json
```

Retaining hands the terminal to the user, who can keep talking to that agent until the work lands. Run `worker-release`
instead only if the user says the terminal can go, and read its `state`: `retained` means the terminal stayed open, so
tell the user. Never remove a worktree.

Follow-up work from you is a new start: a new brief, a new confirmation, and a fresh agent in the same worktree.

```
orca orchestration worker-start --spec "$(cat <brief-file>)" --worktree id:<worktree id> --agent claude --json
```

Take `<worktree id>` from the first receipt's `worktree` effect, and carry what the fresh agent needs into the brief,
since it starts with no memory of the first one. Work unrelated to that worker's scope gets its own worktree, from step 3.

Done when every task has an outcome the user has heard, and every settled worker has been retained or released.
