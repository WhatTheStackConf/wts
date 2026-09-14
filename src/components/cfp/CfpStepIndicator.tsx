import { For, Show } from "solid-js";
import { Icon } from "~/components/Icon";

interface CfpStepIndicatorProps {
    currentStep: number;
}

export const CfpStepIndicator = (props: CfpStepIndicatorProps) => {
    return (
        <div class="mb-8">
            <p class="text-sm text-secondary-300 mb-3">Step {props.currentStep} of 6</p>
            <ol aria-label="Proposal progress" class="grid grid-cols-3 sm:grid-cols-6 gap-3">
                <For each={["Intro", "Personal", "Proposal", "Experience", "Expenses", "Confirm"]}>
                    {(label, index) => (
                        <li
                            aria-current={props.currentStep === index() + 1 ? "step" : undefined}
                            class={`flex min-w-0 flex-col items-start gap-1 text-xs ${props.currentStep === index() + 1 ? "text-primary font-bold" : "text-secondary-300"}`}
                        >
                            <span class={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border ${props.currentStep === index() + 1 ? "border-primary bg-primary/10" : "border-white/20"}`}>
                                <Show when={index() + 1 < props.currentStep} fallback={index() + 1}>
                                    <Icon icon="material-symbols:check" />
                                    <span class="sr-only">Completed: </span>
                                </Show>
                            </span>
                            {label}
                        </li>
                    )}
                </For>
            </ol>
        </div>
    );
};
