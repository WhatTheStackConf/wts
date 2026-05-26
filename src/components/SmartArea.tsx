import { For, createMemo, Component } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { getSocialIcon } from "~/lib/social-links";

interface SmartAreaProps {
  value: string[];
  onChange: (links: string[]) => void;
}

export const SmartArea: Component<SmartAreaProps> = (props) => {
  // Memoize the raw text to keep the textarea in sync with external store updates
  const rawText = createMemo(() => props.value.join("\n"));

  const parseLinks = (text: string) => {
    return text
      .split(/[\n,]/)
      .map((link) => link.trim())
      .filter((link) => link !== "");
  };

  const handleInput = (
    e: InputEvent & { currentTarget: HTMLTextAreaElement },
  ) => {
    const links = parseLinks(e.currentTarget.value);
    props.onChange(links);
  };

  return (
    <div class="space-y-3">
      <textarea
        class="textarea textarea-lg textarea-bordered w-full font-mono text-sm leading-relaxed focus:textarea-primary transition-all"
        rows={4}
        placeholder="Paste links here (one per line)...&#10;https://github.com/jdoe&#10;https://bsky.app/profile/jdoe.bsky.social"
        value={rawText()}
        onInput={handleInput}
      ></textarea>

      <div class="flex flex-wrap gap-2">
        <For each={props.value}>
          {(link) => (
            <div class="badge badge-outline h-auto py-2 px-3 gap-2 border-base-300 animate-in fade-in zoom-in duration-200">
              <Icon icon={getSocialIcon(link)} class="text-lg text-primary" />
              <span class="max-w-[180px] truncate text-xs font-medium">
                {link.replace(/^https?:\/\/(www\.)?/, "")}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
