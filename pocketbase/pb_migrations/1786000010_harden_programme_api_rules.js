/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    for (const name of ["speakers", "sessions"]) {
      const collection = app.findCollectionByNameOrId(name);
      collection.listRule = null;
      collection.viewRule = null;
      collection.createRule = null;
      collection.updateRule = null;
      collection.deleteRule = null;
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ["speakers", "sessions"]) {
      const collection = app.findCollectionByNameOrId(name);
      collection.listRule = "published = true || @request.auth.role = 'admin'";
      collection.viewRule = "published = true || @request.auth.role = 'admin'";
      collection.createRule = "@request.auth.role = 'admin'";
      collection.updateRule = "@request.auth.role = 'admin'";
      collection.deleteRule = "@request.auth.role = 'admin'";
      app.save(collection);
    }
  },
);
