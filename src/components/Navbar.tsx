import Logo from "../assets/images/LogoSolo.svg";
import { createSignal } from "solid-js";
import { Lottie } from "./Lottie";
import Animation from "../assets/animations/WTS.json";
import { CyberpunkText } from "./CyberpunkText";
import { MultiLineCyberpunkText } from "./MultiLineCyberpunkText";

export const Navbar = () => {
  const [lottieData] = createSignal(Animation);

  // Calculate delay for second line (length of first line * typing speed + some buffer)
  const firstLineLength = "WhatTheStack?".length;
  const typingSpeed = 150;
  const bufferTime = 500; // Extra time before second line starts
  const calculatedDelay = firstLineLength * typingSpeed + bufferTime;

  return (
    <div class="navbar bg-base-200 border-b border-primary-700 shadow-xl relative z-26">
      <div class="navbar-start flex items-start justify-start">
        <a class="h-16 flex items-center justify-center w-auto" href="/">
          {lottieData() ? (
            <div class="h-16 w-16 mr-3">
              <Lottie
                animationData={lottieData()}
                loop={false}
                autoplay={true}
                hasNeonGlow={true}
                style={{ width: "100%", height: "100%" }}
                className="text-primary-500"
              />
            </div>
          ) : (
            <Logo class="h-16 mr-3 w-auto" {...({} as any)} />
          )}
          <div>
            <div class="flex flex-col">
              <h1 class="font-star italic text-2xl leading-tight">
                <MultiLineCyberpunkText
                  firstLineText="WhatTheStack"
                  secondLineText="2026"
                  hasGlow={true}
                  className="inline"
                  delay={0}
                  tracking="tracking-[0.8em]"
                  trackingYear="tracking-[0.7em]"
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
            <details class="bg-base-200">
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
            </details>
          </li>
        </ul>
      </div>
      <div class="navbar-end">
        <a class="btn btn-ghost btn-lg">Log in</a>
      </div>
    </div>
  );
};
