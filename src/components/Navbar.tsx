import Logo from "../assets/images/LogoSolo.svg";

export const Navbar = () => {
  return (
    <div class="navbar bg-base-200 border-b border-primary-700 shadow-xl relative z-26">
      <div class="navbar-start flex items-start justify-start">
        <a class="h-16 flex items-center justify-center w-auto" href="/">
          <Logo class="h-16 mr-3 w-auto" {...({} as any)} />
          <div>
            <h1 class="font-star italic text-2xl text-secondary-300">
              What<span class="text-primary-500">The</span>Stack?
            </h1>
            <h2 class="text-primary-500 tracking-[0.4em] font-star text-3xl text-center">
              2 0 2 6
            </h2>
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
