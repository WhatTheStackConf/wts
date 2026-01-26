// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";
import "dotenv/config";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en" data-theme="night">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
          {assets}
          <script
            defer
            src="https://umami.foundry.mk/script.js"
            data-website-id="7eac874e-f8d2-4d48-8b71-aa34d1b2cd78"
          ></script>
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
