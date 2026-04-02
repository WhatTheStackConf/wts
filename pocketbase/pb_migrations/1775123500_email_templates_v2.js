/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const wrapInTemplate = (title, content) => {
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${title}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1">
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; display: block;}
    body { margin: 0; padding: 0; height: 100% !important; width: 100% !important; background-color: #F0F1F3; font-family: 'Helvetica Neue', 'Segoe UI', Helvetica, sans-serif;}
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F0F1F3;">

  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F0F1F3;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; max-width: 600px; width: 100%; margin: 0 auto; overflow: hidden; border-radius: 5px;">

          <tr>
            <td align="center" bgcolor="#070514" style="padding: 40px 20px;">
              <a href="https://wts.sh" target="_blank">
                <img src="{APP_URL}/emails/International_Dev_Conference_September_19th_2026_Skopje.png" alt="What The Stack 2026" width="500" style="max-width: 100%; height: auto; display: block;" />
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px; font-size: 15px; line-height: 26px; color: #444444;">
              ${content}
            </td>
          </tr>

          <tr>
            <td bgcolor="#070514" style="padding: 30px 40px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left" valign="middle" width="40%">
                    <table border="0" cellpadding="0" cellspacing="0"><tr>
                      <td style="padding-right: 12px;">
                        <a href="https://fb.me/whatthestack" target="_blank" style="text-decoration: none;">
                          <img src="{APP_URL}/emails/Asset_1.png" alt="Facebook" height="20" style="height: 20px; width: auto; display: block;" />
                        </a>
                      </td>
                      <td style="padding-right: 12px;">
                        <a href="https://x.com/what_the_stack" target="_blank" style="text-decoration: none;">
                          <img src="{APP_URL}/emails/Asset_2.png" alt="X" height="20" style="height: 20px; width: auto; display: block;" />
                        </a>
                      </td>
                      <td style="padding-right: 12px;">
                        <a href="https://instagram.com/what_the_stack_conference" target="_blank" style="text-decoration: none;">
                          <img src="{APP_URL}/emails/Asset_6.png" alt="Instagram" height="20" style="height: 20px; width: auto; display: block;" />
                        </a>
                      </td>
                      <td>
                        <a href="https://www.linkedin.com/company/what-the-stack-conference" target="_blank" style="text-decoration: none;">
                          <img src="{APP_URL}/emails/Asset_3.png" alt="LinkedIn" height="20" style="height: 20px; width: auto; display: block;" />
                        </a>
                      </td>
                    </tr></table>
                  </td>
                  <td align="left" valign="middle" width="60%" style="font-size: 11px; line-height: 1.5; color: #ffffff; padding-left: 20px;">
                    <p style="margin: 0;">You received this message because of a previous registration for an event organized by WhatTheStack.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
    };

    // Update all auth collections
    const authCollections = app.findAllCollections("auth");
    for (const collection of authCollections) {
      collection.verificationTemplate = {
        subject: "Verify your email for {APP_NAME}",
        body: wrapInTemplate(
          "Verify your email",
          `<h2 style="margin: 0 0 15px 0; color: #333333;">Verify your email address</h2>
<p>Thank you for signing up for <strong>{APP_NAME}</strong>.</p>
<p>Please click the button below to verify your email address:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{APP_URL}/_/#/auth/confirm-verification/{TOKEN}" target="_blank" style="display: inline-block; padding: 14px 28px; background-color: #070514; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email</a>
</p>
<p style="font-size: 13px; color: #888888;">If you did not create an account, you can safely ignore this email.</p>`
        ),
      };

      collection.resetPasswordTemplate = {
        subject: "Reset your password for {APP_NAME}",
        body: wrapInTemplate(
          "Reset your password",
          `<h2 style="margin: 0 0 15px 0; color: #333333;">Reset your password</h2>
<p>We received a request to reset your password for <strong>{APP_NAME}</strong>.</p>
<p>Click the button below to choose a new password:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{APP_URL}/_/#/auth/confirm-password-reset/{TOKEN}" target="_blank" style="display: inline-block; padding: 14px 28px; background-color: #070514; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
</p>
<p style="font-size: 13px; color: #888888;">If you did not request a password reset, you can safely ignore this email.</p>`
        ),
      };

      collection.confirmEmailChangeTemplate = {
        subject: "Confirm your new email for {APP_NAME}",
        body: wrapInTemplate(
          "Confirm email change",
          `<h2 style="margin: 0 0 15px 0; color: #333333;">Confirm your new email</h2>
<p>You requested to change your email address for <strong>{APP_NAME}</strong>.</p>
<p>Click the button below to confirm your new email:</p>
<p style="text-align: center; margin: 30px 0;">
  <a href="{APP_URL}/_/#/auth/confirm-email-change/{TOKEN}" target="_blank" style="display: inline-block; padding: 14px 28px; background-color: #070514; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Confirm New Email</a>
</p>
<p style="font-size: 13px; color: #888888;">If you did not request this change, you can safely ignore this email.</p>`
        ),
      };

      collection.otp = {
        enabled: collection.otp?.enabled || false,
        duration: collection.otp?.duration || 180,
        length: collection.otp?.length || 8,
        emailTemplate: {
          subject: "Your one-time password for {APP_NAME}",
          body: wrapInTemplate(
            "One-time password",
            `<h2 style="margin: 0 0 15px 0; color: #333333;">Your one-time password</h2>
<p>Your one-time password is: <strong style="font-size: 24px; letter-spacing: 4px;">{OTP}</strong></p>
<p style="font-size: 13px; color: #888888;">If you didn't request this, you can safely ignore this email.</p>`
          ),
        },
      };

      app.save(collection);
    }
  },
  (app) => {
    // Revert to PocketBase defaults
    const authCollections = app.findAllCollections("auth");
    for (const collection of authCollections) {
      collection.verificationTemplate = {
        subject: "Verify your {APP_NAME} email",
        body: `<p>Hello,</p>\n<p>Thank you for joining us at {APP_NAME}.</p>\n<p>Click on the button below to verify your email address.</p>\n<p>\n  <a class="btn" href="{APP_URL}/_/#/auth/confirm-verification/{TOKEN}" target="_blank" rel="noopener">Verify</a>\n</p>\n<p>\n  Thanks,<br/>\n  {APP_NAME} team\n</p>`,
      };

      collection.resetPasswordTemplate = {
        subject: "Reset your {APP_NAME} password",
        body: `<p>Hello,</p>\n<p>Click on the button below to reset your password.</p>\n<p>\n  <a class="btn" href="{APP_URL}/_/#/auth/confirm-password-reset/{TOKEN}" target="_blank" rel="noopener">Reset password</a>\n</p>\n<p><i>If you didn't ask to reset your password, you can ignore this email.</i></p>\n<p>\n  Thanks,<br/>\n  {APP_NAME} team\n</p>`,
      };

      collection.confirmEmailChangeTemplate = {
        subject: "Confirm your {APP_NAME} new email address",
        body: `<p>Hello,</p>\n<p>Click on the button below to confirm your new email address.</p>\n<p>\n  <a class="btn" href="{APP_URL}/_/#/auth/confirm-email-change/{TOKEN}" target="_blank" rel="noopener">Confirm new email</a>\n</p>\n<p><i>If you didn't ask to change your email address, you can ignore this email.</i></p>\n<p>\n  Thanks,<br/>\n  {APP_NAME} team\n</p>`,
      };

      app.save(collection);
    }
  }
);
