# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before Exploring

- Read `CONTEXT.md` at the repo root.
- If `CONTEXT-MAP.md` exists, read the context map and then the relevant context files.
- If `docs/adr/` exists, read ADRs that touch the area being changed.
- If any of these files are absent, proceed silently.

## Layout

This is a single-context repo. The root `CONTEXT.md` defines the project vocabulary for the WhatTheStack 2026 public site and related private CFP/reviewer/admin workflows.

## Vocabulary

Use the glossary vocabulary from `CONTEXT.md` in issues, PRDs, plans, test names, and implementation notes. In particular, preserve distinctions between **User**, **CFP Applicant**, **Speaker**, **Session**, and **CFP Submission**.

If a concept is missing from the glossary, note that as a domain-doc follow-up rather than silently inventing competing terminology.
