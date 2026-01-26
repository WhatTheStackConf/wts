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
              {mounted() && auth?.user?.role === "reviewer" && (
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
              <li>
                <a href="/about">About</a>
              </li>
              <li>
                <button
                  class="uppercase"
                  popovertarget="previous-editions"
                  style="anchor-name:--anchor-1"
                >
                  Previous editions
                </button>
                <ul
                  class="dropdown menu p-2 bg-base-100 shadow-lg w-[200px]"
                  popover
                  id="previous-editions"
                  style="position-anchor:--anchor-1"
                >
                  <li>
                    <a
                      href="https://2024.wts.sh"
                      class="text-center"
                      target="_blank"
                    >
                      {`>`} 2024
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://2025.wts.sh"
                      class="text-center"
                      target="_blank"
                    >
                      {`>`} 2025
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
            {mounted() && auth?.user?.role === "reviewer" && (
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
            <li>
              <a href="/about" onClick={closeDrawer}>
                About
              </a>
            </li>

            <li>
              <details open>
                <summary>Previous Editions</summary>
                <ul>
                  <li>
                    <a
                      href="https://2024.wts.sh"
                      target="_blank"
                      onClick={closeDrawer}
                    >
                      2024 Edition
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://2025.wts.sh"
                      target="_blank"
                      onClick={closeDrawer}
                    >
                      2025 Edition
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
