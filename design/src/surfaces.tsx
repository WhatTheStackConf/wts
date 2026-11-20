import type { JSX } from "@solidjs/web";

/** The site supporting-page shell: warm paper, ink text, the 1320px content width. */
export function SiteSurface(props: { children: JSX.Element }) {
  return <div class="supporting-shell"><main class="support-main" id="main-content">{props.children}</main></div>;
}

/** The CFP app shell. Staff pages sit on ALT 0 paper, applicant pages under the ALT 3 band. */
export function CfpSurface(props: { staff?: boolean; children: JSX.Element }) {
  return <div class="cfp-app"><main id="main" class="page-main" data-surface={props.staff ? "staff" : "applicant"}>{props.children}</main></div>;
}

/** The blog page body. */
export function BlogSurface(props: { children: JSX.Element }) {
  return <div class="blog-story">{props.children}</div>;
}

/**
 * auth renders full HTML documents on the server. The story shows the body of that document.
 * Scripts do not run, so the password toggle and the phone menu stay static.
 */
export function DocumentBody(props: { html: string }) {
  const body = () => new DOMParser().parseFromString(props.html, "text/html").body.innerHTML;
  return <div class="auth-story" innerHTML={body()} />;
}

/** A labelled specimen row for foundation and control stories. */
export function Specimen(props: { label: string; note?: string; children: JSX.Element }) {
  return <div class="sb-specimen">
    <div class="sb-specimen-label"><strong>{props.label}</strong>{props.note ? <span>{props.note}</span> : null}</div>
    <div class="sb-specimen-body">{props.children}</div>
  </div>;
}

/** A titled specimen page. Every story that is not a whole app page uses it, so all of them start the same way. */
export function SbPage(props: { title: string; note?: string; children: JSX.Element }) {
  return <div class="sb-page">
    <h1>{props.title}</h1>
    {props.note ? <p>{props.note}</p> : null}
    {props.children}
  </div>;
}
