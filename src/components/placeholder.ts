import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const placeholderPlugin = (text: string) => {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        // Check if the doc is effectively empty
        if (
          doc.childCount === 1 &&
          doc.firstChild?.isTextblock &&
          doc.firstChild.content.size === 0
        ) {
          return DecorationSet.create(doc, [
            Decoration.node(0, doc.content.size, {
              class: "prose-empty",
              "data-placeholder": text,
            }),
          ]);
        }
        return DecorationSet.empty;
      },
    },
  });
};
