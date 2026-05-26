#!/usr/bin/env node
/**
 * PRD #1 security hardening — PocketBase API smoke tests.
 * Run: node scripts/qa-security-hardening.mjs
 */
const PB = process.env.POCKETBASE_URL || "http://127.0.0.1:8090";
const PASS = process.env.QA_TEST_PASSWORD || "QaTest!Sec2026";
const SU_EMAIL = process.env.POCKETBASE_SUPERUSER_EMAIL || "hello@wts.sh";
const SU_PASS = process.env.POCKETBASE_SUPERUSER_PASSWORD || "V781Kj5JqhHu6k";

const USERS = {
  regular: { email: "qa-regular@wts-test.local", id: "cgamftryukmuy2t" },
  reviewer: { email: "qa-reviewer@wts-test.local", id: "l0yfcmm6hdtpnsm" },
  admin: { email: "qa-admin@wts-test.local", id: "cvetm65gwr1h3bx" },
};

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const icon = pass ? "PASS" : "FAIL";
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pb(path, opts = {}) {
  const res = await fetch(`${PB}${path}`, opts);
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

async function authUser(email) {
  const { status, body } = await pb("/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password: PASS }),
  });
  if (status !== 200) throw new Error(`auth failed ${email}: ${JSON.stringify(body)}`);
  return body;
}

async function authSuperuser() {
  const { status, body } = await pb("/api/collections/_superusers/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASS }),
  });
  if (status !== 200) throw new Error(`superuser auth failed: ${JSON.stringify(body)}`);
  return body.token;
}

async function main() {
  console.log(`PocketBase: ${PB}\n`);

  // Collection rules sanity
  const suToken = await authSuperuser();
  const usersCol = await pb("/api/collections/users", {
    headers: { Authorization: `Bearer ${suToken}` },
  });
  const updateRule = usersCol.body?.updateRule ?? "";
  record(
    "users updateRule migrated",
    updateRule.includes("@request.body.role") && updateRule.includes("admin"),
    updateRule.slice(0, 80),
  );

  const reviewsCol = await pb("/api/collections/cfp_reviews", {
    headers: { Authorization: `Bearer ${suToken}` },
  });
  const createReviewRule = reviewsCol.body?.createRule ?? "";
  record(
    "cfp_reviews createRule ownership",
    createReviewRule.includes("reviewer = @request.auth.id"),
    createReviewRule,
  );

  const votesCol = await pb("/api/collections/cfp_weight_votes", {
    headers: { Authorization: `Bearer ${suToken}` },
  });
  const listVotesRule = votesCol.body?.listRule ?? "";
  record(
    "cfp_weight_votes listRule scoped",
    listVotesRule.includes("user = @request.auth.id"),
    listVotesRule,
  );

  const regularAuth = await authUser(USERS.regular.email);
  const reviewerAuth = await authUser(USERS.reviewer.email);
  const adminAuth = await authUser(USERS.admin.email);

  // Role lock: regular user PATCH own role to admin
  {
    const { status, body } = await pb(`/api/collections/users/records/${regularAuth.record.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${regularAuth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "admin" }),
    });
    // PB may return 403, 400, or 404 when updateRule denies
    const blocked = status === 403 || status === 400 || status === 404;
    record("role lock: PATCH own role=admin", blocked, `status=${status} ${body?.message ?? ""}`);
    // Verify role unchanged
    const me = await pb(`/api/collections/users/records/${regularAuth.record.id}`, {
      headers: { Authorization: regularAuth.token },
    });
    record(
      "role lock: role still user",
      me.body?.role === "user",
      `role=${me.body?.role}`,
    );
  }

  // Profile update: name only
  {
    const newName = `QA Regular ${Date.now() % 10000}`;
    const { status, body } = await pb(`/api/collections/users/records/${regularAuth.record.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${regularAuth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName }),
    });
    record("profile update: PATCH name only", status === 200, `status=${status}`);
    if (status === 200) {
      record("profile update: name persisted", body?.name === newName, body?.name);
    }
  }

  // Admin role change via superuser (simulates adminUpdateUser path)
  {
    const targetId = USERS.regular.id;
    const { status, body } = await pb(`/api/collections/users/records/${targetId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${suToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "user" }),
    });
    record("admin path: superuser PATCH role", status === 200, `status=${status}`);
  }

  // cfp_reviews create with wrong reviewer id
  {
    // Need a submission id — list as superuser
    const subs = await pb("/api/collections/cfp_submissions/records?perPage=1", {
      headers: { Authorization: `Bearer ${suToken}` },
    });
    const subId = subs.body?.items?.[0]?.id;
    if (!subId) {
      record("cfp_reviews wrong reviewer", false, "no submissions in DB");
    } else {
      const { status, body } = await pb("/api/collections/cfp_reviews/records", {
        method: "POST",
        headers: {
          Authorization: reviewerAuth.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submission: subId,
          reviewer: USERS.admin.id,
          score_relevance: 3,
          score_originality: 3,
          score_quality: 3,
          score_delivery: 3,
          comments: "qa test",
        }),
      });
      record(
        "cfp_reviews create wrong reviewer",
        status === 403 || status === 400,
        `status=${status} ${body?.message ?? ""}`,
      );
    }
  }

  // cfp_weight_votes: reviewer lists only own
  {
    const { status, body } = await pb("/api/collections/cfp_weight_votes/records?perPage=50", {
      headers: { Authorization: reviewerAuth.token },
    });
    const items = body?.items ?? [];
    const onlyOwn = items.every((v) => v.user === reviewerAuth.record.id);
    record(
      "cfp_weight_votes list scoped to self",
      status === 200 && onlyOwn,
      `count=${items.length}`,
    );

    const { status: cStatus, body: cBody } = await pb("/api/collections/cfp_weight_votes/records", {
      method: "POST",
      headers: {
        Authorization: reviewerAuth.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user: USERS.admin.id, weight_talk: 1 }),
    });
    record(
      "cfp_weight_votes create wrong user",
      cStatus === 403 || cStatus === 400,
      `status=${cStatus} ${cBody?.message ?? ""}`,
    );
  }

  // cfp_submissions: regular user read own, cannot list all
  {
    const listAll = await pb("/api/collections/cfp_submissions/records?perPage=50", {
      headers: { Authorization: regularAuth.token },
    });
    const listCount = listAll.body?.items?.length ?? 0;
    record(
      "cfp_submissions list not all (regular)",
      listAll.status === 200 && listCount <= 1,
      `status=${listAll.status} visible=${listCount}`,
    );

    const viewOwn = await pb(`/api/collections/users/records/${regularAuth.record.id}`, {
      headers: { Authorization: regularAuth.token },
    });
    record("regular user can read self", viewOwn.status === 200, `status=${viewOwn.status}`);
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n--- ${results.length - failed}/${results.length} passed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
