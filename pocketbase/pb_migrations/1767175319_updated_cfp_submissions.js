/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // update collection data
  unmarshal({
    "deleteRule": "@request.auth.id = applicant.user || @request.auth.role = 'admin'",
    "listRule": "@request.auth.id = applicant.user || @request.auth.role = 'admin'",
    "updateRule": "@request.auth.id = applicant.user || @request.auth.role = 'admin'",
    "viewRule": "@request.auth.id = applicant.user || @request.auth.role = 'admin'"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // update collection data
  unmarshal({
    "deleteRule": "@request.auth.id = applicant.user.id || @request.auth.role = 'admin'",
    "listRule": "@request.auth.id = applicant.user.id || @request.auth.role = 'admin'",
    "updateRule": "@request.auth.id = applicant.user.id || @request.auth.role = 'admin'",
    "viewRule": "@request.auth.id = applicant.user.id || @request.auth.role = 'admin'"
  }, collection)

  return app.save(collection)
})
