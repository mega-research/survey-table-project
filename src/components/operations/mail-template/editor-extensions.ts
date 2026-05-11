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
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import Text from '@tiptap/extension-text';
import { TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import FontSize from 'tiptap-extension-font-size';

import { mailVarTokenPlugin } from './mail-var-token-plugin';

const MailVarTokenExtension = Extension.create({
  name: 'mailVarToken',
  addProseMirrorPlugins() {
    return [mailVarTokenPlugin];
  },
});

export function createMailEditorExtensions(): AnyExtension[] {
  // FontSize 는 자체 번들된 @tiptap/core 버전이 다르므로 AnyExtension 으로 캐스팅
  const extensions: AnyExtension[] = [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Underline,
    Strike,
    TextStyle,
    FontSize as unknown as AnyExtension,
    Heading.configure({ levels: [1, 2, 3] }),
    BulletList,
    OrderedList,
    ListItem,
    HardBreak,
    HorizontalRule,
    History,
    Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    Image,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    MailVarTokenExtension,
  ];
  return extensions;
}
