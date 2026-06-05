import { createSignal, For } from "solid-js";

type SliderTone = "accent" | "primary";

interface TouchSafeSliderProps {
    min: number;
    max: number;
    step?: number;
    value: number;
    label: string;
    rangeClass: string;
    labelClass?: string;
    tone?: SliderTone;
    disabled?: boolean;
    onChange: (value: number) => void;
}

type GestureState = {
    pointerId: number;
    startX: number;
    startY: number;
    mode: "pending" | "dragging" | "scrolling";
};

const GESTURE_THRESHOLD = 8;

export function TouchSafeSlider(props: TouchSafeSliderProps) {
    const [gesture, setGesture] = createSignal<GestureState | null>(null);

    const step = () => props.step ?? 1;
    const range = () => props.max - props.min;
    const normalizedValue = (value: number) => {
        const clamped = Math.min(props.max, Math.max(props.min, value));
        const snapped = Math.round((clamped - props.min) / step()) * step() + props.min;
        return Math.min(props.max, Math.max(props.min, snapped));
    };
    const progress = () => {
        if (range() === 0) return 0;
        return ((normalizedValue(props.value) - props.min) / range()) * 100;
    };
    const values = () => {
        const count = Math.floor(range() / step()) + 1;
        return Array.from({ length: count }, (_, index) => props.min + index * step());
    };
    const tone = () => props.tone ?? "accent";
    const fillClass = () => (tone() === "primary" ? "bg-primary" : "bg-accent");
    const thumbClass = () =>
        tone() === "primary"
            ? "border-primary bg-primary shadow-primary-500/40"
            : "border-accent bg-accent shadow-accent-500/40";

    const valueFromPointer = (element: HTMLElement, clientX: number) => {
        const rect = element.getBoundingClientRect();
        const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
        return normalizedValue(props.min + Math.min(1, Math.max(0, ratio)) * range());
    };

    const commitFromPointer = (element: HTMLElement, clientX: number) => {
        props.onChange(valueFromPointer(element, clientX));
    };

    const handlePointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
        if (props.disabled) return;

        setGesture({
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            mode: "pending",
        });
    };

    const handlePointerMove = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
        const currentGesture = gesture();
        if (!currentGesture || currentGesture.pointerId !== event.pointerId || props.disabled) return;

        const deltaX = event.clientX - currentGesture.startX;
        const deltaY = event.clientY - currentGesture.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (currentGesture.mode === "scrolling") return;

        if (currentGesture.mode === "pending") {
            if (absY >= GESTURE_THRESHOLD && absY > absX) {
                setGesture({ ...currentGesture, mode: "scrolling" });
                return;
            }

            if (absX < GESTURE_THRESHOLD || absX <= absY) return;

            event.currentTarget.setPointerCapture(event.pointerId);
            setGesture({ ...currentGesture, mode: "dragging" });
        }

        commitFromPointer(event.currentTarget, event.clientX);
    };

    const handlePointerUp = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
        const currentGesture = gesture();
        if (!currentGesture || currentGesture.pointerId !== event.pointerId || props.disabled) return;

        if (currentGesture.mode !== "scrolling") {
            commitFromPointer(event.currentTarget, event.clientX);
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setGesture(null);
    };

    const handlePointerCancel = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setGesture(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (props.disabled) return;

        let nextValue: number | null = null;
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            nextValue = props.value + step();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            nextValue = props.value - step();
        } else if (event.key === "Home") {
            nextValue = props.min;
        } else if (event.key === "End") {
            nextValue = props.max;
        }

        if (nextValue === null) return;

        event.preventDefault();
        props.onChange(normalizedValue(nextValue));
    };

    return (
        <>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={step()}
                value={normalizedValue(props.value)}
                class={`${props.rangeClass} [@media(any-pointer:coarse)]:hidden`}
                aria-label={props.label}
                disabled={props.disabled}
                onInput={(event) => props.onChange(Number(event.currentTarget.value))}
            />

            <div class={`hidden [@media(any-pointer:coarse)]:block ${props.disabled ? "opacity-50" : ""}`}>
                <div
                    role="slider"
                    tabIndex={props.disabled ? -1 : 0}
                    aria-label={props.label}
                    aria-valuemin={props.min}
                    aria-valuemax={props.max}
                    aria-valuenow={normalizedValue(props.value)}
                    aria-disabled={props.disabled ? "true" : undefined}
                    class="relative h-10 cursor-pointer select-none"
                    style={{ "touch-action": "pan-y" }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onKeyDown={handleKeyDown}
                >
                    <div class="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-white/10" />
                    <div
                        class={`absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full ${fillClass()}`}
                        style={{ width: `${progress()}%` }}
                    />
                    <div
                        class={`absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg ${thumbClass()}`}
                        style={{ left: `${progress()}%` }}
                    />
                </div>
            </div>

            <div class={`flex justify-between ${props.labelClass ?? "text-xs px-1 mt-1 opacity-30 font-mono"}`}>
                <For each={values()}>{(value) => <span>{value}</span>}</For>
            </div>
        </>
    );
}
