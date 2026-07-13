/// <reference path="../pb_data/types.d.ts" />

routerAdd("PATCH", "/api/wts/partners/{id}", (e) => {
  function responseRecord(record) {
    return {
      id: record.id,
      name: record.getString("name"),
      normalized_name: record.getString("normalized_name"),
      published: record.getBool("published"),
      type: record.getString("type"),
      tier: record.getString("tier"),
      logo: record.getString("logo"),
      logo_uploaded_by_human: record.getBool("logo_uploaded_by_human"),
      url: record.getString("url"),
      canonical_url: record.getString("canonical_url"),
      mutation_token: record.getString("mutation_token"),
      notes: record.getString("notes"),
      note_agent_visible: record.getBool("note_agent_visible"),
      created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }

  const request = e.requestInfo();
  const expectedVersion = String(request.body.expected_version || "");
  const separator = expectedVersion.lastIndexOf("|");
  if (separator < 1 || separator === expectedVersion.length - 1) {
    throw new BadRequestError("Partner update requires expected_version.");
  }
  const expectedTimestamp = expectedVersion.slice(0, separator);
  const expectedToken = expectedVersion.slice(separator + 1);
  const body = {};
  for (const key in request.body) {
    if (key !== "expected_version") body[key] = request.body[key];
  }
  try {
    const file = e.request.formFile("logo");
    if (file && file[1]) body.logo = $filesystem.fileFromMultipart(file[1]);
  } catch {
    // No replacement logo was uploaded.
  }

  let result;
  $app.runInTransaction((txApp) => {
    const id = e.request.pathValue("id");
    const nextToken = $security.randomString(32);
    const claimed = txApp.db().newQuery(`
      UPDATE partners
      SET mutation_token = {:nextToken}
      WHERE id = {:id} AND updated = {:expectedTimestamp} AND mutation_token = {:expectedToken}
    `).bind({ id, expectedTimestamp, expectedToken, nextToken }).execute();
    if (claimed.rowsAffected() !== 1) {
      result = { success: false, current: responseRecord(txApp.findRecordById("partners", id)) };
      return;
    }

    const record = txApp.findRecordById("partners", id);
    record.set("mutation_token", nextToken);
    const form = new RecordUpsertForm(txApp, record);
    form.grantSuperuserAccess();
    form.load(body);
    form.submit();
    result = { success: true, record: responseRecord(record) };
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

routerAdd("DELETE", "/api/wts/partners/{id}", (e) => {
  function responseRecord(record) {
    return {
      id: record.id,
      name: record.getString("name"),
      normalized_name: record.getString("normalized_name"),
      published: record.getBool("published"),
      type: record.getString("type"),
      tier: record.getString("tier"),
      logo: record.getString("logo"),
      logo_uploaded_by_human: record.getBool("logo_uploaded_by_human"),
      url: record.getString("url"),
      canonical_url: record.getString("canonical_url"),
      mutation_token: record.getString("mutation_token"),
      notes: record.getString("notes"),
      note_agent_visible: record.getBool("note_agent_visible"),
      created: record.getString("created"),
      updated: record.getString("updated"),
    };
  }

  const expectedVersion = String(e.requestInfo().body.expected_version || "");
  const separator = expectedVersion.lastIndexOf("|");
  if (separator < 1 || separator === expectedVersion.length - 1) {
    throw new BadRequestError("Partner deletion requires expected_version.");
  }
  const expectedTimestamp = expectedVersion.slice(0, separator);
  const expectedToken = expectedVersion.slice(separator + 1);
  let result;
  $app.runInTransaction((txApp) => {
    const id = e.request.pathValue("id");
    const claimed = txApp.db().newQuery(`
      UPDATE partners
      SET mutation_token = {:nextToken}
      WHERE id = {:id} AND updated = {:expectedTimestamp} AND mutation_token = {:expectedToken}
    `).bind({
      id,
      expectedTimestamp,
      expectedToken,
      nextToken: $security.randomString(32),
    }).execute();
    if (claimed.rowsAffected() !== 1) {
      result = { success: false, current: responseRecord(txApp.findRecordById("partners", id)) };
      return;
    }
    txApp.delete(txApp.findRecordById("partners", id));
    result = { success: true };
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());
