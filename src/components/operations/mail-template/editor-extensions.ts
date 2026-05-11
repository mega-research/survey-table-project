import { type AnyExtension, Extension } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import BulletList from '@tiptap/extension-bullet-list';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import History from '@tiptap/extension-history';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Image from '@tiptap/extension-image';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableRow } from '@tiptap/extension-table-row';
import Text from '@tiptap/extension-text';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';

import { TableSelectOnBackspace } from '@/lib/tiptap/table-select-on-backspace';

import { FontSize } from './font-size-mark';
import { mailVarTokenPlugin } from './mail-var-token-plugin';
import { TableCaption } from './table-caption';
import { TrailingNode } from './trailing-node';
import {
  parseTableAlign,
  tableAlignStyle,
  parseVerticalAlign,
  verticalAlignStyle,
  type HAlign,
  type VAlign,
} from './table-attrs-helpers';

const MailVarTokenExtension = Extension.create({
  name: 'mailVarToken',
  addProseMirrorPlugins() {
    return [mailVarTokenPlugin];
  },
});

const TableCellExtended = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      verticalAlign: {
        default: 'top' as VAlign,
        parseHTML: (el) => parseVerticalAlign(el as HTMLElement),
        renderHTML: (attrs) => ({
          style: verticalAlignStyle(attrs.verticalAlign as VAlign),
        }),
      },
      backgroundColor: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
        renderHTML: (attrs) =>
          attrs.backgroundColor
            ? { style: `background-color: ${attrs.backgroundColor}` }
            : {},
      },
    };
  },
});

// 옛 데이터의 <th> 를 <td> 로 마이그레이션하면서 TableCellExtended 의
// attrs(verticalAlign, backgroundColor) 까지 그대로 상속
const TableHeaderCompat = TableCellExtended.extend({
  name: 'tableHeader',
  parseHTML() {
    return [{ tag: 'th' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['td', HTMLAttributes, 0];
  },
});

const TableExtended = Table.extend({
  // caption은 표의 첫 자식으로만 0~1개, 그 다음 row 1개 이상
  content: 'tableCaption? tableRow+',
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'left' as HAlign,
        parseHTML: (el) => parseTableAlign(el as HTMLElement),
        renderHTML: (attrs) => ({
          style: tableAlignStyle(attrs.align as HAlign),
        }),
      },
    };
  },
});

export function createMailEditorExtensions(): AnyExtension[] {
  const extensions: AnyExtension[] = [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Underline,
    Strike,
    TextStyle,
    FontSize,
    Heading.configure({ levels: [1, 2, 3] }),
    TextAlign.configure({
      types: ['paragraph', 'heading'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    }),
    BulletList,
    OrderedList,
    ListItem,
    HardBreak,
    HorizontalRule,
    History,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer' },
    }),
    Image,
    TableExtended.configure({
      resizable: true,
      cellMinWidth: 60,
      lastColumnResizable: true,
    }),
    TableRow,
    TableHeaderCompat,
    TableCellExtended,
    TableCaption,
    TrailingNode,
    TableSelectOnBackspace,
    MailVarTokenExtension,
  ];
  return extensions;
}
