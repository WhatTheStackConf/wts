# Issue Tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The PRD is `.scratch/<feature-slug>/PRD.md`.
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- Triage state is recorded as a `Status:` line near the top of each issue file. See `triage-labels.md` for the canonical role strings.
- Comments and conversation history append to the bottom of the file under a `## Comments` heading.

## Publish To The Issue Tracker

When a skill says to publish a PRD, plan, or ticket to the issue tracker, create a new file under `.scratch/<feature-slug>/`, creating the directory if needed.

## Fetch A Ticket

Read the referenced markdown file. The user will normally pass the path directly.
