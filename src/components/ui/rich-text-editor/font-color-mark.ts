import { Mark, mergeAttributes } from '@tiptap/core';

import { normalizeHexColor } from './table-attrs-helpers';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontColor: {
      setFontColor: (color: string) => ReturnType;
      unsetFontColor: () => ReturnType;
    };
  }
}

/**
 * 글자 색 mark — font-size-mark 와 동일한 span+inline style 패턴.
 * 값은 #rrggbb hex 로 통일한다 (sanitize.ts color 화이트리스트 통과 +
 * 브라우저 CSSOM 의 rgb() 재직렬화 왕복은 normalizeHexColor 가 흡수).
 */
export const FontColor = Mark.create({
  name: 'fontColor',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      color: {
        default: null as string | null,
        renderHTML: (attrs) => {
          if (!attrs['color']) return {};
          return { style: `color: ${attrs['color']}` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (el) => {
          const hex = normalizeHexColor((el as HTMLElement).style.color);
          return hex ? { color: hex } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFontColor:
        (color) =>
        ({ chain }) => {
          const hex = normalizeHexColor(color);
          if (!hex) return false;
          return chain().setMark(this.name, { color: hex }).run();
        },
      unsetFontColor:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
