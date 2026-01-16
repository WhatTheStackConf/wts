import { Icon } from "@iconify-icon/solid";

interface CfpStepIndicatorProps {
    currentStep: number;
}

export const CfpStepIndicator = (props: CfpStepIndicatorProps) => {
    return (
        <div class="mb-10">
            <div class="flex justify-between relative z-10">
                {[1, 2, 3, 4, 5, 6].map((s) => (
                    <div class="flex flex-col items-center group cursor-default">
                        <div
                            class={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all duration-300 ${props.currentStep === s
                                    ? "bg-primary text-white border-primary shadow-[0_0_15px_rgba(var(--color-primary-500),0.4)]"
                                    : s < props.currentStep
                                        ? "bg-success text-white border-success"
                                        : "bg-base-300/50 text-white/30 border-white/10"
                                }`}
                        >
                            {s < props.currentStep ? (
                                <Icon icon="material-symbols:check" />
                            ) : (
                                <span class="font-mono font-bold">{s}</span>
                            )}
                        </div>
                        <div
                            class={`text-[10px] uppercase tracking-wider mt-2 font-mono font-bold transition-colors duration-300 ${props.currentStep === s ? "text-primary text-shadow-glow" : "text-white/30"
                                }`}
                        >
                            {s === 1 && "Intro"}
                            {s === 2 && "Personal"}
                            {s === 3 && "Proposal"}
                            {s === 4 && "Experience"}
                            {s === 5 && "Expenses"}
                            {s === 6 && "Confirm"}
                        </div>
                    </div>
                ))}
            </div>
            {/* Connecting line */}
            <div class="absolute top-5 left-0 w-full h-0.5 bg-white/5 -z-0 translate-y-[28px]">
                <div
                    class="h-full bg-success/50 transition-all duration-500"
                    style={{ width: `${((props.currentStep - 1) / 5) * 100}%` }}
                ></div>
            </div>
        </div>
    );
};
