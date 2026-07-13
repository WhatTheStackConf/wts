/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const isValidHttpsPartnerUrl = (value) => {
      if (!value) return true;
      if (/\s/.test(value)) return false;

      const match = /^https:\/\/([^/?#]+)(?:[/?#][^\s]*)?$/i.exec(value);
      if (!match) return false;

      const authority = match[1].slice(match[1].lastIndexOf("@") + 1);
      if (!authority) return false;
      if (authority.startsWith("[")) return /^\[[0-9a-f:.]+\](?::\d+)?$/i.test(authority);

      const colon = authority.lastIndexOf(":");
      const hasPort = colon >= 0;
      if (hasPort) {
        const port = authority.slice(colon + 1);
        if (authority.indexOf(":") !== colon || !/^\d+$/.test(port) || Number(port) > 65535) return false;
      }
      const host = hasPort ? authority.slice(0, colon) : authority;
      return Boolean(host) && !host.startsWith(".") && !host.endsWith(".") && !host.includes("..");
    };
    const partners = app.findCollectionByNameOrId("partners");
    const type = partners.fields.getByName("type");
    type.values = [...type.values, "community_partner"];
    app.save(partners);

    app.db().newQuery(`
      UPDATE partners
      SET
        type = CASE
          WHEN type = 'supporter' THEN 'community_partner'
          WHEN type = 'company_supporter' THEN 'supporter'
          WHEN type = 'sponsor' AND COALESCE(tier, '') = '' THEN 'supporter'
          ELSE type
        END,
        tier = CASE
          WHEN type = 'sponsor' AND COALESCE(tier, '') != '' THEN tier
          ELSE ''
        END
    `).execute();

    for (const partner of app.findAllRecords(partners)) {
      if (partner && partner.getBool("published") && !isValidHttpsPartnerUrl(partner.getString("url"))) {
        partner.set("published", false);
        app.save(partner);
      }
    }

    const description = partners.fields.getByName("description");
    description.name = "notes";
    type.values = [
      "organizer",
      "sponsor",
      "supporter",
      "community_partner",
      "media",
      "catering",
      "other",
    ];
    partners.listRule = null;
    partners.viewRule = null;
    partners.createRule = null;
    partners.updateRule = null;
    partners.deleteRule = null;
    app.save(partners);
  },
  (app) => {
    if (app.countRecords("partners", "") > 0) {
      throw new Error("Normalized Partner records exist; this retained data migration cannot be rolled back.");
    }

    const partners = app.findCollectionByNameOrId("partners");
    partners.fields.getByName("notes").name = "description";
    partners.fields.getByName("type").values = [
      "organizer",
      "sponsor",
      "supporter",
      "media",
      "catering",
      "other",
      "company_supporter",
    ];
    const publicListView = "published = true || @request.auth.role = 'admin'";
    partners.listRule = publicListView;
    partners.viewRule = publicListView;
    partners.createRule = "@request.auth.role = 'admin'";
    partners.updateRule = "@request.auth.role = 'admin'";
    partners.deleteRule = "@request.auth.role = 'admin'";
    app.save(partners);
  },
);
