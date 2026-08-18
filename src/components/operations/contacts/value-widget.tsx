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
import { FILTER_SOURCE, WEB_FILTER_OPTIONS, placeholderFor } from '@/lib/operations/filter-shared';

interface Props {
  source: string;
  value: string;
  onChange: (v: string) => void;
  resultCodeOptions: ContactResultCode[];
  inputId?: string;
}

/**
 * 컬럼 source 에 따라 다른 입력 위젯 렌더.
 * - system.contact_result -> 결과코드 dropdown
 * - system.web -> 응답 완료/미응답 dropdown
 * - 그 외 (system.resid / attrs.* / pii.*) -> text input
 */
export function ValueWidget({ source, value, onChange, resultCodeOptions, inputId }: Props) {
  if (source === FILTER_SOURCE.CONTACT_RESULT) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="w-[260px] h-10">
          <SelectValue placeholder="결과코드 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {resultCodeOptions.map((rc) => (
            <SelectItem key={rc.code} value={rc.code}>
              {rc.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (source === FILTER_SOURCE.WEB) {
    // 레거시 URL 값 표시 정규화 — 'true'(응답완료)는 completed, 'false'(미완료 전체)는
    // 가장 가까운 none 으로 보이게 한다. 재적용 시점부터 새 상태 의미로 검색된다.
    const normalized =
      value === 'true' ? 'completed' : value === 'false' ? 'none' : value;
    return (
      <Select value={normalized || 'completed'} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="w-[260px] h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEB_FILTER_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
