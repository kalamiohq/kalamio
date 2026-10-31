import { Color } from '@tiptap/extension-text-style';
import { isThemeText } from '../utils/themeColor';

/**
 * The stock Tiptap `Color` extension (from `@tiptap/extension-text-style`), hardened so pasted text doesn't carry a fixed black/white
 * colour that fights the platform theme. It overrides the `color` global attribute at BOTH ends:
 *
 *   • parseHTML — paste / HTML load: drop the colour when it's an achromatic near-black/near-white
 *     so the text inherits the theme text colour (--c-black) instead of a pinned value. New content
 *     is therefore stored WITHOUT the offending colour.
 *   • renderHTML — the editor DOM: also guard here, because content loaded from stored JSON skips
 *     parseHTML entirely (attrs come straight from the JSON). This makes already-saved black/white
 *     marks render theme-adaptive while editing, not only on fresh paste.
 *
 * Genuine (saturated) colours pass through untouched. See utils/themeColor for the detection, and
 * utils/tiptap-renderer for the matching guard on the read-only published view.
 */
export const ThemeAwareColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types, // ['textStyle']
        attributes: {
          color: {
            default: null,
            parseHTML: (element) => {
              const color = element.style.color?.replace(/["']+/g, '') || null;
              return color && isThemeText(color) ? null : color;
            },
            renderHTML: (attributes) => {
              if (!attributes.color || isThemeText(attributes.color)) return {};
              return { style: `color: ${attributes.color}` };
            },
          },
        },
      },
    ];
  },
});

export default ThemeAwareColor;
