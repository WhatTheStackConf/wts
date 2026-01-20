import { Icon } from "@iconify-icon/solid";

export const Footer = () => {
  return (
    <footer class="footer p-10 bg-base-200 text-base-content border-t border-primary-700/30 relative overflow-hidden">
      {/* Background Decor */}
      <div class="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none"></div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10 max-w-6xl mx-auto w-full">
        {/* Socials */}
        <nav class="flex flex-col gap-4">
          <header class="footer-title text-primary-400 opacity-100 font-star tracking-widest text-lg">
            Social
          </header>
          <div class="grid grid-flow-col gap-4">
            <a
              href="https://x.com/what_the_stack"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-hover text-2xl hover:text-primary-400 transition-colors"
            >
              <Icon icon="mdi:twitter" />
            </a>
            <a
              href="https://fb.me/whatthestack"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-hover text-2xl hover:text-primary-400 transition-colors"
            >
              <Icon icon="mdi:facebook" />
            </a>
            <a
              href="https://instagram.com/what_the_stack_conference"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-hover text-2xl hover:text-primary-400 transition-colors"
            >
              <Icon icon="mdi:instagram" />
            </a>
            <a
              href="https://www.linkedin.com/company/what-the-stack-conference"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-hover text-2xl hover:text-primary-400 transition-colors"
            >
              <Icon icon="mdi:linkedin" />
            </a>
            <a
              href="https://bsky.app/profile/wts.rocks"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-hover text-2xl hover:text-primary-400 transition-colors"
            >
              <Icon icon="simple-icons:bluesky" />
            </a>
            <a
              href="https://www.youtube.com/@WhatTheStackConference"
              target="_blank"
              rel="noopener noreferrer"
              class="link link-hover text-2xl hover:text-primary-400 transition-colors"
            >
              <Icon icon="mdi:youtube" />
            </a>
          </div>
          {/*<p class="text-sm text-base-content/60 mt-2">
                        Follow us for the latest updates.
                    </p>*/}
        </nav>

        {/* Organizers */}
        <nav class="flex flex-col gap-2">
          <header class="footer-title text-primary-400 opacity-100 font-star tracking-widest text-lg">
            Organizers
          </header>
          <a
            href="https://deved.mk"
            target="_blank"
            class="link link-hover hover:text-primary-400 transition-colors"
          >
            DeveD
          </a>
          <a
            href="https://42.mk"
            target="_blank"
            class="link link-hover hover:text-primary-400 transition-colors"
          >
            Base42
          </a>
          <a
            href="https://angularmacedonia.org"
            target="_blank"
            class="link link-hover hover:text-primary-400 transition-colors"
          >
            Angular Macedonia
          </a>
        </nav>

        {/* Legal */}
        <nav class="flex flex-col gap-2">
          <header class="footer-title text-primary-400 opacity-100 font-star tracking-widest text-lg">
            Legal
          </header>
          <a
            href="/terms"
            class="link link-hover hover:text-primary-400 transition-colors"
          >
            Terms of Service
          </a>
          <a
            href="/privacy"
            class="link link-hover hover:text-primary-400 transition-colors"
          >
            Privacy Policy
          </a>
          <a
            href="/code-of-conduct"
            class="link link-hover hover:text-primary-400 transition-colors"
          >
            Code of Conduct
          </a>
        </nav>
      </div>

      <div class="w-full text-center mt-10 relative z-10 border-t border-white/5 pt-8">
        <p class="text-xs text-base-content/40 font-mono">
          © 2026 WhatTheStack?. CC | BY-NC-SA | CodePub LLC
        </p>
      </div>
    </footer>
  );
};
