/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const communityPartners = [
      { id: "cp2600000000001", name: "BEST Skopje", logo: "best-skopje.png" },
      { id: "cp2600000000002", name: "BeerJS Skopje", logo: "beerjs-skopje.png" },
      { id: "cp2600000000003", name: "PHP Skopje", logo: "php-skopje.png" },
      { id: "cp2600000000004", name: "Doniraj Kompjuter", logo: "doniraj-kompjuter.jpg" },
      { id: "cp2600000000005", name: "PyData Skopje", logo: "pydata-skopje.jpg" },
      { id: "cp2600000000006", name: "FEIT", logo: "feit.png" },
      { id: "cp2600000000007", name: "DisruptHR Skopje", logo: "disrupthr-skopje.png" },
      { id: "cp2600000000008", name: "FSS FINKI", logo: "fss-finki.png" },
      { id: "cp2600000000009", name: "Google Developer Group Skopje", logo: "gdg-skopje.png" },
      { id: "cp2600000000010", name: "Galactic Omnivore", logo: "galactic-omnivore.png" },
      { id: "cp2600000000011", name: "FINKI", logo: "finki.png" },
      {
        id: "cp2600000000012",
        name: "Faculty of Mechanical Engineering - Skopje",
        logo: "mechanical-engineering-skopje.png",
      },
      { id: "cp2600000000013", name: "Prodact", logo: "prodact.jpg" },
      {
        id: "cp2600000000014",
        name: "Macedonian Games Industry Association",
        logo: "mgi.png",
      },
      { id: "cp2600000000015", name: "UXplore", logo: "uxplore.svg" },
      {
        id: "cp2600000000016",
        name: "AWS User Group Macedonia",
        logo: "aws-user-group-macedonia.png",
      },
      { id: "cp2600000000017", name: "EESTEC LC Skopje", logo: "eestec-lc-skopje.png" },
      { id: "cp2600000000018", name: "FSS FEIT", logo: "fss-feit.png" },
      {
        id: "cp2600000000019",
        name: "Dynamics 365 Macedonia",
        logo: "dynamics-365-macedonia.png",
      },
    ];

    const partners = app.findCollectionByNameOrId("partners");
    const existingNames = new Set(
      Array.from(app.findAllRecords(partners), (record) => record.getString("normalized_name")),
    );
    const logoDirectory = `${__hooks}/../pb_migrations/community_partner_logos_2026`;

    for (const partner of communityPartners) {
      const normalizedName = partner.name.toLocaleLowerCase("en-US");
      if (existingNames.has(normalizedName)) continue;

      const record = new Record(partners, {
        id: partner.id,
        name: partner.name,
        normalized_name: normalizedName,
        published: true,
        type: "community_partner",
        tier: "",
        logo: $filesystem.fileFromPath(`${logoDirectory}/${partner.logo}`),
        logo_uploaded_by_human: true,
        url: "",
        canonical_url: "",
        notes: "",
        note_agent_visible: false,
        mutation_token: partner.id,
      });
      app.save(record);
      existingNames.add(normalizedName);
    }
  },
  (app) => {
    const seededIds = new Set([
      "cp2600000000001",
      "cp2600000000002",
      "cp2600000000003",
      "cp2600000000004",
      "cp2600000000005",
      "cp2600000000006",
      "cp2600000000007",
      "cp2600000000008",
      "cp2600000000009",
      "cp2600000000010",
      "cp2600000000011",
      "cp2600000000012",
      "cp2600000000013",
      "cp2600000000014",
      "cp2600000000015",
      "cp2600000000016",
      "cp2600000000017",
      "cp2600000000018",
      "cp2600000000019",
    ]);
    const partners = app.findCollectionByNameOrId("partners");

    for (const record of app.findAllRecords(partners)) {
      if (seededIds.has(record.id)) app.delete(record);
    }
  },
);
