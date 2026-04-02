/// <reference path="../pb_data/types.d.ts" />

/**
 * Wraps HTML content in the WTS branded email template.
 * Usage: const html = wtsEmailTemplate(app, "Email Title", "<p>Your content here</p>")
 */
function wtsEmailTemplate(app, title, content) {
  const appUrl = app.settings().meta.appURL;

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
                <img src="${appUrl}/emails/International_Dev_Conference_September_19th_2026_Skopje.png" alt="What The Stack 2026" width="500" style="max-width: 100%; height: auto; display: block;" />
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
                          <img src="${appUrl}/emails/Asset_1.png" alt="Facebook" height="20" style="height: 20px; width: auto; display: block;" />
                        </a>
                      </td>
                      <td style="padding-right: 12px;">
                        <a href="https://x.com/what_the_stack" target="_blank" style="text-decoration: none;">
                          <img src="${appUrl}/emails/Asset_2.png" alt="X" height="20" style="height: 20px; width: auto; display: block;" />
                        </a>
                      </td>
                      <td style="padding-right: 12px;">
                        <a href="https://instagram.com/what_the_stack_conference" target="_blank" style="text-decoration: none;">
                          <img src="${appUrl}/emails/Asset_6.png" alt="Instagram" height="20" style="height: 20px; width: auto; display: block;" />
                        </a>
                      </td>
                      <td>
                        <a href="https://www.linkedin.com/company/what-the-stack-conference" target="_blank" style="text-decoration: none;">
                          <img src="${appUrl}/emails/Asset_3.png" alt="LinkedIn" height="20" style="height: 20px; width: auto; display: block;" />
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
}
