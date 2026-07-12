/// <reference path="../pb_data/types.d.ts" />

// Keep internal CFP provenance and legacy schedule migration data available to
// admins while hiding them from raw public Session API responses.
onRecordEnrich((e) => {
    const requestInfo = e.requestInfo;
    if (!requestInfo) {
        return e.next();
    }

    if (requestInfo.hasSuperuserAuth()) {
        return e.next();
    }

    const auth = requestInfo.auth;
    if (auth && auth.get("role") === "admin") {
        return e.next();
    }

    e.record.hide("cfp_submission", "starts_at", "track", "room");
    return e.next();
}, "sessions");
