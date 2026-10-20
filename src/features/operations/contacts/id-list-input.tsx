'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useRef } from 'react';

import { Textarea } from '@/components/ui/textarea';
import { useAutoGrowTextarea } from '@/hooks/use-auto-grow-textarea';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { describeIdListValue, normalizePastedIdList } from '@/lib/operations/id-list-paste';
import { parityLabel, SINGLE_COLUMN_ID_LIST_MAX } from '@/lib/operations/range-list';
import { cn } from '@/lib/utils';
import { client } from '@/shared/lib/rpc';

interface Props {
  source: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputId?: string;
  /** 있으면 명단 열 홀짝 조건에서 숫자가 아닌 값 인원을 서버에 물어 상태줄에 보인다. */
  surveyId?: string;
  /**
   * 입력한 만큼 칸이 끝없이 늘어난다 (컨택원 수정 화면). 기본은 6줄 상한의 검색바 모양.
   * 켜면 Enter 는 검색 제출이 아니라 줄바꿈이다 — 그 화면은 다른 폼 안에 있다.
   */
  autoGrow?: boolean;
  /** 빈 값 토글이 켜져 입력을 쓰지 않을 때 */
  disabled?: boolean;
}

const INVALID_PREVIEW = 5;
const fmt = (n: number) => n.toLocaleString('ko-KR');

/**
 * 시스템ID/attrs 컬럼 검색 입력 — 엑셀 열/행을 그대로 붙여넣는 ID 목록 입력칸.
 * - 여러 줄 붙여넣기(개행·탭)는 공백 구분 한 줄로 정규화해 기존 값 뒤에 이어 붙인다
 * - Enter 는 검색 제출, Shift+Enter 는 줄바꿈 (textarea 라 폼 제출을 직접 건다)
 * - 인식 개수·중복 제거·숫자 아닌 값·상한 초과를 검색 전에 알린다 — 조용히 0건이 되는 사고 방지
 */
export function IdListInput({
  source,
  value,
  onChange,
  placeholder,
  inputId,
  surveyId,
  autoGrow = false,
  disabled = false,
}: Props) {
  const statusId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(textareaRef, value, autoGrow);
  const status = describeIdListValue(source, value);
  const attrsKey = source.startsWith(FILTER_SOURCE.ATTRS_PREFIX)
    ? source.slice(FILTER_SOURCE.ATTRS_PREFIX.length)
    : null;
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
    if (autoGrow) return;
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
  } else if (status.kind === 'parity') {
    statusLine = (
      <p id={statusId} className="text-xs text-slate-500">
        {parityLabel(status.parity)}
        {attrsKey != null && surveyId != null ? (
          <NonNumericExcludedNote surveyId={surveyId} attrsKey={attrsKey} />
        ) : null}
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
        ref={textareaRef}
        id={inputId}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={autoGrow ? 1 : rows}
        aria-describedby={statusLine ? statusId : undefined}
        className={cn(
          'min-h-10 py-2 text-sm leading-6 placeholder:text-gray-500',
          autoGrow
            ? 'w-full resize-none overflow-hidden font-mono'
            : wide
              ? 'w-[420px] resize-y'
              : 'h-10 w-[260px] overflow-hidden whitespace-nowrap',
        )}
      />
      {statusLine}
    </div>
  );
}

/**
 * 명단 열 홀짝 — 숫자가 아닌 값은 어느 쪽에도 걸리지 않는다. 조용히 빠지지 않게 인원을 보인다.
 * 홀짝 조건일 때만 마운트해 서버에 묻는다.
 */
function NonNumericExcludedNote({ surveyId, attrsKey }: { surveyId: string; attrsKey: string }) {
  const { data } = useQuery({
    queryKey: ['contact-attr-non-numeric', surveyId, attrsKey],
    queryFn: () => client.contacts.attrValues.nonNumericCount({ surveyId, attrsKey }),
    staleTime: 60_000,
  });
  if (!data || data.count === 0) return null;
  return <> · 숫자가 아닌 값 {fmt(data.count)}명 제외</>;
}
