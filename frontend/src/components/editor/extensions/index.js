import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Youtube from '@tiptap/extension-youtube';
import TextStyle from '@tiptap/extension-text-style';
import ThemeAwareColor from './ThemeAwareColor';
import Dropcursor from '@tiptap/extension-dropcursor';
import { common, createLowlight } from 'lowlight';

import ImageWithCaption from './ImageWithCaption';
import FileAttachment from './FileAttachment';
import CodeBlockWithLanguage from './CodeBlockWithLanguage';
import EmbedNode from './EmbedNode';
import AiSuggestion from './AiSuggestion';

/**
 * getExtensions — Assembles and returns every Tiptap extension used by
 * the blog editor, fully configured and ready to pass to `useEditor()`.
 *
 * @param {{ mentionSuggestion?: object }} options
 * @returns {import('@tiptap/core').Extension[]}
 */
export function getExtensions({ mentionSuggestion } = {}) {
  return [
    // ── Core ────────────────────────────────────────────────────────────
    StarterKit.configure({
      codeBlock: false,    // Replaced by CodeBlockWithLanguage
      dropcursor: false,   // Replaced by standalone Dropcursor config below
    }),

    // ── Text formatting ─────────────────────────────────────────────────
    Underline,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    // ThemeAwareColor = the stock Color extension that drops pasted black/white so text follows the
    // light/dark theme instead of staying a pinned colour (there's no colour picker; colour only
    // ever arrives via paste). See extensions/ThemeAwareColor.
    ThemeAwareColor,
    TextStyle,

    // ── Links ───────────────────────────────────────────────────────────
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      },
    }),

    // ── Images ──────────────────────────────────────────────────────────
    ImageWithCaption,

    // ── Tables ──────────────────────────────────────────────────────────
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,

    // ── Mentions ────────────────────────────────────────────────────────
    Mention.configure({
      HTMLAttributes: { class: 'mention' },
      suggestion: mentionSuggestion,
    }),

    // ── Placeholder & character count ───────────────────────────────────
    Placeholder.configure({
      placeholder: "Let's write an awesome story",
    }),
    CharacterCount,

    // ── Media embeds ────────────────────────────────────────────────────
    Youtube.configure({
      inline: false,
      HTMLAttributes: { class: 'youtube-embed' },
    }),
    EmbedNode,

    // ── File attachments ────────────────────────────────────────────────
    FileAttachment,

    // ── AI assistant: inline review of a proposed change (decorations only) ──
    AiSuggestion,

    // ── Code blocks ─────────────────────────────────────────────────────
    CodeBlockWithLanguage.configure({
      lowlight: createLowlight(common),
    }),

    // ── Drag & drop ─────────────────────────────────────────────────────
    Dropcursor.configure({
      color: 'rgb(var(--c-brand))',
      width: 2,
    }),
  ];
}

export default getExtensions;
