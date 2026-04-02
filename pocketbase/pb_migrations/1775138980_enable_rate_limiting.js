/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const settings = app.settings();
    settings.rateLimits.enabled = true;
    settings.rateLimits.rules = [
      { label: "*:auth", audience: "", duration: 10, maxRequests: 5 },
      { label: "*:create", audience: "", duration: 5, maxRequests: 20 },
      { label: "/api/batch", audience: "", duration: 1, maxRequests: 3 },
      { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
      { label: "/custom/send-email", audience: "", duration: 60, maxRequests: 5 },
    ];
    app.save(settings);
  },
  (app) => {
    const settings = app.settings();
    settings.rateLimits.enabled = false;
    app.save(settings);
  }
);
