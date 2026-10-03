/// <reference types="vite/client" />

declare module "*.svg";

declare module "*.md?content" {
  const page: { title: string; slug?: string; content: string };
  export default page;
}

declare module "*.mdx?content" {
  const page: { title: string; slug?: string; content: string };
  export default page;
}
