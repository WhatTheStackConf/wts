import * as runtime from "solid-jsx";
import { runSync } from "@mdx-js/mdx";
import { Dynamic } from "solid-js/web";
import { createMemo, JSX, splitProps } from "solid-js";

interface MDXProps {
  code: string;
  components?: Record<string, any>;
}

const MdxLink = (props: any) => {
  const [local, others] = splitProps(props, ["href"]);
  const href = local.href || "";
  const isStaticAsset = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|ics)$/i.test(href);
  const isExternal = /^(https?:)?\/\//i.test(href) || href.startsWith("mailto:");

  if (isStaticAsset) {
    return <a href={href} download target="_blank" rel="noopener" {...others} />;
  }
  if (isExternal) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...others} />;
  }
  return <a href={href} {...others} />;
};

export const MDXContent = (props: MDXProps): JSX.Element => {
  const Content = createMemo(() => {
    const mdxModule = runSync(props.code, {
      ...(runtime as any),
      baseUrl: import.meta.url,
    });
    return mdxModule.default || (() => null);
  });

  return (
    <div class="prose prose-invert prose-lg md:prose-2xl max-w-none prose-strong:text-secondary-400 prose-headings:font-star prose-headings:text-secondary-400 prose-a:text-primary-400 prose-a:no-underline hover:prose-a:text-primary-300 prose-img:mx-auto prose-img:rounded-xl prose-img:border-2 prose-img:border-primary-500/40 prose-img:shadow-lg prose-img:shadow-primary-500/10">
      {/* @ts-ignore */}
      <Dynamic component={Content()} components={{ a: MdxLink, ...(props.components || {}) }} />
    </div>
  );
};
