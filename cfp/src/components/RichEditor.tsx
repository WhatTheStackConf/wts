import { createSignal, onCleanup, onSettled } from "solid-js";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, redo, undo } from "prosemirror-history";
import { liftListItem, wrapInList } from "prosemirror-schema-list";
import { DOMParser, DOMSerializer, Schema, type MarkType, type ResolvedPos } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    blockquote: { group: "block", content: "block+", defining: true, parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] },
    bullet_list: { group: "block", content: "list_item+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] },
    ordered_list: { group: "block", content: "list_item+", attrs: { order: { default: 1 } }, parseDOM: [{ tag: "ol", getAttrs: (dom) => ({ order: (dom as HTMLOListElement).hasAttribute("start") ? Number((dom as HTMLOListElement).getAttribute("start")) : 1 }) }], toDOM: (node) => node.attrs.order === 1 ? ["ol", 0] : ["ol", { start: node.attrs.order }, 0] },
    list_item: { content: "paragraph block*", defining: true, parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] },
    hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
    text: { group: "inline" },
  },
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    code: { code: true, parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    link: { attrs: { href: {}, title: { default: null } }, inclusive: false, parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: (dom as HTMLAnchorElement).getAttribute("href"), title: (dom as HTMLAnchorElement).getAttribute("title") }) }], toDOM: (node) => ["a", { href: node.attrs.href, title: node.attrs.title, rel: "nofollow noopener noreferrer" }, 0] },
  },
});

type RichEditorProps = { label: string; name: string; value: string; onInput: (html: string) => void; descriptionId?: string; required?: boolean };

export function RichEditor(props: RichEditorProps) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const [bold, setBold] = createSignal(false);
  const [italic, setItalic] = createSignal(false);
  const [list, setList] = createSignal(false);
  const selectionInList = (position: ResolvedPos) => {
    for (let depth = position.depth; depth > 0; depth -= 1) {
      const node = position.node(depth);
      if (node.type === schema.nodes.bullet_list || node.type === schema.nodes.ordered_list) return true;
    }
    return false;
  };

  const stateFromHtml = (html: string) => {
    const container = document.createElement("div");
    container.innerHTML = html;
    return EditorState.create({
      schema,
      doc: DOMParser.fromSchema(schema).parse(container),
      plugins: [history(), keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-b": toggleMark(schema.marks.strong), "Mod-i": toggleMark(schema.marks.em), "Shift-Ctrl-8": wrapInList(schema.nodes.bullet_list) }), keymap(baseKeymap)],
    });
  };

  const syncToolbar = (state: EditorState) => {
    const { from, to, empty, $from } = state.selection;
    const hasMark = (mark: typeof schema.marks.strong) => empty ? Boolean((state.storedMarks || $from.marks()).some((item) => item.type === mark)) : state.doc.rangeHasMark(from, to, mark);
    setBold(hasMark(schema.marks.strong));
    setItalic(hasMark(schema.marks.em));
    setList(selectionInList($from));
  };

  onSettled(() => {
    const state = stateFromHtml(props.value);
    view = new EditorView(host, {
      state,
      dispatchTransaction(transaction) {
        if (!view) return;
        const next = view.state.apply(transaction);
        view.updateState(next);
        syncToolbar(next);
        const fragment = DOMSerializer.fromSchema(schema).serializeFragment(next.doc.content);
        const container = document.createElement("div");
        container.append(fragment);
        props.onInput(container.innerHTML === "<p></p>" ? "" : container.innerHTML);
      },
      attributes: { role: "textbox", "aria-label": props.label, "aria-multiline": "true", "aria-required": String(Boolean(props.required)), ...(props.descriptionId ? { "aria-describedby": props.descriptionId } : {}), spellcheck: "true" },
    });
    syncToolbar(state);
  });

  onCleanup(() => view?.destroy());

  const toggle = (mark: MarkType) => {
    if (!view) return;
    toggleMark(mark)(view.state, view.dispatch);
    view.focus();
  };
  const toggleList = () => {
    if (!view) return;
    const { $from } = view.state.selection;
    const command = selectionInList($from)
      ? liftListItem(schema.nodes.list_item)
      : wrapInList(schema.nodes.bullet_list);
    command(view.state, view.dispatch);
    view.focus();
  };

  return <div class="rich-editor">
    <div class="editor-toolbar" role="toolbar" aria-label={`${props.label} formatting`}>
      <button type="button" class="editor-tool" aria-label="Bold" aria-pressed={bold() ? "true" : "false"} onClick={() => toggle(schema.marks.strong)}><strong>B</strong></button>
      <button type="button" class="editor-tool" aria-label="Italic" aria-pressed={italic() ? "true" : "false"} onClick={() => toggle(schema.marks.em)}><em>I</em></button>
      <button type="button" class="editor-tool" aria-label="Bulleted list" aria-pressed={list() ? "true" : "false"} onClick={toggleList}><span aria-hidden="true">• List</span></button>
    </div>
    <div ref={host} class="editor-content" data-name={props.name} />
  </div>;
}
