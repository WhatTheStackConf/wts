import assert from "node:assert/strict";
import test from "node:test";
import { blockingAdvisories } from "./audit-2027.mjs";

function advisory(id, severity, ...paths) {
  return { github_advisory_id: id, severity, module_name: "pkg", findings: [{ version: "1.0.0", paths }] };
}

test("a high or critical advisory that reaches a 2027 app blocks", () => {
  const report = { advisories: {
    1: advisory("GHSA-high", "high", "site>@solidjs/web>seroval"),
    2: advisory("GHSA-critical", "critical", "blog>emdash>dompurify"),
  } };
  assert.deepEqual(blockingAdvisories(report).map((item) => item.id), ["GHSA-high", "GHSA-critical"]);
});

test("advisories that reach only the root 2026 app do not block", () => {
  const report = { advisories: { 1: advisory("GHSA-root", "high", ".>@mmote/niimblue-node>zod") } };
  assert.deepEqual(blockingAdvisories(report), []);
});

test("moderate and low advisories do not block", () => {
  const report = { advisories: {
    1: advisory("GHSA-moderate", "moderate", "cfp>nodemailer"),
    2: advisory("GHSA-low", "low", "auth>hono"),
  } };
  assert.deepEqual(blockingAdvisories(report), []);
});

test("a blocking advisory lists only the 2027 paths", () => {
  const report = { advisories: { 1: advisory("GHSA-mixed", "high", ".>zod", "auth>zod") } };
  assert.deepEqual(blockingAdvisories(report)[0].paths, ["auth>zod"]);
});

test("a report with no advisories does not block", () => {
  assert.deepEqual(blockingAdvisories({}), []);
});
