# Claude plugins

## Skills are universal

This is the top rule of the repo, and it has no exceptions. Every skill under `plugins/` runs unchanged on any repo, on
any machine, for any user, and this repo is public.

- **The skill states its system on its own terms.** A reader who knows none of the projects it was tested on understands
  it fully.
- **Examples are invented.** Use names like `Acme` or `feature-x`. Well-known vendors are fine as examples of a category.
- **Real projects are test beds only.** What a test on a real repo teaches becomes a general rule. What only that repo
  needs (its migration, its names, its commands) stays in that repo, or in the conversation.
- **Paths are relative** to the skill or the target repo. Find tools and folders at run time, and handle their absence.

Before finishing any change under `plugins/`, run `sh scripts/check-agnostic.sh`. Done when it prints nothing and you
have read your diff for anything it cannot know: it catches machine paths and listed names, not a new project's
specifics, an example only one project would recognise, or an assumption about one stack.

When the check names a private project or client, add nothing about it to this repo: add its name to the local denylist
described at the top of the script.
