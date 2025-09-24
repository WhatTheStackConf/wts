import { Layout } from "../layouts/Layout";

export default function Home() {
  return (
    <Layout title="WTS" description="Welcome to WTS">
      <h1 class="text-2xl font-bold font-star">Hello world!</h1>
      <p class="font-sans">
        Visit{" "}
        <a href="https://start.solidjs.com" target="_blank">
          start.solidjs.com
        </a>{" "}
        to learn how to build SolidStart apps.
      </p>
    </Layout>
  );
}
