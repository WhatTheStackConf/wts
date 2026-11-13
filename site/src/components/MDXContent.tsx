import { runSync } from "@mdx-js/mdx";
import { createComponent, Dynamic, type JSX } from "@solidjs/web";
import { createMemo, omit } from "solid-js";
import {
  conferenceGuideContent,
  conferenceLocation,
  conferenceLongDate,
  conferenceTicketPrice,
} from "~/lib/conference-guide-content";

interface MDXProps {
  code: string;
  components?: Record<string, any>;
}

const MdxLink = (props: any) => {
  const others = omit(props, "href");
  const href = props.href || "";
  const isStaticAsset = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|ics)$/i.test(href);
  const isExternal = /^(https?:)?\/\//i.test(href) || href.startsWith("mailto:");

  if (isStaticAsset) {
    return <a href={href} download="" target="_blank" rel="noopener" {...others} />;
  }
  if (isExternal) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...others} />;
  }
  return <a href={href} {...others} />;
};

const conferenceComponents = {
  ConferenceDate: () => conferenceLongDate,
  ConferenceLocation: () => conferenceLocation,
  RegularTicketPrice: () => conferenceTicketPrice("regular"),
  StudentTicketPrice: () => conferenceTicketPrice("student"),
  GeneralContactEmail: () => (
    <a href={`mailto:${conferenceGuideContent.contact.generalEmail}`}>
      {conferenceGuideContent.contact.generalEmail}
    </a>
  ),
};

type MdxComponent = (props: Record<string, any>) => JSX.Element;

const mdxJsx = (component: string | MdxComponent, props?: Record<string, any>) => {
  const resolvedProps = props ?? {};
  return typeof component === "string"
    ? createComponent(Dynamic, { ...resolvedProps, component })
    : createComponent(component, resolvedProps);
};

const mdxRuntime = {
  Fragment: (props: { children?: JSX.Element }) => props.children,
  jsx: mdxJsx,
  jsxs: mdxJsx,
};

// Colors come from the shell's --tw-prose-* tokens. Headings stay Space Grotesk; the band carries the display title.
const proseArticleClasses =
  "prose prose-lg md:prose-2xl max-w-none prose-headings:font-[family-name:var(--font-orbit-body)] prose-img:mx-auto prose-img:rounded-none prose-img:border prose-img:border-[var(--color-orbit-hair-strong)]";

export const MDXContent = (props: MDXProps): JSX.Element => {
  const Content = createMemo(() => {
    const mdxModule = runSync(props.code, {
      ...mdxRuntime,
      baseUrl: import.meta.url,
    });
    return mdxModule.default || (() => null);
  });

  return (
    <div class={proseArticleClasses}>
      {/* @ts-ignore */}
      <Dynamic
        component={Content()}
        components={{ a: MdxLink, ...conferenceComponents, ...(props.components || {}) }}
      />
    </div>
  );
};
