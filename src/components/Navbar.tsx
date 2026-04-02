import Logo from "../assets/images/LogoSolo.svg";
import { createSignal, onMount } from "solid-js";
import Animation from "../assets/animations/WTS.json";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { useAuth } from "~/lib/auth-context";

const Lottie = clientOnly(() => import("./Lottie"));
const LoginMenu = clientOnly(() => import("./LoginMenu"));
const MultiLineCyberpunkText = clientOnly(
  () => import("./MultiLineCyberpunkText"),
);

export const Navbar = () => {
  const [lottieData] = createSignal(Animation);
  const auth = useAuth();
  const [mounted, setMounted] = createSignal(false);
  const [isDrawerOpen, setIsDrawerOpen] = createSignal(false);

  onMount(() => {
    setMounted(true);
    setTimeout(() => {
      sessionStorage.setItem("shouldAnimate", "false");
    }, 4000);
  });

  const closeDrawer = () => setIsDrawerOpen(false);

  return (
    <div class="drawer z-[9999]">
      <input
        id="mobile-drawer"
        type="checkbox"
        class="drawer-toggle"
        checked={isDrawerOpen()}
        onChange={(e) => setIsDrawerOpen(e.currentTarget.checked)}
      />

      {/* Drawer Content: The actual Navbar */}
      <div class="drawer-content flex flex-col">
        <div class="navbar bg-base-200 border-b border-primary-700 shadow-xl relative">
          <div class="navbar-start flex items-center justify-start">
            {/* Mobile Hamburger (Drawer Toggle) */}
            <div class="flex-none lg:hidden">
              <label
                for="mobile-drawer"
                aria-label="open sidebar"
                class="btn btn-square btn-ghost"
              >
                <Icon icon="ph:list-bold" class="text-2xl text-primary-500" />
              </label>
            </div>

            <a
              class="h-6 lg:h-16 flex items-center justify-center w-auto ml-2 lg:ml-0"
              href="/"
            >
              {lottieData() ? (
                <div class="h-6 w-6 mr-4 lg:h-16 lg:w-16 lg:mr-3">
                  <Lottie
                    animationData={lottieData()}
                    loop={false}
                    autoplay={true}
                    style={{ width: "100%", height: "100%" }}
                    className="text-primary-500"
                  />
                </div>
              ) : (
                <div class="h-6 w-6 mr-4 lg:h-16 lg:w-16 lg:mr-3 [&>svg]:!w-full [&>svg]:!h-full">
                  <Logo
                    class="w-full h-full text-current"
                    style={{ width: "100%", height: "100%" }}
                    {...({} as any)}
                  />
                </div>
              )}
              <div>
                <div class="flex flex-col">
                  <h1 class="font-star italic text-xs md:text-2xl leading-tight">
                    <MultiLineCyberpunkText
                      firstLineText="WhatTheStack"
                      secondLineText="2026"
                      hasGlow={true}
                      className="inline"
                      delay={0}
                      tracking="tracking-widest md:tracking-[0.8em]"
                      trackingYear="tracking-[0.5em] md:tracking-[0.7em]"
                    />
                  </h1>
                </div>
              </div>
            </a>
          </div>

          {/* Desktop Menu */}
          <div class="navbar-center hidden lg:flex">
            <ul class="menu menu-lg menu-horizontal px-1 font-black uppercase text-primary-200">
              {/* Admin Link */}
              {mounted() && auth?.user?.role === "admin" && (
                <li>
                  <a href="/admin" class="text-red-500 hover:text-red-400">
                    Admin
                  </a>
                </li>
              )}
              {/* Reviewer Link */}
              {mounted() && (auth?.user?.role === "reviewer" || auth?.user?.role === "admin") && (
                <li>
                  <a
                    href="/reviewer"
                    class="text-secondary-500 hover:text-secondary-400"
                  >
                    Reviewer
                  </a>
                </li>
              )}

              <li>
                <a href="/tickets">Grab a ticket!</a>
              </li>

              {/* Conference dropdown */}
              <li>
                <button
                  class="uppercase"
                  popovertarget="nav-conference"
                  style="anchor-name:--anchor-conference"
                >
                  Conference
                </button>
                <ul
                  class="dropdown menu p-2 bg-base-100 shadow-lg w-[200px]"
                  popover
                  id="nav-conference"
                  style="position-anchor:--anchor-conference"
                >
                  <li>
                    <a href="/speakers">{`>`} Speakers</a>
                  </li>
                  <li>
                    <a href="/agenda">{`>`} Agenda</a>
                  </li>
                  <li>
                    <a href="/sessions">{`>`} Sessions</a>
                  </li>
                  <li>
                    <a href="/timeline">{`>`} Timeline</a>
                  </li>
                </ul>
              </li>

              {/* Get Involved dropdown */}
              <li>
                <button
                  class="uppercase"
                  popovertarget="nav-involved"
                  style="anchor-name:--anchor-involved"
                >
                  Get Involved
                </button>
                <ul
                  class="dropdown menu p-2 bg-base-100 shadow-lg w-[220px]"
                  popover
                  id="nav-involved"
                  style="position-anchor:--anchor-involved"
                >
                  <li>
                    <a href="/cfp">{`>`} Apply to speak</a>
                  </li>
                  <li>
                    <a href="/partnerships">{`>`} Partner with us</a>
                  </li>
                </ul>
              </li>

              {/* About dropdown */}
              <li>
                <button
                  class="uppercase"
                  popovertarget="nav-about"
                  style="anchor-name:--anchor-about"
                >
                  About
                </button>
                <ul
                  class="dropdown menu p-2 bg-base-100 shadow-lg w-[240px]"
                  popover
                  id="nav-about"
                  style="position-anchor:--anchor-about"
                >
                  <li>
                    <a href="/about">{`>`} About WTS</a>
                  </li>
                  <li>
                    <a href="/faq">{`>`} FAQ</a>
                  </li>
                  <li>
                    <a href="/convince-your-boss">{`>`} Convince your boss</a>
                  </li>
                  <li class="border-t border-white/10 mt-1 pt-1">
                    <a href="https://2025.wts.sh" target="_blank">
                      {`>`} 2025 Edition
                    </a>
                  </li>
                  <li>
                    <a href="https://2024.wts.sh" target="_blank">
                      {`>`} 2024 Edition
                    </a>
                  </li>
                </ul>
              </li>
            </ul>
          </div>

          <div class="navbar-end flex items-center">
            <LoginMenu
              fallback={<Icon icon="eos-icons:three-dots-loading"></Icon>}
            />
          </div>
        </div>
      </div>

      {/* Drawer Side (Mobile Menu) */}
      <div class="drawer-side z-[10000]">
        <label
          for="mobile-drawer"
          aria-label="close sidebar"
          class="drawer-overlay"
        ></label>
        <div class="menu p-4 w-80 min-h-full bg-base-100/95 backdrop-blur-xl border-r border-white/10 text-primary-200">
          {/* Mobile Menu Content */}
          <div class="mb-8 px-4 pt-4">
            <h2 class="font-star text-2xl text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-white uppercase">
              Menu
            </h2>
          </div>

          <ul class="space-y-2 font-bold uppercase text-lg">
            {mounted() && auth?.user?.role === "admin" && (
              <li>
                <a
                  href="/admin"
                  onClick={closeDrawer}
                  class="text-red-500 hover:bg-red-500/10"
                >
                  Admin Dashboard
                </a>
              </li>
            )}
            {mounted() && (auth?.user?.role === "reviewer" || auth?.user?.role === "admin") && (
              <li>
                <a
                  href="/reviewer"
                  onClick={closeDrawer}
                  class="text-secondary-500 hover:bg-secondary-500/10"
                >
                  Reviewer Portal
                </a>
              </li>
            )}

            <li>
              <a href="/tickets" onClick={closeDrawer}>
                Grab a ticket!
              </a>
            </li>

            {/* Conference */}
            <li>
              <details>
                <summary>Conference</summary>
                <ul>
                  <li>
                    <a href="/speakers" onClick={closeDrawer}>Speakers</a>
                  </li>
                  <li>
                    <a href="/agenda" onClick={closeDrawer}>Agenda</a>
                  </li>
                  <li>
                    <a href="/sessions" onClick={closeDrawer}>Sessions</a>
                  </li>
                  <li>
                    <a href="/timeline" onClick={closeDrawer}>Timeline</a>
                  </li>
                </ul>
              </details>
            </li>

            {/* Get Involved */}
            <li>
              <details>
                <summary>Get Involved</summary>
                <ul>
                  <li>
                    <a href="/cfp" onClick={closeDrawer}>Apply to speak</a>
                  </li>
                  <li>
                    <a href="/partnerships" onClick={closeDrawer}>Partner with us</a>
                  </li>
                </ul>
              </details>
            </li>

            {/* About */}
            <li>
              <details>
                <summary>About</summary>
                <ul>
                  <li>
                    <a href="/about" onClick={closeDrawer}>About WTS</a>
                  </li>
                  <li>
                    <a href="/faq" onClick={closeDrawer}>FAQ</a>
                  </li>
                  <li>
                    <a href="/convince-your-boss" onClick={closeDrawer}>Convince your boss</a>
                  </li>
                  <li class="border-t border-white/10 mt-1 pt-1">
                    <a href="https://2025.wts.sh" target="_blank" onClick={closeDrawer}>
                      2025 Edition
                    </a>
                  </li>
                  <li>
                    <a href="https://2024.wts.sh" target="_blank" onClick={closeDrawer}>
                      2024 Edition
                    </a>
                  </li>
                </ul>
              </details>
            </li>

            {mounted() && auth?.isAuthenticated() && (
              <>
                <div class="divider border-white/10 my-2"></div>
                <li>
                  <a href="/user/profile" onClick={closeDrawer} class="text-primary-300">
                    Profile
                  </a>
                </li>
                <li>
                  <button onClick={() => { auth.logout(); closeDrawer(); window.location.href = "/"; }} class="text-error hover:bg-error/10">
                    Logout
                  </button>
                </li>
              </>
            )}

            {mounted() && !auth?.isAuthenticated() && (
              <li>
                <a href="/login" onClick={closeDrawer} class="text-primary-300">
                  Log in
                </a>
              </li>
            )}
          </ul>

          <div class="mt-auto px-4 py-8 text-xs text-secondary-500/50 font-mono text-center">
            WhatTheStack 2026
          </div>
        </div>
      </div>
    </div>
  );
};
