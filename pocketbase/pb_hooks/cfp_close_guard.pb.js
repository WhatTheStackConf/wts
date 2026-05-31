/// <reference path="../pb_data/types.d.ts" />

// Block new CFP submissions when the CfP is closed.
// Reads the singleton conference_config record to check cfp_open status.
onRecordCreateRequest((e) => {
    // Admins/superusers can always create (e.g. for imports)
    if (e.hasSuperuserAuth()) {
        return e.next();
    }

    try {
        const configs = e.app.findRecordsByFilter(
            "conference_config",
            "",
            "",
            1,
            0,
        );

        if (configs.length > 0 && configs[0].get("cfp_open") === false) {
            throw new ForbiddenError(
                "The Call for Papers is currently closed. New submissions are not being accepted.",
            );
        }
    } catch (err) {
        if (err instanceof ForbiddenError) {
            throw err;
        }
        // If conference_config doesn't exist yet or other error,
        // allow the request through (fail open for availability)
        e.app.logger().warn("CfP open check skipped", "error", err);
    }

    return e.next();
}, "cfp_submissions");
