/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // add field
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

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "autodate3332085495",
    "name": "updated",
    "onCreate": false,
    "onUpdate": true,
    "presentable": false,
    "system": false,
    "type": "autodate"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1044276370")

  // remove field
  collection.fields.removeById("autodate2413224187")

  // remove field
  collection.fields.removeById("autodate3332085495")

  return app.save(collection)
})
