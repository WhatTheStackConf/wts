/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4224952730")

  // update affiliation field to be optional (not required)
  // The form UX treats affiliation as optional (no asterisk, no validation)
  // but the schema had it as required, causing HTTP 400 on form step 2 submission
  const field = collection.fields.getById("text3933345072")
  field.required = false

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4224952730")

  // revert: make affiliation required again
  const field = collection.fields.getById("text3933345072")
  field.required = true

  return app.save(collection)
})
