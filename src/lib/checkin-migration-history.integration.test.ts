import { expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { startCheckinPocketBase } from "./checkin-pocketbase-test-helper";
import { REQUIRED_CHECKIN_FIELDS, verifyCheckinSchema } from "../../runtime/checkin/schema-readiness";

it("reads back every copied migration and all required runtime fields, rather than trusting migrate exit status", async () => {
  const f = await startCheckinPocketBase();
  try {
    const db = new DatabaseSync(join(f.root, "pb_data", "data.db"), { readOnly: true });
    try {
      const applied = db.prepare('SELECT file FROM "_migrations"').all().map(row => String(row.file));
      const expected = [...new Set(f.migrations)].sort();
      expect(applied.filter(name => expected.includes(name)).sort()).toEqual(expected);
      expect(applied.filter(name => expected.includes(name))).toHaveLength(expected.length);
    } finally { db.close(); }
    await verifyCheckinSchema(f.pb);
    for (const [collection, fields] of Object.entries(REQUIRED_CHECKIN_FIELDS)) {
      const schema = await f.pb.collections.getOne(collection);
      for (const [field, type] of Object.entries(fields)) expect(schema.fields.some(item => item.name === field && item.type === type)).toBe(true);
    }
  } finally { await f.cleanup(); }
});
