import * as runtime from "solid-jsx";
import { runSync } from "@mdx-js/mdx";
import { Dynamic } from "solid-js/web";
import { createMemo, JSX } from "solid-js";

interface MDXProps {
  code: string;
  components?: Record<string, any>;
}

export const MDXContent = (props: MDXProps): JSX.Element => {
  const Content = createMemo(() => {
    const mdxModule = runSync(props.code, {
      ...(runtime as any),
      baseUrl: import.meta.url,
    });
    return mdxModule.default || (() => null);
  });

  return (
    <div class="prose prose-invert prose-lg md:prose-2xl max-w-none prose-strong:text-secondary-400 prose-headings:font-star prose-headings:text-secondary-400 prose-a:text-primary-400 prose-a:no-underline hover:prose-a:text-primary-300">
      {/* @ts-ignore */}
      <Dynamic component={Content()} />
    </div>
  );
};
