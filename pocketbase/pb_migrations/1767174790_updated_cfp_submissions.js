/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != '' && @collection.cfp_applicants.user.id ?= @request.auth.id || @request.auth.role = 'admin'"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != '' && @collection.cfp_applicants.user.id ?= @request.auth.id"
  }, collection)

  return app.save(collection)
})
