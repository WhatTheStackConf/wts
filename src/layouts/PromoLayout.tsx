import { JSX } from "solid-js";
import { Title, Meta } from "@solidjs/meta";
import CodeBackground from "~/components/CodeBackground";

interface PromoLayoutProps {
  children: JSX.Element;
  title?: string;
  description?: string;
}

export const PromoLayout = (props: PromoLayoutProps) => {
  return (
    <>
      <Title>{props.title}</Title>
      <Meta name="description" content={props.description} />
      <Meta property="og:title" content={props.title} />
      <Meta property="og:description" content={props.description} />
      <Meta name="robots" content="index,follow" />
      <main class="font-sans relative w-full min-h-screen flex flex-col items-center overflow-x-hidden bg-dark-950">
        <CodeBackground />
        <div
          class="promo-starfield absolute inset-0 z-10 pointer-events-none"
          aria-hidden="true"
        />
        <div class="absolute z-20 inset-0 bg-black/82" aria-hidden="true" />
        <div class="relative z-30 w-full flex flex-col items-center justify-center flex-grow px-4 py-12 md:py-16">
          {props.children}
        </div>
      </main>
    </>
  );
};
