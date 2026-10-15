/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const migrateScopes = (scopes) => {
      const migrated = [];
      for (const scope of scopes) {
        const replacements = scope === "program:read"
          ? ["programme:read", "cfp:read"]
          : [scope];
        for (const replacement of replacements) {
          if (migrated.indexOf(replacement) === -1) migrated.push(replacement);
        }
      }
      return migrated;
    };
    const collection = app.findCollectionByNameOrId("mcp_tokens");
    for (const token of app.findAllRecords(collection)) {
      const scopes = token.get("scopes");
      if (!Array.isArray(scopes) || scopes.indexOf("program:read") === -1) continue;

      token.set("scopes", migrateScopes(scopes));
      app.save(token);
    }
  },
  (app) => {
    if (app.countRecords("mcp_tokens", "") > 0) {
      throw new Error("Migrated MCP token scopes cannot be rolled back without widening authority.");
    }
  },
);
