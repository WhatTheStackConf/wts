import { Layout } from "~/layouts/Layout";
import { CfpStepIndicator } from "./CfpStepIndicator";
import { JSX } from "solid-js";

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
                    {/* Main Card */}
                    <div class="glass-panel p-8 md:p-12 rounded-2xl border border-white/10 relative overflow-hidden">
                        {/* Decorative Elements */}
                        <div class="absolute top-0 right-0 p-8 opacity-5 font-mono text-xs text-right hidden md:block select-none pointer-events-none">
                            <p>SYS.INIT_SEQUENCE</p>
                            <p>PROTOCOL: CFP_2026</p>
                        </div>

                        <h1 class="text-4xl font-bold font-star text-center mb-10 pt-4 text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 tracking-wide">
                            WHAT THE STACK 2026
                        </h1>

                        <CfpStepIndicator currentStep={props.step} />

                        {props.children}
                    </div>
                </div>
            </div>
        </Layout>
    );
};
