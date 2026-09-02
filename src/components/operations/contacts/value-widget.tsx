'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ContactResultCode } from '@/db/schema/schema-types';
import {
  contactResultFilterOptions,
  FILTER_SOURCE,
  MAIL_FILTER_OPTIONS,
  placeholderFor,
  webFilterOptionsFor,
} from '@/lib/operations/filter-shared';
import { isIdListSource } from '@/lib/operations/id-list-paste';

import { IdListInput } from './id-list-input';

interface Props {
  source: string;
  value: string;
  onChange: (v: string) => void;
  resultCodeOptions: ContactResultCode[];
  inputId?: string;
}

/**
 * 컬럼 source 에 따라 다른 입력 위젯 렌더.
 * - system.contact_result -> 결과코드 dropdown (+ "결과 없음")
 * - system.web -> 응답 완료/미응답 dropdown
 * - system.resid / attrs.* -> ID 목록 입력 (IdListInput — 엑셀 붙여넣기·인식 개수·경고)
 * - 그 외 (pii.*) -> text input
 */
export function ValueWidget({ source, value, onChange, resultCodeOptions, inputId }: Props) {
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
