import { createServer } from "node:http";
import PocketBase from "pocketbase";
import { describe, expect, it } from "vite-plus/test";
import { startLiveQaPocketBase } from "./live-qa-pocketbase-test-helper";

// Real PocketBase OAuth exchange, role hooks and create rules; only the external
// identity provider is synthetic. No Google accounts, mail or live DB involved.
describe("public registration", () => {
  it.each([undefined, {}, { role: "admin", name: "Untrusted role" }])("creates a Google user with createData %j and preserves roles on repeat login", { timeout: 30_000 }, async (createData) => {
    const fixture = await startLiveQaPocketBase({ binary: process.env.WTS_AUTH_TEST_PB_BINARY });
    const provider = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.url === "/token"
        ? { access_token: "synthetic-google-token", token_type: "Bearer", expires_in: 3600 }
        : { sub: "synthetic-google-user", name: "OAuth Test", email: "oauth@example.test", email_verified: true }));
    });
    try {
      await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
      const address = provider.address();
      if (!address || typeof address === "string") throw new Error("Missing provider port");
      const providerUrl = `http://127.0.0.1:${address.port}`;
      await fixture.pb.collections.update("users", {
        oauth2: { enabled: true, providers: [{
          name: "google", clientId: "test-client", clientSecret: "test-only",
          authURL: `${providerUrl}/authorize`, tokenURL: `${providerUrl}/token`, userInfoURL: `${providerUrl}/userinfo`,
        }] },
      });
      const publicClient = new PocketBase(fixture.baseUrl);
      const authenticate = () => publicClient.collection("users").authWithOAuth2Code(
        "google", "synthetic-code", "synthetic-verifier", `${providerUrl}/callback`, createData,
      );
      const result = await authenticate();
      expect(result.record.role).toBe("user");
      expect(result.record.verified).toBe(true);
      expect((await fixture.pb.collection("users").getOne(result.record.id)).role).toBe("user");
      await fixture.pb.collection("users").update(result.record.id, { role: "reviewer" });
      publicClient.authStore.clear();
      expect((await authenticate()).record.role).toBe("reviewer");
      publicClient.authStore.clear();
      const emailUser = await publicClient.collection("users").create({
        email: "email-registration@example.test", name: "Email Test",
        password: fixture.password, passwordConfirm: fixture.password,
      });
      expect(emailUser.role).toBe("user");
      expect(emailUser.verified).toBe(false);
      await expect(publicClient.collection("users").create({
        email: "oauth@example.test", password: fixture.password, passwordConfirm: fixture.password,
      })).rejects.toMatchObject({ status: 400, response: { data: { email: { code: "validation_not_unique" } } } });
    } finally {
      await new Promise<void>(resolve => provider.close(() => resolve()));
      await fixture.cleanup();
    }
  });
});
