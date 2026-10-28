import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * AiSuggestion — shows ONE pending AI article change inline, without changing the document.
 *
 *   • the content it would remove: red highlight + strikethrough on text, and a red dashed outline
 *     on non-text nodes (images, tables, embeds…) so a disappearing image can't go unnoticed;
 *   • the proposed content: a widget at the target position that hosts the editable green
 *     preview (AiProposalCard is rendered into `dom` through a React portal).
 *
 * Nothing is inserted until the author approves, so autosave never persists a half-reviewed
 * suggestion and undo stays one clean step. Positions are mapped through every transaction, so the
 * suggestion follows the author's own edits while they review; if the content it targets is deleted,
 * it's marked `stale` and can no longer be applied.
 *
 * State: null | { id, dom, at } (insert/append) | { id, dom, from, to, replaceAll? } (replace)
 *      | { id, dom, at, edits: [{ from, to, text, found, enabled, stale? }] } (text fixes; `at` = review card)
 */
export const aiSuggestionKey = new PluginKey('aiSuggestion');

/** Non-text node types → how to name them to the author (and to the model, see ai-editor.js). */
export const NON_TEXT_NODES = {
  image: 'image',
  table: 'table',
  youtube: 'video',
  embed: 'embed',
  fileAttachment: 'file',
  horizontalRule: 'divider',
};

// A range keeps hugging its content (text typed at either edge isn't pulled in); it goes stale if
// the content it targets is deleted.
const mapRange = (r, tr) => {
  const from = tr.mapping.map(r.from, 1);
  const to = Math.max(from, tr.mapping.map(r.to, -1));
  return { ...r, from, to, stale: r.stale || (r.to > r.from && to === from) };
};

const mapSuggestion = (s, tr) => {
  if (s.edits) {
    return { ...s, at: tr.mapping.map(s.at, 1), edits: s.edits.map(e => (e.found ? mapRange(e, tr) : e)) };
  }
  if (s.replaceAll) return { ...s, from: 0, to: tr.doc.content.size };
  if (s.at !== undefined) return { ...s, at: tr.mapping.map(s.at, 1) };
  return mapRange(s, tr);
};

const inlineInsertion = (text) => () => {
  const span = document.createElement('span');
  span.className = 'ai-suggestion-insert-inline';
  span.textContent = text;
  return span;
};

export const getAiSuggestion = (state) => aiSuggestionKey.getState(state);

export const AiSuggestion = Extension.create({
  name: 'aiSuggestion',

  // Meta-only: undo history ignores transactions without steps. (Don't set addToHistory:false here —
  // clearAiSuggestion shares the apply transaction, and that would make the applied change un-undoable.)
  addCommands() {
    return {
      setAiSuggestion: (suggestion) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(aiSuggestionKey, suggestion);
        return true;
      },
      clearAiSuggestion: () => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(aiSuggestionKey, null);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiSuggestionKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(aiSuggestionKey);
            if (meta !== undefined) return meta;
            return value && tr.docChanged ? mapSuggestion(value, tr) : value;
          },
        },
        props: {
          decorations(state) {
            const s = aiSuggestionKey.getState(state);
            if (!s) return null;
            const decorations = [];
            // Text fixes: each wrong bit struck through in red, its correction right after it in green.
            s.edits?.forEach((e, i) => {
              if (!e.found || !e.enabled || e.stale) return;
              // data-ai-fix lets the chat's fix list scroll to a fix.
              decorations.push(Decoration.inline(e.from, e.to, { class: 'ai-suggestion-remove', 'data-ai-fix': `${s.id}-${i}` }));
              if (e.text) {
                decorations.push(Decoration.widget(e.to, inlineInsertion(e.text), {
                  key: `ai-fix-${s.id}-${i}-${e.text}`, side: 1, ignoreSelection: true, marks: [],
                }));
              }
            });
            if (!s.edits && s.to > s.from) {
              decorations.push(Decoration.inline(s.from, s.to, { class: 'ai-suggestion-remove' }));
              state.doc.nodesBetween(s.from, s.to, (node, pos) => {
                if (!NON_TEXT_NODES[node.type.name]) return true;
                if (pos >= s.from && pos + node.nodeSize <= s.to) {
                  decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ai-suggestion-remove-node' }));
                }
                return false;
              });
            }
            // The editable preview sits where the content will land (after what it replaces). Text fixes
            // have no `dom`: they're reviewed from the chat, and only highlighted here.
            if (s.dom) {
              decorations.push(Decoration.widget(s.at ?? s.to, s.dom, {
                key: `ai-suggestion-${s.id}`,
                side: 1,
                ignoreSelection: true,
                stopEvent: () => true, // the nested preview editor owns its keyboard/mouse/paste events
              }));
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export default AiSuggestion;
