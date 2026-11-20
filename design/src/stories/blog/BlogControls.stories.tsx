import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BlogSurface, Specimen } from "../../surfaces";

// The blog copy of the flight kit: blog/src/styles/controls.css on real blog class names.
// Storybook has no Astro renderer, so the blog shows its global controls with markup from its templates.
const meta = { title: "Blog/Controls", parameters: { app: "blog" } } satisfies Meta;
export default meta;

export const Controls: StoryObj<typeof meta> = {
  render: () => <BlogSurface><div class="sb-page">
    <h1>Blog controls</h1>
    <p>The blog keeps its own class names and copies the kit recipes. Component layouts with scoped Astro styles are not in Storybook.</p>
    <Specimen label="Buttons" note=".button, .button-ghost"><a href="#" class="button">Back to the blog</a><a href="#" class="button button-ghost">All posts</a></Specimen>
    <Specimen label="Tags" note=".tag-chip"><a href="#" class="tag-chip"><span>Community</span></a><a href="#" class="tag-chip"><span>CFP</span></a></Specimen>
    <Specimen label="Pagination" note=".pagination .inline-action"><nav class="pagination" aria-label="Pagination" style={{ margin: "0" }}><a href="#" class="inline-action">First page</a><a href="#" class="inline-action" rel="next">Next page</a></nav></Specimen>
    <Specimen label="Search field" note="search.site-search-landmark > .site-search > .site-search-input, as in Base.astro">
      <search class="site-search-landmark" aria-label="Site search" style={{ width: "18rem" }}>
        <div class="emdash-live-search site-search">
          <input class="emdash-live-search-input site-search-input" type="search" placeholder="Search posts" aria-label="Search posts" autocomplete="off" />
        </div>
        <kbd class="site-search-key" aria-hidden="true">Ctrl K</kbd>
      </search>
    </Specimen>
    <Specimen label="Prose link" note=".prose a"><div class="prose"><p>Read <a href="#">how we pick talks</a> before you submit.</p></div></Specimen>
  </div></BlogSurface>,
};
