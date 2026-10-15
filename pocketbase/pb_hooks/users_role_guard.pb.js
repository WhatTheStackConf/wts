/// <reference path="../pb_data/types.d.ts" />

// Belt-and-suspenders: strip role changes from non-admin client updates (issue #1).
onRecordCreateRequest((e) => {
    if (!e.hasSuperuserAuth()) {
        e.record.set("role", "user");
    }
    return e.next();
}, "users");

onRecordAuthWithOAuth2Request((e) => {
    if (e.isNewRecord) {
        // OAuth clients may omit createData entirely. Initialize the map before
        // assigning the server-controlled role; never trust a submitted role.
        e.createData = Object.assign({}, e.createData || {}, { role: "user" });
    }
    return e.next();
}, "users");

onRecordUpdateRequest((e) => {
    if (e.hasSuperuserAuth()) {
        return e.next();
    }

    const auth = e.auth;
    if (!auth) {
        return e.next();
    }

    if (auth.get("role") === "admin") {
        return e.next();
    }

    const original = e.record.original();
    if (original) {
        e.record.set("role", original.get("role"));
    }

    return e.next();
}, "users");
