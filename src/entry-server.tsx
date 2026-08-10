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
          <link
            rel="preload"
            href="/fonts/space-grotesk-latin.woff2"
            as="font"
            type="font/woff2"
            crossorigin="anonymous"
          />
          <link
            rel="preload"
            href="/fonts/starzoom-shavian.regular.woff2"
            as="font"
            type="font/woff2"
            crossorigin="anonymous"
          />
          {assets}
          <script>
            {`window.addEventListener('load',function(){var started=false,timer;
function start(){if(started)return;started=true;clearTimeout(timer);['pointerdown','keydown','scroll'].forEach(function(event){window.removeEventListener(event,start)});var run=function(){var s=document.createElement('script');s.async=true;s.fetchPriority='low';s.src='https://umami.foundry.mk/script.js';s.dataset.websiteId='7eac874e-f8d2-4d48-8b71-aa34d1b2cd78';document.head.appendChild(s);
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.fetchPriority='low';
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2475235909644118');
fbq('track', 'PageView')};if('requestIdleCallback'in window){window.requestIdleCallback(run,{timeout:5000})}else{setTimeout(run,0)}}
['pointerdown','keydown','scroll'].forEach(function(event){window.addEventListener(event,start,{once:true,passive:true})});timer=setTimeout(start,30000)},{once:true});`}
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
