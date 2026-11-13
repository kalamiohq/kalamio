import { memo, useCallback } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import ToolbarButton from './ToolbarButton';

// Both of these are module-level on purpose: the v3 BubbleMenu re-dispatches a transaction whenever
// `options` or `shouldShow` change identity, and the editor re-renders on every transaction, so
// inline versions loop forever ("Maximum update depth exceeded").
const BUBBLE_MENU_OPTIONS = { placement: 'top' };

const shouldShowBubbleMenu = ({ editor: ed, from, to }) => {
  // On mobile the always-visible sticky toolbar handles formatting, so suppress the bubble menu —
  // it would otherwise collide with (and be covered by) the native text-selection toolbar.
  if (typeof window !== 'undefined' && window.innerWidth < 768) return false;
  // Don't show on image nodes or empty selections
  if (from === to) return false;
  if (ed.isActive('image')) return false;
  if (ed.isActive('codeBlock')) return false;
  return true;
};

const BubbleMenuComponent = ({ editor }) => {
  // Hooks must run unconditionally — declare the callback before any early return.
  const handleLinkToggle = useCallback(() => {
    if (!editor) return;

    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    const raw = window.prompt('Enter URL:');
    if (raw === null) return;
    const url = raw.trim();
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    // Normalize like LinkInsertModal so a bare host ("google.com") isn't stored as a relative link
    // that 404s on the published article.
    const finalUrl = /^(https?:\/\/|mailto:|tel:)/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: finalUrl }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      options={BUBBLE_MENU_OPTIONS}
      className="bubble-menu-popper"
      shouldShow={shouldShowBubbleMenu}
    >
      <div className="bubble-menu">
        <ToolbarButton
          icon="format_bold"
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
        />
        <ToolbarButton
          icon="format_italic"
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
        />
        <ToolbarButton
          icon="format_underlined"
          label="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
        />
        <ToolbarButton
          icon="strikethrough_s"
          label="Strikethrough"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
        />
        <ToolbarButton
          icon="code"
          label="Inline Code"
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive('code')}
        />
        <ToolbarButton
          icon="ink_highlighter"
          label="Highlight"
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          isActive={editor.isActive('highlight')}
        />

        <div className="toolbar-divider" />

        <ToolbarButton
          icon={editor.isActive('link') ? 'link_off' : 'link'}
          label={editor.isActive('link') ? 'Remove Link' : 'Insert Link'}
          onClick={handleLinkToggle}
          isActive={editor.isActive('link')}
        />
      </div>
    </BubbleMenu>
  );
};

BubbleMenuComponent.displayName = 'BubbleMenuComponent';

export default BubbleMenuComponent;
