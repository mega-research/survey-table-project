import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

const ALLOWED_SIZES = new Set([
  '12px',
  '14px',
  '16px',
  '18px',
  '20px',
  '24px',
  '28px',
  '32px',
]);

export const FontSize = Mark.create({
  name: 'fontSize',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      size: {
        default: null as string | null,
        renderHTML: (attrs) => {
          if (!attrs.size) return {};
          return { style: `font-size: ${attrs.size}` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (el) => {
          const raw = (el as HTMLElement).style.fontSize?.trim();
          if (!raw) return false;
          return ALLOWED_SIZES.has(raw) ? { size: raw } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) => {
          if (!ALLOWED_SIZES.has(size)) return false;
          return chain().setMark(this.name, { size }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
