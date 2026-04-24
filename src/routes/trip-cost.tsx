import { Layout } from "../layouts/Layout";
import { createSignal, createMemo, For, Show } from "solid-js";
import { HologramButton } from "../components/HologramButton";

type Option = {
  label: string;
  sublabel?: string;
  price: number;
};

const ticketOptions: Option[] = [
  { label: "Regular", price: 50 },
  { label: "Student", price: 20 },
];

const travelOptions: Option[] = [
  { label: "Balkans (bus)", sublabel: "Belgrade, Sofia, Thessaloniki, Tirana", price: 30 },
  { label: "Europe (budget)", sublabel: "Wizz Air, book early, cabin bag only", price: 100 },
  { label: "Europe (typical)", sublabel: "Wizz Air or similar, with luggage", price: 160 },
  { label: "International", sublabel: "via Istanbul or European hub", price: 550 },
];

const hotelOptions: Option[] = [
  { label: "Hostel / dorm", sublabel: "~€10/night", price: 10 },
  { label: "Budget hotel", sublabel: "~€25/night", price: 25 },
  { label: "Mid-range hotel", sublabel: "~€50/night", price: 50 },
  { label: "Upscale hotel", sublabel: "~€90/night", price: 90 },
  { label: "Airbnb", sublabel: "~€30/night", price: 30 },
  { label: "Staying with friends", price: 0 },
];

const dailySpendOptions: Option[] = [
  { label: "Budget", sublabel: "Street food, bus, local beer", price: 25 },
  { label: "Mid-range", sublabel: "Restaurants, taxi, drinks out", price: 50 },
  { label: "Comfortable", sublabel: "Nice meals, taxis, cocktails", price: 80 },
  { label: "Conference day only", sublabel: "Food & drinks included", price: 0 },
];

export default function TripCost() {
  const [ticketIdx, setTicketIdx] = createSignal(0);
  const [travelIdx, setTravelIdx] = createSignal(1);
  const [hotelIdx, setHotelIdx] = createSignal(1);
  const [dailyIdx, setDailyIdx] = createSignal(0);
  const [nights, setNights] = createSignal(2);
  const [extraDays, setExtraDays] = createSignal(1);
  const [customTravel, setCustomTravel] = createSignal<number | null>(null);
  const [customHotel, setCustomHotel] = createSignal<number | null>(null);
  const [customDaily, setCustomDaily] = createSignal<number | null>(null);
  const [swag, setSwag] = createSignal(false);

  const ticketCost = createMemo(() => ticketOptions[ticketIdx()].price);
  const travelCost = createMemo(
    () => customTravel() ?? travelOptions[travelIdx()].price,
  );
  const hotelCost = createMemo(
    () => (customHotel() ?? hotelOptions[hotelIdx()].price) * nights(),
  );
  const dailyCost = createMemo(
    () => (customDaily() ?? dailySpendOptions[dailyIdx()].price) * extraDays(),
  );
  const swagCost = createMemo(() => swag() ? 20 : 0);
  const totalCost = createMemo(
    () => ticketCost() + travelCost() + hotelCost() + dailyCost() + swagCost(),
  );

  return (
    <Layout
      title="Trip Cost Calculator - WhatTheStack 2026"
      description="Estimate the total cost of attending WhatTheStack 2026 in Skopje"
      ogSubtitle="Trip Cost Calculator"
    >
      <div class="w-full h-full px-4 relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-4 text-center neon-glow fade-in">
            Trip Cost
          </h1>
          <p class="text-center text-secondary-300 mb-12 text-lg fade-in-delay-1 max-w-2xl mx-auto">
            Skopje is one of the most affordable conference destinations in
            Europe. Here's a quick estimate of what your trip might cost.
          </p>

          <div class="grid md:grid-cols-[1fr_300px] gap-8 items-start mb-8">
            {/* Calculator inputs */}
            <div class="space-y-8 fade-in-delay-2">
              {/* Ticket */}
              <section class="bg-base-200/60 backdrop-blur-sm border border-primary-500/20 rounded-lg p-6">
                <h2 class="text-xl font-star font-bold text-secondary-300 mb-4 uppercase tracking-wider">
                  Ticket
                </h2>
                <div class="flex flex-wrap gap-3">
                  <For each={ticketOptions}>
                    {(opt, i) => (
                      <button
                        type="button"
                        class={`btn ${ticketIdx() === i() ? "btn-primary" : "btn-ghost border-primary-500/30"}`}
                        onClick={() => setTicketIdx(i())}
                      >
                        {opt.label} &mdash; &euro;{opt.price}
                      </button>
                    )}
                  </For>
                </div>
                <div class="mt-4">
                  <label class="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm checkbox-primary"
                      checked={swag()}
                      onChange={(e) => setSwag(e.currentTarget.checked)}
                    />
                    <span class="text-sm text-secondary-300">
                      Swag pack &mdash; &euro;20
                    </span>
                  </label>
                </div>
              </section>

              {/* Travel */}
              <section class="bg-base-200/60 backdrop-blur-sm border border-primary-500/20 rounded-lg p-6">
                <h2 class="text-xl font-star font-bold text-secondary-300 mb-1 uppercase tracking-wider">
                  Travel
                </h2>
                <p class="text-xs text-secondary-500 mb-4">Round-trip estimates</p>
                <div class="flex flex-wrap gap-3 mb-4">
                  <For each={travelOptions}>
                    {(opt, i) => (
                      <button
                        type="button"
                        class={`btn btn-sm text-left ${travelIdx() === i() && customTravel() === null ? "btn-primary" : "btn-ghost border-primary-500/30"}`}
                        onClick={() => {
                          setTravelIdx(i());
                          setCustomTravel(null);
                        }}
                      >
                        <span class="flex flex-col items-start">
                          <span>{opt.label} &mdash; &euro;{opt.price}</span>
                          {opt.sublabel && (
                            <span class="text-[10px] opacity-70 font-normal">
                              {opt.sublabel}
                            </span>
                          )}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
                <label class="flex items-center gap-3 text-sm text-secondary-400">
                  <span class="whitespace-nowrap">Custom estimate:</span>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400">
                      &euro;
                    </span>
                    <input
                      type="number"
                      min="0"
                      placeholder="—"
                      class="input input-sm input-bordered w-28 pl-7 bg-base-300/50"
                      value={customTravel() ?? ""}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        setCustomTravel(v ? Number(v) : null);
                      }}
                    />
                  </div>
                </label>
              </section>

              {/* Hotel */}
              <section class="bg-base-200/60 backdrop-blur-sm border border-primary-500/20 rounded-lg p-6">
                <h2 class="text-xl font-star font-bold text-secondary-300 mb-4 uppercase tracking-wider">
                  Accommodation
                </h2>
                <div class="flex items-center gap-3 mb-4">
                  <label class="text-sm text-secondary-400">Nights:</label>
                  <input
                    type="number"
                    min="0"
                    max="7"
                    class="input input-sm input-bordered w-20 bg-base-300/50"
                    value={nights()}
                    onInput={(e) =>
                      setNights(Math.max(0, Number(e.currentTarget.value)))
                    }
                  />
                </div>
                <div class="flex flex-wrap gap-3 mb-4">
                  <For each={hotelOptions}>
                    {(opt, i) => (
                      <button
                        type="button"
                        class={`btn btn-sm ${hotelIdx() === i() && customHotel() === null ? "btn-primary" : "btn-ghost border-primary-500/30"}`}
                        onClick={() => {
                          setHotelIdx(i());
                          setCustomHotel(null);
                        }}
                      >
                        {opt.label}
                        {opt.price > 0 ? ` — €${opt.price}/night` : ""}
                      </button>
                    )}
                  </For>
                </div>
                <label class="flex items-center gap-3 text-sm text-secondary-400">
                  <span class="whitespace-nowrap">Custom per night:</span>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400">
                      &euro;
                    </span>
                    <input
                      type="number"
                      min="0"
                      placeholder="—"
                      class="input input-sm input-bordered w-28 pl-7 bg-base-300/50"
                      value={customHotel() ?? ""}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        setCustomHotel(v ? Number(v) : null);
                      }}
                    />
                  </div>
                </label>
              </section>

              {/* Daily spending */}
              <section class="bg-base-200/60 backdrop-blur-sm border border-primary-500/20 rounded-lg p-6">
                <h2 class="text-xl font-star font-bold text-secondary-300 mb-1 uppercase tracking-wider">
                  Daily Spending
                </h2>
                <p class="text-xs text-secondary-500 mb-4">
                  Food &amp; drinks are included on the conference day
                </p>
                <div class="flex items-center gap-3 mb-4">
                  <label class="text-sm text-secondary-400">
                    Extra days in Skopje:
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="7"
                    class="input input-sm input-bordered w-20 bg-base-300/50"
                    value={extraDays()}
                    onInput={(e) =>
                      setExtraDays(Math.max(0, Number(e.currentTarget.value)))
                    }
                  />
                </div>
                <div class="flex flex-wrap gap-3 mb-4">
                  <For each={dailySpendOptions}>
                    {(opt, i) => (
                      <button
                        type="button"
                        class={`btn btn-sm text-left ${dailyIdx() === i() && customDaily() === null ? "btn-primary" : "btn-ghost border-primary-500/30"}`}
                        onClick={() => {
                          setDailyIdx(i());
                          setCustomDaily(null);
                        }}
                      >
                        <span class="flex flex-col items-start">
                          <span>
                            {opt.label}
                            {opt.price > 0 ? ` — €${opt.price}/day` : ""}
                          </span>
                          {opt.sublabel && (
                            <span class="text-[10px] opacity-70 font-normal">
                              {opt.sublabel}
                            </span>
                          )}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
                <label class="flex items-center gap-3 text-sm text-secondary-400">
                  <span class="whitespace-nowrap">Custom per day:</span>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400">
                      &euro;
                    </span>
                    <input
                      type="number"
                      min="0"
                      placeholder="—"
                      class="input input-sm input-bordered w-28 pl-7 bg-base-300/50"
                      value={customDaily() ?? ""}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        setCustomDaily(v ? Number(v) : null);
                      }}
                    />
                  </div>
                </label>
              </section>
            </div>

            {/* Breakdown sidebar */}
            <div class="fade-in-delay-3 md:sticky md:top-24 md:self-start">
              <div class="bg-base-200/80 backdrop-blur-sm border border-primary-500/30 rounded-lg p-6 grid-scan">
                <h2 class="text-lg font-star font-bold text-secondary-300 mb-6 uppercase tracking-wider">
                  Estimated Breakdown
                </h2>
                <div class="space-y-4 text-sm">
                  <div class="flex justify-between">
                    <span class="text-secondary-400">Ticket</span>
                    <span class="text-primary-100 font-mono">
                      &euro;{ticketCost()}
                    </span>
                  </div>
                  <Show when={swag()}>
                    <div class="flex justify-between">
                      <span class="text-secondary-400">Swag pack</span>
                      <span class="text-primary-100 font-mono">
                        &euro;{swagCost()}
                      </span>
                    </div>
                  </Show>
                  <div class="flex justify-between">
                    <span class="text-secondary-400">Travel (round-trip)</span>
                    <span class="text-primary-100 font-mono">
                      &euro;{travelCost()}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-secondary-400">
                      Accommodation ({nights()} night
                      {nights() !== 1 ? "s" : ""})
                    </span>
                    <span class="text-primary-100 font-mono">
                      &euro;{hotelCost()}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-secondary-400">
                      Daily spending ({extraDays()} day
                      {extraDays() !== 1 ? "s" : ""})
                    </span>
                    <span class="text-primary-100 font-mono">
                      &euro;{dailyCost()}
                    </span>
                  </div>
                  <div class="border-t border-primary-500/30 pt-4 flex justify-between items-end">
                    <span class="text-secondary-300 font-bold">Total</span>
                    <span class="text-2xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300">
                      &euro;{totalCost()}
                    </span>
                  </div>
                </div>

                <p class="text-[11px] text-secondary-500 mt-4 leading-relaxed">
                  Prices are estimates based on typical September rates.
                  Actual costs vary based on booking time and preferences.
                </p>

                <div class="mt-6">
                  <HologramButton
                    href="/tickets"
                    text="Get your tickets"
                    class="w-full py-3 text-lg h-auto"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Reference prices */}
          <div class="mt-16 bg-base-200/60 backdrop-blur-sm border border-primary-500/20 rounded-lg p-6 fade-in-delay-4">
            <h2 class="text-xl font-star font-bold text-secondary-300 mb-4 uppercase tracking-wider">
              Skopje price reference
            </h2>
            <div class="grid sm:grid-cols-2 gap-6 text-sm text-secondary-100/90">
              <div>
                <h3 class="font-bold text-secondary-300 mb-2">Food &amp; Drinks</h3>
                <ul class="space-y-1">
                  <li class="flex justify-between">
                    <span>Burek (street food)</span>
                    <span class="font-mono text-primary-200">&euro;1-2</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Lunch at a local spot</span>
                    <span class="font-mono text-primary-200">&euro;4-7</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Dinner at a nice restaurant</span>
                    <span class="font-mono text-primary-200">&euro;10-20</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Beer (0.5L)</span>
                    <span class="font-mono text-primary-200">&euro;1.50-2.50</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Coffee</span>
                    <span class="font-mono text-primary-200">&euro;1-2</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Cocktail</span>
                    <span class="font-mono text-primary-200">&euro;4-7</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 class="font-bold text-secondary-300 mb-2">Getting Around</h3>
                <ul class="space-y-1">
                  <li class="flex justify-between">
                    <span>City bus</span>
                    <span class="font-mono text-primary-200">&euro;0.50</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Taxi (short ride)</span>
                    <span class="font-mono text-primary-200">&euro;2-4</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Taxi across town</span>
                    <span class="font-mono text-primary-200">&euro;4-7</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Airport to center (taxi)</span>
                    <span class="font-mono text-primary-200">&euro;15-20</span>
                  </li>
                  <li class="flex justify-between">
                    <span>Airport bus</span>
                    <span class="font-mono text-primary-200">&euro;3-5</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Tips section */}
          <div class="mt-8 mb-8 bg-base-200/60 backdrop-blur-sm border border-primary-500/20 rounded-lg p-6 fade-in-delay-4">
            <h2 class="text-xl font-star font-bold text-secondary-300 mb-4 uppercase tracking-wider">
              Ways to spend less
            </h2>
            <ul class="space-y-3 text-secondary-100/90">
              <li class="flex items-start gap-2">
                <span class="text-primary-400 mt-0.5">&rsaquo;</span>
                <span>
                  <strong>Wizz Air</strong> &mdash; The main budget airline
                  serving Skopje with direct flights from London, Berlin, Vienna,
                  Milan, Basel, Paris, and more. Book 6-10 weeks ahead with
                  cabin bag only for the best fares.
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="text-primary-400 mt-0.5">&rsaquo;</span>
                <span>
                  <strong>Fly into a neighbor</strong> &mdash; Thessaloniki
                  (SKG) and Sofia (SOF) have more routes from Ryanair and
                  easyJet. A bus to Skopje is only 4-5 hours and &euro;10-20.
                  Pristina (PRN) is just 1.5 hours away by bus (&euro;5-8).
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="text-primary-400 mt-0.5">&rsaquo;</span>
                <span>
                  <strong>Balkan bus network</strong> &mdash; Direct buses from
                  Belgrade (~6h, &euro;15-25), Sofia (~4.5h, &euro;10-18),
                  Thessaloniki (~4h, &euro;15-22), and Tirana (~5h, &euro;12-20).
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="text-primary-400 mt-0.5">&rsaquo;</span>
                <span>
                  <strong>Share an Airbnb</strong> &mdash; Central apartments go
                  for &euro;25-35/night. Split with a fellow attendee and you're
                  looking at &euro;12-18 each.
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="text-primary-400 mt-0.5">&rsaquo;</span>
                <span>
                  <strong>Student discount</strong> &mdash; Student tickets are
                  just &euro;20 with a valid student ID.
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="text-primary-400 mt-0.5">&rsaquo;</span>
                <span>
                  <strong>Convince your boss</strong> &mdash; We wrote{" "}
                  <a
                    href="/convince-your-boss"
                    class="text-primary-400 hover:text-primary-300 underline"
                  >
                    the email for you
                  </a>
                  . Many companies cover conference costs as professional
                  development.
                </span>
              </li>
              <li class="flex items-start gap-2">
                <span class="text-primary-400 mt-0.5">&rsaquo;</span>
                <span>
                  <strong>Walk it</strong> &mdash; Skopje's city center is
                  compact and very walkable. Most things you'll need are within
                  a 15-minute walk. Taxis are cheap when you need them.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Layout>
  );
}
