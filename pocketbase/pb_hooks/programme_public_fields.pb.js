/// <reference path="../pb_data/types.d.ts" />

// Keep internal CFP provenance available to admins while hiding it from raw public Session API responses.
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

    e.record.hide("cfp_submission");
    return e.next();
}, "sessions");
