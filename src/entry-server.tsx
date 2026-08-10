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
          <link rel="icon" href="/favicon.svg" />
          {assets}
          <script
            defer
            src="https://umami.foundry.mk/script.js"
            data-website-id="7eac874e-f8d2-4d48-8b71-aa34d1b2cd78"
          ></script>
          <script>
            {`window.addEventListener('load',function(){!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.fetchPriority='low';
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2475235909644118');
fbq('track', 'PageView')},{once:true});`}
          </script>
        </head>
        <body>
          <noscript>
            <img
              height="1"
              width="1"
              style="display:none"
              src="https://www.facebook.com/tr?id=2475235909644118&ev=PageView&noscript=1"
              alt=""
            />
          </noscript>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
