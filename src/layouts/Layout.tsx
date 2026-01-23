import { JSX } from "solid-js";
import { Title, Meta, Link } from "@solidjs/meta";
import { Navbar } from "~/components/Navbar";
import CodeBackground from "../components/CodeBackground";
import { Footer } from "~/components/Footer";
import { clientOnly } from "@solidjs/start";

const NewsletterPopup = clientOnly(() => import("~/components/NewsletterPopup"));

interface LayoutProps {
  children: JSX.Element;
  title?: string;
  description?: string;
}

export const Layout = (props: LayoutProps) => {
  return (
    <>
      <Navbar />
      <Title>{props.title}</Title>
      <Link rel="icon" href="/favicon.svg" />
      <Meta name="description" content={props.description} />
      <main class="font-sans relative w-full min-h-screen flex flex-col items-center overflow-x-hidden">
        <CodeBackground />
        <div class="absolute z-24 w-full min-h-screen h-full top-0 left-0 bg-black opacity-[76%]"></div>

        <div
          class="fixed inset-0 z-23 pointer-events-none opacity-70 bg-brand-dark/20
                            [background-image:radial-gradient(circle_at_20%_30%,var(--color-dark-800)_0%,transparent_50%),radial-gradient(circle_at_80%_70%,var(--color-primary-950)_0%,transparent_50%)]"
        />

        {/* Layer 3: Content */}
        <div class="relative z-225 w-full md:max-w-[80%] flex flex-col items-center justify-center flex-grow py-20">
          {props.children}
        </div>
        <div class="w-full relative z-225">
          <Footer />
        </div>
        <NewsletterPopup />
      </main>
    </>
  );
};
