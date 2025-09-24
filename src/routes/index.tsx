import { Layout } from "../layouts/Layout";

export default function Home() {
  return (
    <Layout title="WTS" description="Welcome to WTS">
      <h1 class="text-2xl font-bold">Hello world!</h1>
      <p>
        Visit{" "}
        <a href="https://start.solidjs.com" target="_blank">
          start.solidjs.com
        </a>{" "}
        to learn how to build SolidStart apps.
      </p>
    </Layout>
  );
}
