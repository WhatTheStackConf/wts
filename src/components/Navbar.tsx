import Logo from "../assets/images/LogoSolo.svg";
import { createSignal, onMount } from "solid-js";
import Animation from "../assets/animations/WTS.json";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";

const Lottie = clientOnly(() => import("./Lottie"));
const LoginMenu = clientOnly(() => import("./LoginMenu"));
const MultiLineCyberpunkText = clientOnly(
  () => import("./MultiLineCyberpunkText"),
);

export const Navbar = () => {
  const [lottieData] = createSignal(Animation);

  onMount(() => {
    setTimeout(() => {
      sessionStorage.setItem("shouldAnimate", "false");
    }, 4000);
  });

  return (
    <div class="navbar bg-base-200 border-b border-primary-700 shadow-xl relative z-9999">
      <div class="navbar-start flex items-start justify-start">
        <a class="h-16 flex items-center justify-center w-auto" href="/">
          {lottieData() ? (
            <div class="h-16 w-16 mr-3">
              <Lottie
                animationData={lottieData()}
                loop={false}
                autoplay={true}
                // hasNeonGlow={true}
                style={{ width: "100%", height: "100%" }}
                className="text-primary-500"
              />
            </div>
          ) : (
            <Logo class="h-16 mr-3 w-auto" {...({} as any)} />
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
                  trackingYear="tracking-widest md:tracking-[0.7em]"
                />
              </h1>
            </div>
          </div>
        </a>
      </div>
      <div class="navbar-center hidden lg:flex">
        <ul class="menu menu-lg menu-horizontal px-1 font-black uppercase text-primary-200 underline">
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
            {/*<details class="bg-base-200 relative">
              <summary>Previous editions</summary>
              <ul class="p-2 bg-base-200 w-full">
                <li>
                  <a href="https://2024.wts.sh" class="text-center">
                    2024
                  </a>
                </li>
                <li>
                  <a href="https://2025.wts.sh" class="text-center">
                    2025
                  </a>
                </li>
              </ul>
            </details>*/}
          </li>
        </ul>
      </div>
      <div class="navbar-end">
        <LoginMenu
          fallback={<Icon icon="eos-icons:three-dots-loading"></Icon>}
        />
      </div>
    </div>
  );
};
