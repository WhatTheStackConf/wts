routerAdd("POST", "/custom/send-email", (c) => {
    const admin = c.get("admin"); // valid admin model or null
    if (!admin) {
        throw new ForbiddenError("Only admins can access this route.");
    }

    const data = $apis.requestInfo(c).data;

    // Validate required fields
    if (!data.to || !data.subject || !data.html) {
        throw new BadRequestError("Missing required fields: to, subject, html");
    }

    const message = new MailerMessage({
        from: {
            address: $app.settings().meta.senderAddress,
            name: $app.settings().meta.senderName,
        },
        to: [{ address: data.to }],
        subject: data.subject,
        html: data.html,
    })

    $app.newMailClient().send(message);

    return c.json(200, { "message": "Email sent successfully" });
})
