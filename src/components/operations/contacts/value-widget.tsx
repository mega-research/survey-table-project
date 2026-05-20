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
import { FILTER_SOURCE, placeholderFor } from '@/lib/operations/filter-shared';

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
        <SelectContent>
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
    return (
      <Select value={value || 'true'} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="w-[260px] h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">응답 완료</SelectItem>
          <SelectItem value="false">미응답</SelectItem>
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
