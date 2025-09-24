import { JSX } from "solid-js";
import { Title, Meta } from "@solidjs/meta";

interface LayoutProps {
  children: JSX.Element;
  title?: string;
  description?: string;
}

export const Layout = (props: LayoutProps) => {
  return (
    <>
      <Title>{props.title}</Title>
      <Meta name="description" content={props.description} />
      <main>{props.children}</main>
    </>
  );
};
