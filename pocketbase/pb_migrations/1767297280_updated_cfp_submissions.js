/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // update field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "autodate2413224187",
    "name": "created",
    "onCreate": true,
    "onUpdate": false,
    "presentable": false,
    "system": false,
    "type": "autodate"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // update field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "autodate2413224187",
    "name": "create",
    "onCreate": true,
    "onUpdate": false,
    "presentable": false,
    "system": false,
    "type": "autodate"
  }))

  return app.save(collection)
})
