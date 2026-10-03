# WTS shared identity project brief

Date: 2026-10-02

Status: The identity service is deployed at `auth.wts.sh`. All 274 WTS-2026 users and 204 provider links are copied into central auth. The 2026 PocketBase data remains intact. Consumer integration remains separate.

See [the identity service runbook](../../auth/README.md) for configuration, protocol contracts, migration tools, verification, and deployment details.

## Goal

Give users one identity and one login experience across WTS applications. Preserve existing 2026 user data and its relationships.

The planned hosts include `wts.sh`, `blog.wts.sh`, `cfp.wts.sh`, and `tickets.wts.sh`. The proposed login host is `auth.wts.sh`.

WTS is building an in-house ticketing platform intended for release as free and open-source software (FOSS). Its repository is `../open-event-platform`, relative to the WTS repository root.

This brief can seed a new identity project. It is not an implementation specification or authorization for production changes.

## Direction from the discussion

- Use one logical auth system for WTS applications.
- Keep one shared WTS profile rather than independent copies in every application.
- Keep app-specific data and permissions with the application that owns them.
- Use central authentication and application-local authorization. Store role assignments in the owning application's database, not in auth.
- Give each WTS application its own database. Use PostgreSQL for auth and separate SQLite databases for the other applications.
- Preserve existing PocketBase user IDs during the transition.
- Keep the ticketing platform independent of WTS-specific infrastructure.
- Replace PocketBase in the main site and CFP with server-owned SQLite data access.

Applications can share a physical host without sharing database files. Separate database ownership does not require a separate server for every application.

## Target architecture

### Selected technology and database ownership

| Application | Database | Owns |
| --- | --- | --- |
| `auth.wts.sh` | PostgreSQL | Better Auth records, identity mappings, shared WTS profiles |
| `wts.sh` | Its own SQLite database | Public conference content, published speakers and program, app-specific permissions |
| `cfp.wts.sh` | Its own SQLite database | Proposals, reviews, speaker submissions, selection, conference-edition permissions |
| `tickets.wts.sh` | Its own Open Event Platform SQLite database | Local accounts, orders, tickets, attendees |
| `blog.wts.sh` | Its own SQLite database | Blog content and app-specific permissions |

The identity application uses Better Auth and its OAuth Provider plugin for OIDC. PostgreSQL remains its database.

The main site and CFP have separate backends and separate SQLite databases. Neither application reads or writes the other's database directly.

Each application backend owns its schema, migrations, queries, transactions, and server-side authorization.
The main site and CFP replace their PocketBase dependencies through their own data access interfaces.

Each SQLite database uses a local filesystem and short write transactions. An application's web and worker processes access its database on the same node.

Applications must not query Better Auth's internal tables directly. They use OIDC for identity and a defined interface for shared WTS profiles.

The target uses one SQLite database per non-auth application, not a shared SQLite database.
Each application also owns its backups and restore procedure.

### Accepted 2027 SQLite decision

Decision date: 2026-10-02.

The WTS 2027 site uses plain SQLite through its SolidStart backend.
PocketBase is not part of the 2027 application runtime or deployment.
Central auth owns credentials and shared profiles.
The site owns its local sessions, edition-scoped permissions, and public conference records.

The existing WTS 2026 deployment keeps PocketBase and its data.
The 2027 cleanup must preserve that deployment and its source requirements.
It must not modify production data, copy historical roles into 2027 permissions, or change authentication callbacks without separate approval.

The backend replaces required PocketBase collection rules, hooks, and browser calls with server-owned operations.
Use an application-owned schema rather than querying PocketBase's internal SQLite tables.
Import only explicitly selected records and files.
Private CFP records and credentials do not belong in the site's public content import.

The SQLite file lives in persistent storage outside the application image.
The deployment uses a local filesystem on one node, short write transactions, explicit schema migrations, and consistent backups.
Restore verification must prove that records survive replacement of the application container.

The local implementation lives in the isolated `site/` workspace as `@wts/site`.
It retains public pages, anonymous JSON and MCP, owned assets, OG images, and central profile access.
It stores immutable public publications, local sessions, and edition grants in its own SQLite schema.
The maintenance CLI supplies explicit initialization, migrations, reviewed imports, backups, and new-directory restore.
Restore clears sessions and disables privileged grants pending reconciliation.
Read [2027 site operations](../../site/README.md) for the runtime and recovery contract.

The root application and the existing 2026 PocketBase deployment remain intact.
Production client registration, deployment, historical content imports, and historical asset routing remain separate authorized release decisions.

### Cross-application login

Use OpenID Connect (OIDC) for login between independent applications. Register each application as a separate client with an exact callback URL.

The identity provider owns the central login session. Each application owns its local session.

A user who moves between applications can encounter a redirect through the identity provider. An active central session avoids another credential prompt.

Use the authorization code flow with PKCE. For server-rendered applications, exchange the code on the server and keep tokens out of browser storage.

Use host-only, Secure, HttpOnly session cookies. Do not share a bearer session cookie through `Domain=wts.sh` by default.

A domain-wide cookie would reach every matching subdomain backend. A blog or another less-trusted application must not receive privileged application sessions.

Public pages remain accessible without login. Shared identity does not mean that every application must require authentication.

### Identity and data ownership

| Layer | Owner | Examples |
| --- | --- | --- |
| Auth identity | Identity provider | Credentials, social identities, MFA, verified login email, central session |
| Shared WTS profile | WTS profile store | Stable WTS user ID, common name, avatar, preferred language |
| CFP data | CFP application | Speaker bio, proposals, review assignments |
| Ticketing data | Open Event Platform | Local accounts, orders, billing details, tickets, attendees |
| Authorization | Owning application | App access, role assignments, conference-edition scope, resource-specific permissions |

Each field has one authoritative owner. Other applications can read it or maintain a controlled cache.

A speaker display name and a billing name are different fields. An attendee contact email and a verified login email are also different fields.

The identity application stores the shared WTS profile in PostgreSQL. Conference records reference its stable WTS user ID without storing credentials or duplicating the shared profile.

Uploaded files remain separate from structured records. Persistent local files or object storage can hold them, with file metadata and access checks in the owning application.

File-storage hosting and the upload migration procedure remain open.

### CFP publication to the main site

CFP owns private proposals, reviews, and selection decisions.
The main site owns its public program records in its own SQLite database.
Publication transfers approved public content between the applications through an explicit contract.
It does not share database access or expose raw CFP records.

Selection and publication are separate decisions.
Accepted proposals do not become public automatically.
Only approved public fields can enter the publication payload.
Reviews, scores, contact details, and internal notes remain private.
The contract must identify the conference edition and source proposals.

A versioned publication payload is the proposed integration.
The receiving application must handle repeats without duplicate program records.
Transport, public-field ownership, revision handling, and withdrawal behavior remain implementation decisions.


### Stable identity links

Use the existing PocketBase user ID as the WTS user ID during the transition.

Map the identity provider's issuer and subject to that WTS user ID. Do not use email as the permanent identity key.

If the provider uses pairwise subjects, define explicit mappings for each client. Do not assume that all clients receive the same subject.

Link an application's local account to the WTS user ID through its integration. Preserve existing CFP and speaker references.

Provider changes must update identity mappings without changing ownership of historical WTS records.

### Permissions

#### Agreed ownership

Central authentication and application-local authorization are the selected design for WTS.
A successful login proves identity, not permission to use every application.
Auth supplies the verified identity and stable WTS user ID.
Each application stores its role assignments in its own database and enforces its own permission rules.
Auth does not store application role assignments or include them in central identity tokens.

The shared WTS profile holds common personal details, not permission grants.
An application's local profile also does not grant permissions by itself.
Keep profile edits separate from role administration.
Users must not grant themselves privileged access through profile fields.

#### Role assignments

Associate each role assignment with a stable WTS user ID and the owning application.
Scope conference roles by edition where required.
A user can hold multiple roles within an application, such as speaker and reviewer.

| Application | Assignment for the same user | Effect |
| --- | --- | --- |
| `cfp.wts.sh` | Reviewer for the 2027 edition | Can perform reviewer actions permitted by CFP's resource-specific rules |
| `wts.sh` | No privileged role assignment | Has ordinary access, not administrator access |

A CFP administrator does not automatically become a main-site administrator.
Do not automatically grant 2027 access from a historical 2026 role.
Preserve current explicit admin approval and capability rules until an approved replacement exists.

#### Server-side enforcement

Enforce permissions on the server for every protected request.
Deny protected access unless an explicit rule permits it.
Check the requested resource as well as the role.
A reviewer role alone must not grant access to every proposal.
Apply the relevant review assignment, conference edition, and other CFP access rules.
Do not trust browser-supplied roles or rely on hidden interface controls.

#### Administration and tradeoffs

Administrators manage identities once in auth and manage role assignments in each owning application.
Ordinary access does not require a privileged role assignment for every user.
The tradeoff is separate role administration and server-side authorization in each application.
This keeps each application's permission rules independent of auth and other applications.

A central authorization service is a valid alternative, but WTS does not select it.
Separate databases are an ownership choice, not a security requirement.
A future central administration screen can use application-owned interfaces without moving role ownership into auth.
That screen is not part of the current scope.

#### Revocation

Role removal must affect later protected requests rather than wait for a central identity token to expire.
Each application must define how it invalidates any cached permissions.
Central account suspension, local logout, global logout, and session expiry need an explicit consumer contract.
Ending a central session does not automatically end application sessions.
Consumer integration must define and verify these behaviors before cutover.


### Ticketing platform independence

Open Event Platform must not require WTS's identity provider, profile store, or domain names.

The proposed integration lets an operator configure an OIDC provider. The platform maps an external identity to a local account.

For WTS, that local account also links to the shared WTS user ID. Other installations use their own account data and identity provider.

Standalone local login, multiple providers, and tenant-specific provider configuration remain product decisions. This brief does not settle them.

An account, purchaser, and attendee are not interchangeable. One purchaser can buy tickets for several attendees.

Keep account, order, ticket, and attendee records distinct. Link an attendee to a WTS user only after a suitable ownership check.

Guest checkout policy remains open. Do not require every attendee to create an account merely to support shared identity.

## Current WTS evidence

The following observations come from repository code, not a production data audit:

- [Session policy](../../src/lib/session-policy.ts) uses host-only HttpOnly cookies and same-origin checks for session mutations.
- [Server auth](../../src/lib/server-auth-core.ts) validates PocketBase tokens through `users.authRefresh()` and requires verified users.
- [Browser auth](../../src/lib/auth-context.tsx) exchanges temporary OAuth tokens for a server-set session and clears browser auth state.
- [Collection types](../../src/lib/pocketbase-types.ts) show user references in CFP applicant and speaker records.
- [HiEvents evidence matching](../../src/lib/gamification-hievents-evidence.ts) currently matches attendee data by normalized email.
- [PocketBase guidance](../agent-guidelines/pocketbase.md) describes capability rules and explicit 2027 admin approval.

The current session-policy smoke check used synthetic requests. Same-origin mutations passed, sibling-origin mutations failed, and the cookie had no Domain attribute.

The ticketing [package manifest](../../../open-event-platform/package.json) uses `better-sqlite3`. Its [accepted storage ADR](../../../open-event-platform/docs/adr/0007-modular-monolith-and-relational-write-model.md) selects SQLite for a single-node deployment.

This assessment did not verify an existing OIDC integration in the ticketing application.

## Migration constraints

An external OIDC token is not a drop-in replacement for a PocketBase token. Existing PocketBase collection rules depend on PocketBase authentication.

Move conference data access behind server-side authorization when replacing PocketBase. Preserve record ownership checks, capability rules, and approved permissions.

Remove obsolete PocketBase clients, auth paths, hooks, and configuration after the replacement passes its acceptance checks.

Keep existing passwords working without a mandatory reset. Import PocketBase's bcrypt hashes unchanged and configure Better Auth to verify them with bcrypt.

Preserve existing Google and GitHub identity links. Do not merge accounts solely because their email addresses match.

Preserve verification states and approved permissions deliberately. Expect existing sessions to require a new login at cutover unless a tested transition proves otherwise.

Central logout does not automatically terminate every application's local session. Define local logout, global logout, expiry, and revocation behavior explicitly.

The target replaces PocketBase for the main site and CFP.
Migrate each application's structured records into its own SQLite schema rather than reusing PocketBase's internal database schema.
The current 2026 PocketBase site and its data remain unchanged until a separate cutover receives approval.

Preserve historical user IDs and record relationships. Rehearse record and upload migration with isolated data before production cutover.

## User migration plan

Status: Future work. Research established the migration mechanisms, but no production user audit, importer, or end-to-end migration has run.

### Required user experience

An existing email and password must still authenticate the same WTS user after migration. An existing Google or GitHub login must resolve to that same user.

Users must not create replacement accounts or lose historical records. A user with several login methods must retain all of them on one account.

Existing PocketBase sessions are not part of the credential import. Users must expect one new login after cutover.

Provider consent or account selection can still appear during social login. That does not mean that the WTS account was lost.

### User and profile records

Preserve the existing PocketBase user ID as the Better Auth user ID where the selected version permits imported IDs.

If implementation requires different auth IDs, retain an explicit mapping to the unchanged WTS user ID.

Preserve email, verification state, profile fields, timestamps, avatar files, and conference record references.

Keep username, email visibility, and other source fields in an appropriate profile record if Better Auth has no matching field.

Keep historical roles in application policy. Do not convert a conference administrator into an unrestricted auth-server administrator.

Inspect target email normalization before import. Report missing emails, duplicate normalized emails, missing identity links, and conflicting ownership instead of guessing.

### Password accounts

PocketBase stores bcrypt password hashes. Better Auth uses scrypt by default, so its default verifier cannot authenticate those imported hashes.

Configure Better Auth's `emailAndPassword.password.hash` and `verify` callbacks to use bcrypt initially. The verifier compares the supplied plaintext password with the imported hash.

| Better Auth account field | Value |
| --- | --- |
| `userId` | Imported Better Auth user ID |
| `providerId` | `credential` |
| `accountId` | Imported Better Auth user ID |
| `password` | Original PocketBase bcrypt hash, unchanged |

Use a controlled importer against the generated Better Auth schema. Do not submit the hash as a plaintext password through signup.

PocketBase hides password hashes from ordinary record responses. Export them from a consistent backup or through privileged server-side record access.

Import each existing nonempty password hash. Do not infer that a social-login user lacks a usable password.

PocketBase can generate random passwords for OAuth-created users. Hash presence alone does not show whether the user chose or knows the password.

Preserve those hashes without assigning new passwords or removing recovery paths. An empty source hash must not produce a fabricated credential.

Verify password length, Unicode, and input-handling compatibility for the selected versions. Do not trim or normalize passwords during import.

No automatic rehash-on-login behavior is assumed. A future hash-format change needs its own supported implementation and verification.

### Social accounts

Export PocketBase's `_externalAuths` links for the WTS users collection. Preserve the provider-assigned identity, not just its email.

| PocketBase external-auth field | Better Auth account field |
| --- | --- |
| `provider`, such as `google` or `github` | `providerId` |
| `providerId`, the provider-assigned user ID | `accountId` |
| `recordRef`, the linked PocketBase user ID | `userId`, through the stable user mapping |

PocketBase versions before 0.23 use `recordId` and `collectionId` instead of `recordRef` and `collectionRef`. Verify the source schema before export.

The field names are misleading: PocketBase's `providerId` is the external user ID, not the provider name.

Google's stable identity is its `sub` claim. GitHub's stable identity is its numeric user ID, not its username.

Prepopulate the exact provider and external user ID links. Existing social login must resolve through those links without relying on email-based account linking.

Configure implicit linking conservatively. Explicitly imported links must not merge unrelated users when provider emails match or change.

Old provider access and refresh tokens are not required to preserve sign-in. Better Auth obtains fresh tokens during the next provider login.

Reuse the existing Google OAuth client where practical. Register the actual Better Auth callback URL before cutover.

Google supports several authorized redirect URIs. A GitHub OAuth App has one configured callback URL, so its callback requires a coordinated change or a separate app.

Callback configuration and consent behavior depend on the selected provider app. Do not promise that every user avoids a consent prompt.

### Rehearsal and cutover

Treat password-hash exports as sensitive credential data. Keep exports outside Git and logs with restricted access.

The importer must reject ownership conflicts and support reruns without duplicate users or account links.

Freeze signup, password changes, email changes, and identity-link changes during the final export and import. Rehearse backup restoration before cutover.

Define rollback before enabling new identity writes. Do not roll back to a stale snapshot after users change credentials in Better Auth.

1. Pin the source PocketBase version and the target Better Auth version and plugins.
2. Export a consistent snapshot of users, hashes, identity links, profiles, and file references.
3. Import the snapshot into isolated PostgreSQL with stable IDs and explicit account links.
4. Exercise password, social login, recovery, permissions, and historical ownership in the rehearsal.
5. Perform the authorized final cutover with identity writes frozen and a verified rollback procedure.

Production data access, exports, provider configuration, and deployment require separate authorization.

### Required migration checks

- The original password authenticates the original user, and an incorrect password fails.
- Google and GitHub login resolve to their imported users without creating duplicates.
- A user with password and social login retains every method on the same account.
- Changed provider emails do not redirect ownership to another user.
- Verification states, recovery behavior, application permissions, profile files, and historical record links remain correct.
- Legacy password lengths and Unicode inputs preserve the source login behavior.
- Import reruns do not create duplicates, and conflicts stop the import.
- New sessions reach the conference and ticketing applications through the central OIDC server.

Use synthetic users and isolated databases for the first proof. Real provider login checks require explicitly authorized test accounts and callback configuration.

## Decisions needed before implementation

| Decision | Options or required answer |
| --- | --- |
| Better Auth configuration | Pinned version, enabled plugins, OIDC client registration, and password verifier |
| Operations | Hosting owner, backups, restore procedure, updates, availability, and account recovery |
| Profile interface | Shared fields, authoritative owners, update rules, and how applications read them |
| Conference migration | Separate application schemas, migration workflow, server interfaces, equivalent authorization, and cutover procedure |
| CFP publication | Approved public fields, stable references, payload versions, transport, revision handling, and withdrawal behavior |
| Credential migration | Version-pinned exporter/importer, bcrypt configuration, identity-link conflicts, and cutover proof |
| Session and revocation policy | Local/global logout, account suspension, local session lifetime, permission-cache invalidation, and privileged-session requirements |
| Application authorization | Local role schemas, edition scope, resource-specific rules, and authorized role-administration interfaces |
| FOSS account model | Standalone login, supported external providers, and any tenant requirements |
| Ticket ownership | Purchaser/attendee links, guest checkout, claim proof, and transfer behavior |
| Upload storage | Persistent local files or object storage, access rules, and migration procedure |

Better Auth, PostgreSQL for identity, and separate SQLite databases for the other WTS applications are selected.
Central authentication and application-local authorization are also selected.
Application role ownership is not an open decision.
Application hosting, publication interfaces, and operational details remain open.

## First end-to-end milestone

Prove shared login between WTS and Open Event Platform with synthetic users and isolated local data.

1. Configure Better Auth with PostgreSQL and define the stable identity mapping.
2. Connect both applications through separate OIDC clients and host-only sessions.
3. Show the same WTS profile identity in both applications.
4. Verify app-specific permissions and denied access for an unauthorized account.
5. Document session termination and a reversible migration rehearsal.

This milestone must exercise real browser redirects, callbacks, cookies, and server authorization. A token mock alone is not proof of SSO.

## Proposed acceptance checks

- A user signs in once and reaches the second application without another credential prompt while the central session remains valid.
- Both applications resolve the same WTS user ID, but neither receives the other's session cookie.
- Historical CFP and speaker records remain linked to the correct user after a migration rehearsal.
- The main site and CFP use separate SQLite databases and application-owned backends without PocketBase dependencies after cutover.
- The same user can review permitted 2027 proposals in CFP without gaining administrator access on the main site.
- Protected requests fail for missing roles, wrong editions, and resources outside the user's permitted assignments.
- Profile edits cannot grant roles, and historical 2026 roles do not automatically grant 2027 access.
- Role removal and central session termination obey the selected revocation contract, including any local permission caches.
- Existing passwords and linked Google/GitHub accounts authenticate the same WTS users without mandatory password resets or duplicate accounts.
- Email changes and purchaser/attendee differences do not silently change account ownership or permissions.
- Another operator can configure Open Event Platform with a non-WTS OIDC provider without WTS-specific infrastructure.

Also verify the selected logout and revocation contract. Distinguish local logout from global logout in both behavior and user-facing text.

Use synthetic data for the initial proof. Production data access, credential exports, emails, DNS changes, and deployment require separate authorization.

## Outside this brief

This brief records the target database replacement. It does not authorize implementation, production migration, deployment, repository creation, or tracker publication.

A later specification must define the selected interfaces, migration procedure, recovery procedure, and measurable acceptance criteria.

## References

- [Auth0: central SSO and separate application sessions](https://auth0.com/docs/authenticate/single-sign-on)
- [MDN: cookie scope and security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
- [OWASP: authentication security guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP: authorization, least privilege, and server-side access checks](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [PocketBase: authentication and token behavior](https://pocketbase.io/docs/authentication/)
- [PocketBase: bcrypt password field implementation](https://github.com/pocketbase/pocketbase/blob/master/core/field_password.go)
- [Auth0: user import schema and supported password hashes](https://auth0.com/docs/manage-users/user-migration/bulk-user-import-schema)
- [Better Auth: OAuth Provider plugin with OIDC support](https://www.better-auth.com/docs/plugins/oauth-provider)
- [Better Auth: PostgreSQL adapter](https://www.better-auth.com/docs/adapters/postgresql)
- [Better Auth: SQLite adapter](https://www.better-auth.com/docs/adapters/sqlite)
- [Better Auth: bcrypt and account migration guide](https://better-auth.com/docs/guides/clerk-migration-guide)
- [Better Auth: custom password hashing and verification](https://better-auth.com/docs/authentication/email-password)
- [PocketBase: external-auth identity fields](https://github.com/pocketbase/pocketbase/blob/master/core/external_auth_model.go)
- [Google: stable subject identifiers and callback requirements](https://developers.google.com/identity/openid-connect/reference)
- [GitHub: OAuth App callback requirements](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

Provider documentation and upstream source can change. Verify the selected versions before implementation.
