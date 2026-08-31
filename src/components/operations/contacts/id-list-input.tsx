'use client';

import { useId } from 'react';

import { Textarea } from '@/components/ui/textarea';
import { describeIdListValue, normalizePastedIdList } from '@/lib/operations/id-list-paste';
import { SINGLE_COLUMN_ID_LIST_MAX } from '@/lib/operations/range-list';
import { cn } from '@/lib/utils';

interface Props {
  source: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputId?: string;
}

const INVALID_PREVIEW = 5;
const fmt = (n: number) => n.toLocaleString('ko-KR');

/**
 * 시스템ID/attrs 컬럼 검색 입력 — 엑셀 열/행을 그대로 붙여넣는 ID 목록 입력칸.
 * - 여러 줄 붙여넣기(개행·탭)는 공백 구분 한 줄로 정규화해 기존 값 뒤에 이어 붙인다
 * - Enter 는 검색 제출, Shift+Enter 는 줄바꿈 (textarea 라 폼 제출을 직접 건다)
 * - 인식 개수·중복 제거·숫자 아닌 값·상한 초과를 검색 전에 알린다 — 조용히 0건이 되는 사고 방지
 */
export function IdListInput({ source, value, onChange, placeholder, inputId }: Props) {
  const statusId = useId();
  const status = describeIdListValue(source, value);
  const wide = value.length > 40 || value.includes('\n');
  const rows = wide ? Math.min(6, Math.max(2, Math.ceil(value.length / 70))) : 1;

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData?.getData('text') ?? '';
    // 한 줄 붙여넣기는 브라우저 기본 동작(커서 위치 삽입)에 맡긴다.
    if (!/[\r\n\t]/.test(text)) return;
    e.preventDefault();
    const pasted = normalizePastedIdList(text);
    const base = value.trim();
    onChange(base.length > 0 ? `${base} ${pasted}` : pasted);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  let statusLine: React.ReactNode = null;
  if (status.kind === 'list') {
    statusLine = (
      <div id={statusId} className="text-xs text-slate-500">
        <span>
          ID {fmt(status.count)}개 인식
          {status.duplicates > 0 ? ` · 중복 ${fmt(status.duplicates)}개 제거` : ''}
        </span>
        {status.overLimit ? (
          <span className="ml-2 text-blue-600">
            {fmt(SINGLE_COLUMN_ID_LIST_MAX)}개 초과 — 검색 시 목록을 저장해 적용합니다
          </span>
        ) : null}
      </div>
    );
  } else if (status.kind === 'invalid') {
    const preview = status.invalid.slice(0, INVALID_PREVIEW).join(', ');
    const more = status.invalid.length > INVALID_PREVIEW ? ' …' : '';
    statusLine = (
      <p id={statusId} role="alert" className="text-xs text-red-600">
        숫자가 아닌 값 {fmt(status.invalid.length)}개: {preview}
        {more}
      </p>
    );
  } else if (status.kind === 'leadingZero') {
    const preview = status.tokens.slice(0, INVALID_PREVIEW).join(', ');
    const more = status.tokens.length > INVALID_PREVIEW ? ' …' : '';
    statusLine = (
      <p id={statusId} role="alert" className="text-xs text-red-600">
        앞에 0이 붙은 번호 {fmt(status.tokens.length)}개는 목록 검색이 안 됩니다: {preview}
        {more}
      </p>
    );
  } else if (status.kind === 'token') {
    statusLine = (
      <p id={statusId} className="text-xs text-slate-500">
        {status.count !== null
          ? `저장된 ID 목록 ${fmt(status.count)}개 — 새로 붙여넣으면 교체됩니다`
          : '저장된 ID 목록 — 새로 붙여넣으면 교체됩니다'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        aria-describedby={statusLine ? statusId : undefined}
        className={cn(
          'min-h-10 py-2 text-sm leading-6 placeholder:text-gray-500',
          wide ? 'w-[420px] resize-y' : 'h-10 w-[260px] overflow-hidden whitespace-nowrap',
        )}
      />
      {statusLine}
    </div>
  );
}
