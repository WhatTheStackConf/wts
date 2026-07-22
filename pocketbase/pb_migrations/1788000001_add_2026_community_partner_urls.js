/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const partnerUrls = [
      { id: "cp2600000000001", name: "BEST Skopje", url: "https://best.org.mk/" },
      { id: "cp2600000000002", name: "BeerJS Skopje", url: "https://beerjs.mk/" },
      {
        id: "cp2600000000003",
        name: "PHP Skopje",
        url: "https://www.facebook.com/phpskopje/",
      },
      {
        id: "cp2600000000004",
        name: "Doniraj Kompjuter",
        url: "https://donirajkompjuter.mk/",
      },
      {
        id: "cp2600000000005",
        name: "PyData Skopje",
        url: "https://www.meetup.com/pydata-skopje/",
      },
      { id: "cp2600000000006", name: "FEIT", url: "https://feit.ukim.edu.mk/en/" },
      {
        id: "cp2600000000007",
        name: "DisruptHR Skopje",
        url: "https://disrupthr.co/city/skopje/",
      },
      { id: "cp2600000000008", name: "FSS FINKI", url: "https://linktr.ee/FSSFinki" },
      {
        id: "cp2600000000009",
        name: "Google Developer Group Skopje",
        url: "https://gdg.community.dev/gdg-skopje/",
      },
      {
        id: "cp2600000000010",
        name: "Galactic Omnivore",
        url: "https://www.galacticomnivore.com/",
      },
      { id: "cp2600000000011", name: "FINKI", url: "https://finki.ukim.mk/" },
      {
        id: "cp2600000000012",
        name: "Faculty of Mechanical Engineering - Skopje",
        url: "https://www.mf.ukim.edu.mk/",
      },
      { id: "cp2600000000013", name: "Prodact", url: "https://prodact.mk/" },
      {
        id: "cp2600000000014",
        name: "Macedonian Games Industry Association",
        url: "https://mgi.mk/",
      },
      { id: "cp2600000000015", name: "UXplore", url: "https://uxplore.mk/" },
      {
        id: "cp2600000000016",
        name: "AWS User Group Macedonia",
        url: "https://www.meetup.com/awsugmkd/",
      },
      {
        id: "cp2600000000017",
        name: "EESTEC LC Skopje",
        url: "https://www.facebook.com/EESTECLCSkopje/",
      },
      {
        id: "cp2600000000018",
        name: "FSS FEIT",
        url: "https://feit.ukim.edu.mk/en/the-story-behind-the-name-fss-feit/",
      },
      {
        id: "cp2600000000019",
        name: "Dynamics 365 Macedonia",
        url: "https://community.dynamics.com/usergroups/details/?groupid=342f7174-3d40-ef11-8409-000d3a15433f",
      },
    ];

    const partners = app.findCollectionByNameOrId("partners");
    const records = Array.from(app.findAllRecords(partners));
    const recordsById = new Map(records.map((record) => [record.id, record]));
    const recordsByName = new Map(
      records.map((record) => [record.getString("normalized_name"), record]),
    );

    for (const partner of partnerUrls) {
      const record =
        recordsById.get(partner.id) || recordsByName.get(partner.name.toLocaleLowerCase("en-US"));
      if (!record || record.getString("url")) continue;

      record.set("url", partner.url);
      record.set("canonical_url", partner.url);
      app.save(record);
    }
  },
  (app) => {
    const partnerUrls = new Map([
      ["cp2600000000001", "https://best.org.mk/"],
      ["cp2600000000002", "https://beerjs.mk/"],
      ["cp2600000000003", "https://www.facebook.com/phpskopje/"],
      ["cp2600000000004", "https://donirajkompjuter.mk/"],
      ["cp2600000000005", "https://www.meetup.com/pydata-skopje/"],
      ["cp2600000000006", "https://feit.ukim.edu.mk/en/"],
      ["cp2600000000007", "https://disrupthr.co/city/skopje/"],
      ["cp2600000000008", "https://linktr.ee/FSSFinki"],
      ["cp2600000000009", "https://gdg.community.dev/gdg-skopje/"],
      ["cp2600000000010", "https://www.galacticomnivore.com/"],
      ["cp2600000000011", "https://finki.ukim.mk/"],
      ["cp2600000000012", "https://www.mf.ukim.edu.mk/"],
      ["cp2600000000013", "https://prodact.mk/"],
      ["cp2600000000014", "https://mgi.mk/"],
      ["cp2600000000015", "https://uxplore.mk/"],
      ["cp2600000000016", "https://www.meetup.com/awsugmkd/"],
      ["cp2600000000017", "https://www.facebook.com/EESTECLCSkopje/"],
      ["cp2600000000018", "https://feit.ukim.edu.mk/en/the-story-behind-the-name-fss-feit/"],
      [
        "cp2600000000019",
        "https://community.dynamics.com/usergroups/details/?groupid=342f7174-3d40-ef11-8409-000d3a15433f",
      ],
    ]);
    const partners = app.findCollectionByNameOrId("partners");

    for (const record of app.findAllRecords(partners)) {
      const seededUrl = partnerUrls.get(record.id);
      if (!seededUrl || record.getString("url") !== seededUrl) continue;

      record.set("url", "");
      if (record.getString("canonical_url") === seededUrl) record.set("canonical_url", "");
      app.save(record);
    }
  },
);
