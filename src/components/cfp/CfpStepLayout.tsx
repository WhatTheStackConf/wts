import { Layout } from "~/layouts/Layout";
import { CfpStepIndicator } from "./CfpStepIndicator";
import type { JSX } from "@solidjs/web";

interface CfpStepLayoutProps {
  title: string;
  description: string;
  step: number;
  children: JSX.Element;
}

export const CfpStepLayout = (props: CfpStepLayoutProps) => {
  return (
    <Layout title={props.title} description={props.description}>
      <div class="container mx-auto px-4 py-8">
        <div class="max-w-4xl mx-auto">
          <div class="glass-panel p-4 sm:p-8 md:p-12 rounded-2xl border border-white/10">
            <CfpStepIndicator currentStep={props.step} />

            <h1 class="text-2xl sm:text-3xl font-bold text-white mb-6 break-words">
              {props.title}
            </h1>

            {props.children}
          </div>
        </div>
      </div>
    </Layout>
  );
};
