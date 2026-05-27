import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { FileAttachmentNodeView } from './file-attachment-node-view';
import {
  buildAttachmentMetaText,
  FILE_ATTACHMENT_DEFAULT_LABEL,
} from './file-attachment-format';

export interface FileAttachmentAttrs {
  key: string | null;
  url: string | null;
  filename: string | null;
  label: string;
  size: number | string | null;
  mime: string | null;
}

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: { default: null },
      url: { default: null },
      filename: { default: null },
      label: { default: '' },
      size: { default: null },
      mime: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-file-attachment="true"]',
        priority: 1000,
        getAttrs: (node) => {
          if (typeof node === 'string') return false;
          const el = node as HTMLElement;
          if (typeof el.getAttribute !== 'function') return false;
          const labelEl = el.querySelector('.notice-file-attachment-label');
          const label = labelEl?.textContent ?? el.textContent ?? '';
          return {
            key: el.getAttribute('data-key') ?? null,
            url: el.getAttribute('href') ?? null,
            filename: el.getAttribute('data-filename') ?? null,
            label,
            size: el.getAttribute('data-size') ?? null,
            mime: el.getAttribute('data-mime') ?? null,
          };
        },
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentNodeView);
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as FileAttachmentAttrs;
    const label = attrs.label || attrs.filename || FILE_ATTACHMENT_DEFAULT_LABEL;
    const meta = buildAttachmentMetaText(attrs.filename, attrs.size);

    const textChildren: Array<unknown> = [
      ['span', { class: 'notice-file-attachment-label' }, label],
    ];
    if (meta) {
      textChildren.push(['span', { class: 'notice-file-attachment-meta' }, meta]);
    }

    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-file-attachment': 'true',
        'data-key': attrs.key ?? '',
        'data-filename': attrs.filename ?? '',
        'data-size': attrs.size ?? '',
        'data-mime': attrs.mime ?? '',
        href: attrs.url ?? '#',
        download: attrs.filename ?? '',
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'notice-file-attachment',
      }),
      ['span', { class: 'notice-file-attachment-text' }, ...textChildren],
    ] as never;
  },
});
