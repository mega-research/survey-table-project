import { type AnyExtension, Extension } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Strike from '@tiptap/extension-strike';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import ImageResize from 'tiptap-extension-resize-image';

import { TableSelectOnBackspace } from '@/lib/tiptap/table-select-on-backspace';

import { FontSize } from './font-size-mark';
import {
  parseTableAlign,
  parseVerticalAlign,
  tableAlignStyle,
  verticalAlignStyle,
  type HAlign,
  type VAlign,
} from './table-attrs-helpers';
import { TableCaption } from './table-caption';
import { TrailingNode } from './trailing-node';
import { createVarTokenPlugin } from './var-token-plugin';
import type { RichTextEditorKind } from './types';

const VarTokenExtension = Extension.create({
  name: 'varToken',
  addProseMirrorPlugins() {
    return [createVarTokenPlugin()];
  },
});

const ImageResizeWithProxy = ImageResize.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const style = element.getAttribute('style') || '';
          if (style.includes('width') && !style.includes('max-width')) {
            return `${style}; max-width: 100%;`;
          }
          return style || null;
        },
        renderHTML: (attributes: { style?: string | null }) => {
          if (!attributes.style) return {};
          if (attributes.style.includes('width') && !attributes.style.includes('max-width')) {
            return { style: `${attributes.style}; max-width: 100%;` };
          }
          return { style: attributes.style };
        },
      },
    };
  },
});

function makeCellAttrs() {
  return {
    backgroundColor: {
      default: null as string | null,
      // 메일(style only) + 설문(data-background-color) 양쪽 모두 파싱
      parseHTML: (el: HTMLElement) =>
        el.getAttribute('data-background-color') || el.style.backgroundColor || null,
      renderHTML: (attrs: { backgroundColor?: string | null }) => {
        if (!attrs.backgroundColor) return {};
        return {
          'data-background-color': attrs.backgroundColor,
          style: `background-color: ${attrs.backgroundColor}`,
        };
      },
    },
    verticalAlign: {
      default: 'top' as VAlign,
      parseHTML: (el: HTMLElement) => parseVerticalAlign(el),
      renderHTML: (attrs: { verticalAlign?: VAlign }) => ({
        style: verticalAlignStyle((attrs.verticalAlign ?? 'top') as VAlign),
      }),
    },
    colwidth: {
      default: null as number[] | null,
      parseHTML: (el: HTMLElement) => {
        const cw = el.getAttribute('colwidth');
        return cw ? cw.split(',').map((n) => parseInt(n, 10)) : null;
      },
      renderHTML: (attrs: { colwidth?: number[] | null }) => {
        if (!attrs.colwidth || !attrs.colwidth.length) return {};
        const width = attrs.colwidth.reduce((a, b) => a + b, 0);
        return { colwidth: attrs.colwidth.join(','), style: `width: ${width}px` };
      },
    },
  };
}

export interface CreateUnifiedExtensionsOptions {
  kind?: RichTextEditorKind;
}

/**
 * 통합 TipTap extensions 배열을 만든다.
 * 호출하는 React 컴포넌트에서는 반드시 useMemo 로 감싸 매 렌더마다 에디터가 destroy/recreate 되지 않도록 한다.
 */
export function createUnifiedExtensions(options: CreateUnifiedExtensionsOptions = {}): AnyExtension[] {
  const kind = options.kind ?? 'survey';

  const TableCellExtended = TableCell.extend({
    addAttributes() {
      return { ...this.parent?.(), ...makeCellAttrs() };
    },
  });

  // mail: <th>를 <td>로 마이그레이션 (Outlook 호환), survey: <th> 유지
  const TableHeaderExtended =
    kind === 'mail'
      ? TableCellExtended.extend({
          name: 'tableHeader',
          parseHTML() {
            return [{ tag: 'th' }];
          },
          renderHTML({ HTMLAttributes }) {
            return ['td', HTMLAttributes, 0];
          },
        })
      : TableHeader.extend({
          addAttributes() {
            return { ...this.parent?.(), ...makeCellAttrs() };
          },
        });

  const TableExtended = Table.extend({
    content: 'tableCaption? tableRow+',
    addAttributes() {
      return {
        ...this.parent?.(),
        align: {
          default: 'left' as HAlign,
          parseHTML: (el: HTMLElement) => parseTableAlign(el),
          renderHTML: (attrs: { align?: HAlign }) => ({
            style: tableAlignStyle((attrs.align ?? 'left') as HAlign),
          }),
        },
      };
    },
  });

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // StarterKit 기본 strike 끄고 별도 ext 로 통일
      strike: false,
      // StarterKit 3.x 에 bundled된 ext를 끄고 아래에서 별도 configure
      underline: false,
      link: false,
      // StarterKit 의 trailingNode 끄고 @/lib/tiptap/trailing-node 사용
      trailingNode: false,
    }),
    Underline,
    Strike,
    TextStyle,
    FontSize,
    TextAlign.configure({
      types: ['paragraph', 'heading', 'image'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', class: 'text-blue-600 underline' },
    }),
    ImageResizeWithProxy.configure({ inline: true, allowBase64: true }),
    TableExtended.configure({
      resizable: true,
      cellMinWidth: 60,
      lastColumnResizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableHeaderExtended,
    TableCellExtended,
    TableCaption,
    TrailingNode,
    TableSelectOnBackspace,
    VarTokenExtension,
  ];
}
