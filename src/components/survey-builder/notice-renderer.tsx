'use client';

import { useState } from 'react';

import { Label } from '@/components/ui/label';
import { sanitizeRichHtml } from '@/lib/sanitize';

interface NoticeRendererProps {
  content: string;
  requiresAcknowledgment?: boolean;
  value?: boolean;
  onChange?: (acknowledged: boolean) => void;
  isTestMode?: boolean;
}

export function NoticeRenderer({
  content,
  requiresAcknowledgment = false,
  value = false,
  onChange,
  isTestMode = false,
}: NoticeRendererProps) {
  const [acknowledged, setAcknowledged] = useState(value);

  const handleAcknowledgmentChange = (checked: boolean) => {
    setAcknowledged(checked);
    onChange?.(checked);
  };

  return (
    <div className="space-y-4">
      {/* Rich Text Content Display */}
      <div
        className="prose prose-sm max-w-none overflow-x-auto rounded-lg border border-blue-100 bg-blue-50/40 p-6 [&_img]:inline-block [&_img]:align-top [&_p]:min-h-[1.6em] [&_table]:my-4 [&_table]:table-auto [&_table]:border-collapse [&_table]:border [&_table]:border-gray-300 [&_table_p]:m-0 [&_table_td]:box-border [&_table_td]:overflow-hidden [&_table_td]:border [&_table_td]:border-gray-300 [&_table_td]:px-3 [&_table_td]:py-2 [&_table_td]:align-top [&_table_th]:box-border [&_table_th]:overflow-hidden [&_table_th]:border [&_table_th]:border-gray-300 [&_table_th]:bg-transparent [&_table_th]:px-3 [&_table_th]:py-2 [&_table_th]:align-top [&_table_th]:font-normal"
        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(content) }}
        style={{
          // TipTap 스타일 재정의
          fontSize: '14px',
          lineHeight: '1.6',
          WebkitOverflowScrolling: 'touch',
        }}
      />

      {/* Acknowledgment Checkbox */}
      {requiresAcknowledgment && (
        <div className="flex items-start space-x-3 rounded-lg border border-gray-200 bg-white p-4">
          <input
            type="radio"
            id="acknowledgment-check"
            checked={acknowledged}
            onChange={(e) => handleAcknowledgmentChange(e.target.checked)}
            className="mt-0.5 h-5 w-5 border-gray-300 text-blue-600 focus:ring-blue-500"
            disabled={!isTestMode && !onChange}
          />
          <Label
            htmlFor="acknowledgment-check"
            className="flex-1 cursor-pointer text-sm font-medium text-gray-900"
          >
            위 내용을 읽고 이해했습니다.
          </Label>
        </div>
      )}

      {requiresAcknowledgment && !acknowledged && (
        <div className="rounded bg-red-50 p-2 text-xs text-red-600">
          ⚠️ 위 내용을 확인하고 체크해주세요.
        </div>
      )}
    </div>
  );
}
