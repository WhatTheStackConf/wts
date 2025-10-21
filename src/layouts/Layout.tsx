import { JSX } from "solid-js";
import { Title, Meta } from "@solidjs/meta";
import { Navbar } from "~/components/Navbar";

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
      <Meta name="description" content={props.description} />
      <main class="font-sans relative">
        <div class="absolute z-20 w-full min-h-screen h-full top-0 left-0 bg-base-300/85"></div>
        <div class="relative z-25">{props.children}</div>
      </main>
    </>
  );
};
