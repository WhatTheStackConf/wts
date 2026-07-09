# Split Implementation Into Agent-Ready Work

Status: closed
Labels: wayfinder:task
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)
Blocks: [Add Programme Provenance Schema And Types](08-add-programme-provenance-schema-and-types.md), [Align Public and MCP Programme DTO Mapping](09-align-public-and-mcp-programme-dto-mapping.md), [Add Speaker Profile Admin APIs](10-add-speaker-profile-admin-apis.md), [Build Admin Speaker Edit UI](11-build-admin-speaker-edit-ui.md), [Add CFP Promotion Admin APIs](12-add-cfp-promotion-admin-apis.md), [Build CFP Promotion And Draft Review UI](13-build-cfp-promotion-and-draft-review-ui.md)

## Question

Turn the resolved decisions into a small set of implementation tickets that an agent can pick up without further product discovery.

The tickets should preserve safe sequencing, include verification expectations, and avoid mixing unrelated concerns. They should cover only the admin Speaker editing and CFP Submission promotion destination described by the map.

## Resolution

Resolved in the resolution comment below.

## Comments

### Resolution Comment - 2026-07-08

Implementation is split into six ready-for-agent slices: [Add Programme Provenance Schema And Types](08-add-programme-provenance-schema-and-types.md), [Align Public and MCP Programme DTO Mapping](09-align-public-and-mcp-programme-dto-mapping.md), [Add Speaker Profile Admin APIs](10-add-speaker-profile-admin-apis.md), [Build Admin Speaker Edit UI](11-build-admin-speaker-edit-ui.md), [Add CFP Promotion Admin APIs](12-add-cfp-promotion-admin-apis.md), and [Build CFP Promotion And Draft Review UI](13-build-cfp-promotion-and-draft-review-ui.md). The sequence keeps schema/types first, then DTO/API foundations, then UI slices, with verification expectations on each ticket.
