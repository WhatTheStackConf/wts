import { createSignal, onMount, Component, Show, createEffect } from "solid-js";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "prosemirror-schema-basic";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
} from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, undo, redo } from "prosemirror-history";
import { DOMSerializer, DOMParser } from "prosemirror-model";
import { Icon } from "@iconify-icon/solid";
import { placeholderPlugin } from "./placeholder";

interface RichEditorProps {
  value: string;
  onInput: (html: string) => void;
  error?: string;
  placeholder?: string;
}

const RichEditor: Component<RichEditorProps> = (props) => {
  let editorRef: HTMLDivElement | undefined;
  const [editorState, setEditorState] = createSignal<EditorState>();
  let view: EditorView;

  onMount(() => {
    if (!editorRef) return;

    const state = EditorState.create({
      schema,
      plugins: [
        history(),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-b": toggleMark(schema.marks.strong), // Mod is Ctrl/Cmd
          "Mod-i": toggleMark(schema.marks.em),
          "Shift-Ctrl-8": wrapIn(schema.nodes.bullet_list),
        }),
        keymap(baseKeymap),
        // Add the plugin here using the placeholder from props
        placeholderPlugin(props.placeholder || ""),
      ],
    });

    createEffect(() => {
      const val = props.value;

      // If the view exists and has no content, but the prop has content (e.g., after reload)
      if (view && val && view.state.doc.content.size <= 2) {
        const element = document.createElement("div");
        element.innerHTML = val;

        const newState = EditorState.create({
          schema,
          doc: DOMParser.fromSchema(schema).parse(element),
          plugins: view.state.plugins,
        });

        view.updateState(newState);
        setEditorState(newState);
      }
    });

    setEditorState(state);

    view = new EditorView(editorRef, {
      state,
      dispatchTransaction(transaction) {
        const newState = view.state.apply(transaction);
        view.updateState(newState);
        setEditorState(newState);

        // Convert to HTML string for the parent store
        const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
          newState.doc.content,
        );
        const div = document.createElement("div");
        div.appendChild(fragment);
        props.onInput(div.innerHTML === "<p></p>" ? "" : div.innerHTML);
      },
    });
  });

  const runCommand = (cmd: any) => {
    if (!view) return;
    view.focus();
    cmd(view.state, view.dispatch);
  };

  const isMarkActive = (type: any) => {
    const state = editorState();
    if (!state) return false;
    const { from, $from, to, empty } = state.selection;
    if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
    return state.doc.rangeHasMark(from, to, type);
  };

  return (
    <div class="form-control w-full">
      <div class="group flex flex-col textarea textarea-bordered textarea-lg w-full p-0">
        {/* Simplified Headless Menu */}
        <div class="flex items-center gap-1 bg-base-200/40 p-1.5 rounded-t-lg border-x border-t border-base-300">
          <button
            type="button"
            onClick={() => runCommand(toggleMark(schema.marks.strong))}
            class={`btn btn-sm btn-ghost ${isMarkActive(schema.marks.strong) ? "bg-base-300" : ""}`}
          >
            <Icon icon="material-symbols:format-bold" class="text-xl" />
          </button>

          <button
            type="button"
            onClick={() => runCommand(toggleMark(schema.marks.em))}
            class={`btn btn-sm btn-ghost ${isMarkActive(schema.marks.em) ? "bg-base-300" : ""}`}
          >
            <Icon icon="material-symbols:format-italic" class="text-xl" />
          </button>

          <div class="divider divider-horizontal mx-1 w-px h-6 opacity-20"></div>

          <button
            type="button"
            onClick={() => runCommand(setBlockType(schema.nodes.bullet_list))}
            class="btn btn-sm btn-ghost"
          >
            <Icon
              icon="material-symbols:format-list-bulleted"
              class="text-xl"
            />
          </button>
        </div>

        {/* ProseMirror Surface - styled to match your 'Title' input exactly */}
        <div
          ref={editorRef}
          class={`w-full h-full py-3 px-3 bg-base-100 min-h-[200px] focus-within:textarea-primary focus-within:outline-none transition-all ${
            props.error ? "textarea-error" : "border-base-300"
          }`}
        />
      </div>

      <Show when={props.error}>
        <p class="text-error text-xs mt-1">{props.error}</p>
      </Show>
    </div>
  );
};

export default RichEditor;
