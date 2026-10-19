'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactAssignmentOption } from '@/shared/contracts/contacts-io';
import {
  contactResultFilterOptions,
  decodeMultiClauseValue,
  encodeMultiClauseValue,
  FILTER_NONE_LABEL,
  FILTER_NONE_VALUE,
  FILTER_SOURCE,
  MAIL_FILTER_OPTIONS,
  placeholderFor,
  webFilterOptionsFor,
  withNoneOption,
} from '@/lib/operations/filter-shared';
import { isIdListSource } from '@/lib/operations/id-list-paste';

import { IdListInput } from './id-list-input';

interface Props {
  source: string;
  value: string;
  onChange: (v: string) => void;
  resultCodeOptions: ContactResultCode[];
  /** system.contact_owner 선택지 (컨택원 순서) — 끝에 「— (없음)」이 붙는다. */
  assignmentOptions?: ContactAssignmentOption[];
  inputId?: string;
  /** ID 목록 입력의 서버 조회(명단 열 홀짝 비숫자 인원)용. */
  surveyId?: string;
  /** ID 목록 입력칸이 입력한 만큼 끝없이 늘어난다 (컨택원 수정 화면). */
  idListAutoGrow?: boolean;
}

/**
 * 컬럼 source 에 따라 다른 입력 위젯 렌더.
 * - system.contact_result -> 결과코드 dropdown (+ "결과 없음")
 * - system.web -> 응답 완료/미응답 dropdown
 * - system.contact_owner -> 컨택원 dropdown (+ "— (없음)")
 * - system.resid / attrs.* -> ID 목록 입력 (IdListInput — 엑셀 붙여넣기·인식 개수·경고)
 * - 그 외 (pii.*) -> text input
 */
export function ValueWidget({
  source,
  value,
  onChange,
  resultCodeOptions,
  assignmentOptions = [],
  inputId,
  surveyId,
  idListAutoGrow = false,
}: Props) {
  // 여러 값(오른쪽 값 목록에서 체크한 값들) — 칩으로 보이고 × 로 하나씩 뺀다.
  const multi = decodeMultiClauseValue(value);
  if (multi) {
    const labelOf = (v: string): string => {
      if (v === FILTER_NONE_VALUE) return FILTER_NONE_LABEL;
      if (source === FILTER_SOURCE.CONTACT_OWNER) {
        return assignmentOptions.find((o) => o.id === v)?.name ?? v;
      }
      if (source === FILTER_SOURCE.CONTACT_RESULT) {
        return resultCodeOptions.find((o) => o.code === v)?.label ?? v;
      }
      if (source === FILTER_SOURCE.WEB) {
        return webFilterOptionsFor([v]).find((o) => o.value === v)?.label ?? v;
      }
      if (source === FILTER_SOURCE.EMAIL) {
        return MAIL_FILTER_OPTIONS.find((o) => o.value === v)?.label ?? v;
      }
      return v;
    };
    return (
      <div
        id={inputId}
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5"
      >
        {multi.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
          >
            {labelOf(v)}
            <button
              type="button"
              aria-label={`${labelOf(v)} 빼기`}
              className="text-blue-400 hover:text-blue-700"
              onClick={() => onChange(encodeMultiClauseValue(multi.filter((x) => x !== v)))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    );
  }

  if (source === FILTER_SOURCE.CONTACT_OWNER) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="w-[260px] h-10">
          <SelectValue placeholder="컨택원 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {withNoneOption(assignmentOptions.map((o) => ({ value: o.id, label: o.name }))).map(
            (o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    );
  }

  if (source === FILTER_SOURCE.CONTACT_RESULT) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="w-[260px] h-10">
          <SelectValue placeholder="결과코드 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {contactResultFilterOptions(resultCodeOptions).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (source === FILTER_SOURCE.EMAIL) {
    return (
      <Select value={value || 'delivered'} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="w-[260px] h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MAIL_FILTER_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (source === FILTER_SOURCE.WEB) {
    // 레거시 값 노출 규칙은 webFilterOptionsFor 주석 참조. 사용자가 새 옵션을
    // 고르는 순간부터 레거시 항목은 목록에서 사라진다.
    return (
      <Select value={value || 'completed'} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="w-[260px] h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {webFilterOptionsFor(value ? [value] : []).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (isIdListSource(source)) {
    // 시스템ID / attrs — 엑셀 열 붙여넣기 ID 목록 입력 (인식 개수·경고 표시)
    return (
      <IdListInput
        source={source}
        value={value}
        onChange={onChange}
        placeholder={placeholderFor(source)}
        {...(inputId !== undefined ? { inputId } : {})}
        {...(surveyId !== undefined ? { surveyId } : {})}
        autoGrow={idListAutoGrow}
      />
    );
  }

  return (
    <Input
      id={inputId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholderFor(source)}
      className="w-[260px] h-10"
    />
  );
}
