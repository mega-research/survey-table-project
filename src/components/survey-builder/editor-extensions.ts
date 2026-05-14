import { Extension } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import StarterKit from '@tiptap/starter-kit';
import ImageResize from 'tiptap-extension-resize-image';

import { TableSelectOnBackspace } from '@/lib/tiptap/table-select-on-backspace';
import { TrailingNode } from '@/lib/tiptap/trailing-node';
import { mailVarTokenPlugin } from '../operations/mail-template/mail-var-token-plugin';

// {{변수}} 토큰에 amber 데코레이션을 입히는 ProseMirror Plugin을 TipTap Extension으로 래핑
const VarTokenExtension = Extension.create({
  name: 'varToken',
  addProseMirrorPlugins() {
    return [mailVarTokenPlugin];
  },
});


// 배경색 속성 추가 함수
const addBackgroundColorAttribute = () => ({
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-background-color'),
    renderHTML: (attributes: { backgroundColor?: string | null }) => {
      if (!attributes.backgroundColor) {
        return {};
      }
      return {
        'data-background-color': attributes.backgroundColor,
        style: `background-color: ${attributes.backgroundColor}`,
      };
    },
  },
});

// colwidth 속성을 style width로 변환하는 설정 추가
const addColwidthAttribute = () => ({
  colwidth: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const colwidth = element.getAttribute('colwidth');
      return colwidth ? colwidth.split(',').map((item) => parseInt(item, 10)) : null;
    },
    renderHTML: (attributes: { colwidth?: number[] | null }) => {
      if (!attributes.colwidth || !attributes.colwidth.length) {
        return {};
      }
      const width = attributes.colwidth.reduce((a, b) => a + b, 0);
      return {
        colwidth: attributes.colwidth.join(','),
        style: `width: ${width}px`,
      };
    },
  },
});

// 에디터 확장을 생성하는 함수 (매번 새로운 인스턴스 생성)
// TipTap 3.x에서 여러 에디터 인스턴스를 사용할 때 플러그인 충돌을 방지하기 위해
// 각 호출마다 새로운 확장 인스턴스를 생성합니다.
export function createEditorExtensions() {
  // 배경색과 너비를 지원하는 TableCell 확장 - 매번 새로 생성
  const TableCellWithBackground = TableCell.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        ...addBackgroundColorAttribute(),
        ...addColwidthAttribute(),
      };
    },
  });

  // 배경색과 너비를 지원하는 TableHeader 확장 - 매번 새로 생성
  const TableHeaderWithBackground = TableHeader.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        ...addBackgroundColorAttribute(),
        ...addColwidthAttribute(),
      };
    },
  });

  // ImageResize 확장 (R2 public URL 직접 사용)
  // tiptap-extension-resize-image는 드래그 리사이즈와 정렬 기능을 제공
  const ImageResizeWithProxy = ImageResize.extend({
    renderHTML({ HTMLAttributes }) {
      // 인라인 스타일에서 width가 있으면 max-width도 함께 설정
      if (HTMLAttributes.style) {
        const styleStr = HTMLAttributes.style as string;
        if (styleStr.includes('width') && !styleStr.includes('max-width')) {
          HTMLAttributes.style = `${styleStr}; max-width: 100%;`;
        }
      }

      return ['img', HTMLAttributes];
    },
    addAttributes() {
      return {
        ...this.parent?.(),
        style: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const style = element.getAttribute('style') || '';
            // width가 있으면 max-width도 추가
            if (style.includes('width') && !style.includes('max-width')) {
              return `${style}; max-width: 100%;`;
            }
            return style || null;
          },
          renderHTML: (attributes: { style?: string | null }) => {
            if (!attributes.style) {
              return {};
            }
            // width가 있으면 max-width도 추가
            if (attributes.style.includes('width') && !attributes.style.includes('max-width')) {
              return {
                style: `${attributes.style}; max-width: 100%;`,
              };
            }
            return {
              style: attributes.style,
            };
          },
        },
      };
    },
  });

  return [
    // StarterKit을 매번 새로 생성하여 플러그인 충돌 방지
    StarterKit.configure({}),
    ImageResizeWithProxy.configure({
      inline: true,
      allowBase64: true,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'text-blue-600 underline',
      },
    }),
    Table.configure({
      resizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableCellWithBackground,
    TableHeaderWithBackground,
    TrailingNode,
    TableSelectOnBackspace,
    VarTokenExtension,
  ];
}
