'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  FileArchive,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react';

import {
  FILE_ATTACHMENT_DEFAULT_LABEL,
  formatFileSize,
} from './file-attachment-format';

interface IconConfig {
  Icon: LucideIcon;
  color: string;
}

const DEFAULT_ICON: IconConfig = { Icon: FileText, color: 'text-gray-500' };

// MIME → IconConfig 매핑 (exact match 우선)
const MIME_ICON_MAP: Record<string, IconConfig> = {
  'application/pdf': { Icon: FileText, color: 'text-red-600' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    Icon: FileSpreadsheet,
    color: 'text-green-600',
  },
  'application/vnd.ms-excel': { Icon: FileSpreadsheet, color: 'text-green-600' },
  'application/zip': { Icon: FileArchive, color: 'text-gray-600' },
  'application/x-zip-compressed': { Icon: FileArchive, color: 'text-gray-600' },
  'application/hwp+zip': { Icon: FileArchive, color: 'text-gray-600' },
  'application/msword': { Icon: FileText, color: 'text-blue-600' },
  'application/hwp': { Icon: FileText, color: 'text-purple-600' },
  'application/haansofthwp': { Icon: FileText, color: 'text-purple-600' },
  'application/haansofthwpx': { Icon: FileText, color: 'text-purple-600' },
  'application/vnd.ms-powerpoint': { Icon: FileText, color: 'text-orange-600' },
};

// startsWith prefix → IconConfig (exact match 실패 시 사용)
const MIME_PREFIX_ICON_MAP: Array<[string, IconConfig]> = [
  ['application/vnd.hancom.hwp', { Icon: FileText, color: 'text-purple-600' }],
  ['application/x-hwp', { Icon: FileText, color: 'text-purple-600' }],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml',
    { Icon: FileText, color: 'text-blue-600' },
  ],
  [
    'application/vnd.openxmlformats-officedocument.presentationml',
    { Icon: FileText, color: 'text-orange-600' },
  ],
];

function pickIcon(mime: string | null): IconConfig {
  if (!mime) return DEFAULT_ICON;
  const exact = MIME_ICON_MAP[mime];
  if (exact) return exact;
  for (const [prefix, config] of MIME_PREFIX_ICON_MAP) {
    if (mime.startsWith(prefix)) return config;
  }
  return DEFAULT_ICON;
}

export function FileAttachmentNodeView({ node, selected }: NodeViewProps) {
  const { label, filename, size, mime } = node.attrs as {
    label: string;
    filename: string | null;
    size: number | string | null;
    mime: string | null;
  };
  const { Icon, color } = pickIcon(mime);
  const sizeText = formatFileSize(size);

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-flex max-w-full items-center gap-2 rounded-lg border bg-white px-3 py-2 align-top shadow-sm ${
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
      }`}
      data-drag-handle
    >
      <Icon className={`h-5 w-5 flex-shrink-0 ${color}`} aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-gray-800">
          {label || filename || FILE_ATTACHMENT_DEFAULT_LABEL}
        </span>
        {(filename || sizeText) && (
          <span className="truncate text-xs text-gray-500">
            {[filename, sizeText].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
