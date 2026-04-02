/// <reference path="../pb_data/types.d.ts" />

onRecordAfterCreateSuccess((e) => {
    const submission = e.record;

    try {
        // Fetch applicant to get the user ID
        // Note: findRecordById throws an error if not found, which is fine here as we want to abort/log error
        const applicantId = submission.get("applicant");
        const applicant = e.app.findRecordById("cfp_applicants", applicantId);

        // Fetch user to get name and email
        const userId = applicant.get("user");
        const user = e.app.findRecordById("users", userId);

        const email = user.email();
        const name = user.get("name");
        const title = submission.get("session_title");

        const content = `
            <h2 style="margin: 0 0 15px 0; color: #333333;">Thank you for your submission!</h2>
            <p>Hi ${name},</p>
            <p>We have received your proposal: <strong>${title}</strong>.</p>
            <p>Our team will review it and get back to you soon.</p>
            <br>
            <p>Best regards,</p>
            <p>The WhatTheStack Team</p>
        `;
        const html = wtsEmailTemplate(e.app, "CfP Submission Received", content);

        const message = new MailerMessage({
            from: {
                address: e.app.settings().meta.senderAddress,
                name: e.app.settings().meta.senderName,
            },
            to: [{ address: email }],
            subject: "CfP Submission Received: " + title,
            html: html,
        })

        e.app.newMailClient().send(message);

    } catch (err) {
        // Don't fail the request if email fails, just log it
        e.app.logger().error("Failed to send CfP confirmation email", err);
    }

    e.next();

}, "cfp_submissions")
