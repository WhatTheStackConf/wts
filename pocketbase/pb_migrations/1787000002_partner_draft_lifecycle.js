/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const normalizeName = (value) => {
      let normalized = String(value || "");
      try {
        normalized = normalized.normalize("NFKC");
      } catch {
        // Older migration runtimes may not expose Unicode normalization.
      }
      return normalized.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    };
    const normalizeIpv6Host = (value) => {
      const sides = value.toLowerCase().split("::");
      if (sides.length > 2) return "";
      const left = sides[0] ? sides[0].split(":") : [];
      const right = sides[1] ? sides[1].split(":") : [];
      const groups = [...left, ...right];
      if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return "";
      if (sides.length === 1 && groups.length !== 8) return "";
      if (sides.length === 2 && groups.length >= 8) return "";
      const expanded = [
        ...left,
        ...Array.from({ length: 8 - groups.length }, () => "0"),
        ...right,
      ].map((group) => Number.parseInt(group, 16).toString(16));
      let bestStart = -1;
      let bestLength = 0;
      for (let index = 0; index < expanded.length;) {
        if (expanded[index] !== "0") {
          index += 1;
          continue;
        }
        let end = index;
        while (end < expanded.length && expanded[end] === "0") end += 1;
        if (end - index > bestLength && end - index >= 2) {
          bestStart = index;
          bestLength = end - index;
        }
        index = end;
      }
      if (bestStart < 0) return expanded.join(":");
      return `${expanded.slice(0, bestStart).join(":")}::${expanded.slice(bestStart + bestLength).join(":")}`;
    };
    const removeDotSegments = (path) => {
      const output = [];
      const segments = path.split("/");
      const lastSegment = segments[segments.length - 1].toLowerCase().replace(/%2e/g, ".");
      const trailingSlash = path.endsWith("/") || lastSegment === "." || lastSegment === "..";
      for (const segment of segments) {
        const dot = segment.toLowerCase().replace(/%2e/g, ".");
        if (dot === ".") continue;
        if (dot === "..") {
          if (output.length > 1) output.pop();
          continue;
        }
        output.push(segment);
      }
      let normalized = output.join("/") || "/";
      if (!normalized.startsWith("/")) normalized = `/${normalized}`;
      if (trailingSlash && !normalized.endsWith("/")) normalized += "/";
      return normalized;
    };
    const normalizePercentEncoding = (value) => {
      if (/%(?![0-9a-f]{2})/i.test(value)) return "";
      return value.replace(/%([0-9a-f]{2})/gi, (_match, hex) => {
        const character = String.fromCharCode(Number.parseInt(hex, 16));
        return /^[a-z0-9\-._~]$/i.test(character) ? character : `%${hex.toUpperCase()}`;
      });
    };
    const normalizeDomainHost = (value) => {
      if (/^[0-9.]+$/.test(value)) {
        const groups = value.split(".");
        if (groups.length !== 4 || groups.some((group) => !/^\d{1,3}$/.test(group))) return "";
        const numbers = groups.map(Number);
        return numbers.some((group) => group > 255) ? "" : numbers.join(".");
      }
      const labels = value.split(".");
      if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
        return "";
      }
      return value.toLowerCase();
    };
    const canonicalUrl = (value) => {
      const url = String(value || "").trim();
      if (!url || /[^\x21-\x7e]/.test(url) || url.includes("\\")) return "";
      const match = /^https:\/\/([^/?#]+)([^#]*)?(?:#.*)?$/i.exec(url);
      if (!match || match[1].includes("@")) return "";
      let authority = match[1].toLowerCase();
      if (authority.startsWith("[")) {
        const close = authority.indexOf("]");
        if (close < 2) return "";
        const host = normalizeIpv6Host(authority.slice(1, close));
        if (!host) return "";
        const remainder = authority.slice(close + 1);
        if (remainder && !/^:\d+$/.test(remainder)) return "";
        const requestedPort = remainder ? Number(remainder.slice(1)) : undefined;
        if (requestedPort !== undefined && requestedPort > 65535) return "";
        authority = `[${host}]${requestedPort !== undefined && requestedPort !== 443 ? `:${requestedPort}` : ""}`;
      } else {
        const colon = authority.lastIndexOf(":");
        let port = "";
        let hostnameValue = authority;
        if (colon >= 0) {
          const requestedPort = authority.slice(colon + 1);
          if (authority.indexOf(":") !== colon || !/^\d+$/.test(requestedPort) || Number(requestedPort) > 65535) return "";
          hostnameValue = authority.slice(0, colon);
          const portNumber = Number(requestedPort);
          if (portNumber !== 443) port = String(portNumber);
        }
        const hostname = normalizeDomainHost(hostnameValue);
        if (!hostname) return "";
        authority = `${hostname}${port ? `:${port}` : ""}`;
      }
      const suffix = match[2] || "/";
      const queryStart = suffix.indexOf("?");
      const rawPath = queryStart >= 0 ? suffix.slice(0, queryStart) : suffix;
      const rawQuery = queryStart >= 0 ? suffix.slice(queryStart) : "";
      const path = normalizePercentEncoding(rawPath);
      const query = normalizePercentEncoding(rawQuery);
      if ((rawPath && !path) || (rawQuery && !query)) return "";
      return `https://${authority}${removeDotSegments(path || "/")}${query}`;
    };

    const partners = app.findCollectionByNameOrId("partners");
    partners.fields.getByName("logo").required = false;
    partners.fields.add(new Field({ name: "normalized_name", type: "text", required: false }));
    partners.fields.add(new Field({ name: "canonical_url", type: "text", required: false }));
    partners.fields.add(new Field({ name: "mutation_token", type: "text", required: false }));
    partners.fields.add(new Field({ name: "logo_uploaded_by_human", type: "bool", required: false }));
    partners.fields.add(new Field({ name: "note_agent_visible", type: "bool", required: false }));
    partners.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
    partners.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
    app.save(partners);

    const seenNames = {};
    const seenUrls = {};
    for (const partner of app.findAllRecords(partners)) {
      const nameIdentity = normalizeName(partner.getString("name"));
      const urlIdentity = canonicalUrl(partner.getString("url"));
      if (seenNames[nameIdentity]) {
        throw new Error(`Duplicate normalized Partner names must be resolved before migration: ${nameIdentity}`);
      }
      if (urlIdentity && seenUrls[urlIdentity]) {
        throw new Error(`Duplicate canonical Partner URLs must be resolved before migration: ${urlIdentity}`);
      }
      seenNames[nameIdentity] = partner.id;
      if (urlIdentity) seenUrls[urlIdentity] = partner.id;
      partner.set("normalized_name", nameIdentity);
      partner.set("canonical_url", urlIdentity);
      partner.set("mutation_token", partner.id);
      partner.set("logo_uploaded_by_human", Boolean(partner.getString("logo")));
      if (partner.getString("url") && !urlIdentity) partner.set("published", false);
      partner.set("note_agent_visible", false);
      const timestamp = new Date().toISOString().replace("T", " ");
      partner.set("created", timestamp);
      partner.set("updated", timestamp);
      app.save(partner);
    }

    partners.fields.getByName("normalized_name").required = true;
    partners.fields.getByName("mutation_token").required = true;
    partners.addIndex("idx_partners_normalized_name_unique", true, "normalized_name", "");
    partners.addIndex("idx_partners_canonical_url_unique", true, "canonical_url", "canonical_url != ''");
    app.save(partners);

  },
  (app) => {
    if (app.countRecords("partners", "logo = ''") > 0) {
      throw new Error("Partner drafts without logos exist; this lifecycle migration cannot be rolled back.");
    }
    const partners = app.findCollectionByNameOrId("partners");
    partners.removeIndex("idx_partners_normalized_name_unique");
    partners.removeIndex("idx_partners_canonical_url_unique");
    partners.fields.removeByName("normalized_name");
    partners.fields.removeByName("canonical_url");
    partners.fields.removeByName("mutation_token");
    partners.fields.removeByName("logo_uploaded_by_human");
    partners.fields.removeByName("note_agent_visible");
    partners.fields.removeByName("created");
    partners.fields.removeByName("updated");
    partners.fields.getByName("logo").required = true;
    app.save(partners);
  },
);
