import { createServer } from "node:http";
import PocketBase from "pocketbase";
import { describe, expect, it } from "vite-plus/test";
import { startLiveQaPocketBase } from "./live-qa-pocketbase-test-helper";
import { authFailure } from "./auth-errors";

describe("post-conference registration closure", () => {
  it("denies password and OAuth signup but preserves existing password/OAuth login across restart", { timeout: 30_000 }, async () => {
    const fixture = await startLiveQaPocketBase({ registrationClosed: true, binary: process.env.WTS_AUTH_TEST_PB_BINARY });
    let existing = false;
    const provider = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.url === "/token"
        ? { access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600 }
        : { sub: existing ? "existing-id" : "new-id", name: "OAuth Test", email: existing ? "existing@example.test" : "new@example.test", email_verified: true }));
    });
    try {
      await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
      const address = provider.address();
      if (!address || typeof address === "string") throw new Error("Missing provider port");
      const providerUrl = `http://127.0.0.1:${address.port}`;
      const before = await fixture.pb.collections.getOne("users");
      expect(before.createRule).toBeNull();
      await fixture.pb.collections.update("users", { oauth2: { enabled: true, providers: [{
        name: "google", clientId: "test-client", clientSecret: "test-only",
        authURL: `${providerUrl}/authorize`, tokenURL: `${providerUrl}/token`, userInfoURL: `${providerUrl}/userinfo`,
      }] } });
      // Organizer provisioning remains possible; no public user can grant it.
      const user = await fixture.pb.collection("users").create({
        email: "existing@example.test", password: fixture.password, passwordConfirm: fixture.password,
        name: "Existing user", role: "reviewer", verified: true,
      });
      const publicClient = new PocketBase(fixture.baseUrl);
      const authenticate = () => publicClient.collection("users").authWithOAuth2Code(
        "google", "synthetic-code", "synthetic-verifier", `${providerUrl}/callback`,
      );
      for (const restart of [false, true]) {
        if (restart) await fixture.restart();
        publicClient.authStore.clear();
        for (const role of [undefined, "user", "admin"]) {
          await expect(publicClient.collection("users").create({
            email: "new@example.test", password: fixture.password, passwordConfirm: fixture.password, role,
          })).rejects.toMatchObject({ status: 403 });
        }
        existing = false;
        await expect(authenticate()).rejects.toMatchObject({ status: 403 });
        existing = true;
        expect((await authenticate()).record.id).toBe(user.id);
        expect(publicClient.authStore.record?.role).toBe("reviewer");
        publicClient.authStore.clear();
        expect((await publicClient.collection("users").authWithPassword("existing@example.test", fixture.password)).record.id).toBe(user.id);
        await publicClient.collection("users").update(user.id, { name: "Existing user updated" });
        expect((await fixture.pb.collection("users").getList(1, 1)).totalItems).toBe(1);
        const after = await fixture.pb.collections.getOne("users");
        for (const field of ["createRule", "updateRule", "deleteRule", "authRule", "listRule", "viewRule"] as const) {
          expect(after[field]).toEqual(before[field]);
        }
      }
    } finally {
      await new Promise<void>(resolve => provider.close(() => resolve()));
      await fixture.cleanup();
    }
  });

  it("explains closed OAuth signup without disabling or mislabelling password recovery", () => {
    expect(authFailure({ status: 403 }, "oauth").message).toContain("registration is closed");
    expect(authFailure({ status: 403 }, "register").message).toContain("registration is closed");
    expect(authFailure({ status: 400 }, "password").code).toBe("credentials");
  });
});
