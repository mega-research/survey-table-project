'use client';

/**
 * 숫자 입력 표시 포맷·범위 설정 공용 폼 (단답형 question-basic-tab + 셀 cell-content-modal).
 * 빈 설정(모든 필드 미지정)은 undefined 로 정규화해 JSONB 에 빈 객체가 저장되지 않게 한다.
 *
 * exactOptionalPropertyTypes 대응: NumberFormat 의 optional 필드는 "값이 있거나 키가 아예
 * 없거나" 만 허용되고 `key: undefined` 리터럴은 타입 에러가 난다. 그래서 필드를 지울 때는
 * `{ key: undefined }` 대신 구조분해로 키 자체를 제거한 뒤(rest) 스프레드한다.
 */

import type { ChangeEvent } from 'react';

import { Input } from '@/components/ui/input';
import type { NumberFormat, NumberUnit } from '@/types/survey';
import { UNIT_LABELS } from '@/utils/number-format';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

const UNIT_OPTIONS: Array<{ value: NumberUnit | ''; label: string }> = [
  { value: '', label: '기본' },
  ...(Object.entries(UNIT_LABELS) as Array<[NumberUnit, string]>).map(([value, label]) => ({
    value,
    label,
  })),
];

const DECIMAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '제한 없음' },
  { value: '0', label: '정수만' },
  { value: '1', label: '소수 1자리' },
  { value: '2', label: '소수 2자리' },
  { value: '3', label: '소수 3자리' },
];

interface Props {
  value: NumberFormat | undefined;
  onChange: (next: NumberFormat | undefined) => void;
  idPrefix: string; // 같은 화면에 두 번 렌더될 때 input id 충돌 방지
}

function normalize(nf: NumberFormat): NumberFormat | undefined {
  const isEmpty =
    !nf.thousandSeparator &&
    nf.unit === undefined &&
    nf.min === undefined &&
    nf.max === undefined &&
    nf.decimalPlaces === undefined;
  return isEmpty ? undefined : nf;
}

export function NumberFormatFields({ value, onChange, idPrefix }: Props) {
  const nf: NumberFormat = value ?? {};
  const emit = (next: NumberFormat) => onChange(normalize(next));

  const handleThousandSeparatorChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      emit({ ...nf, thousandSeparator: true });
      return;
    }
    const { thousandSeparator: _drop, ...rest } = nf;
    emit(rest);
  };

  const handleUnitChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const raw = e.target.value as NumberUnit | '';
    if (raw === '') {
      const { unit: _drop, ...rest } = nf;
      emit(rest);
      return;
    }
    const next: NumberFormat = { ...nf, unit: raw };
    // % 선택 시 min/max 미설정이면 0~100 프리셋 (수정 가능 — 증감률 등 음수 허용은 min 을 지운다)
    if (raw === 'percent') {
      if (next.max === undefined) next.max = 100;
      if (next.min === undefined) next.min = 0;
    }
    emit(next);
  };

  const handleDecimalPlacesChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === '') {
      const { decimalPlaces: _drop, ...rest } = nf;
      emit(rest);
      return;
    }
    emit({ ...nf, decimalPlaces: Number(v) });
  };

  // min/max 입력: 빈 값 = 해제, 완성 숫자만 커밋 (emptyDefault 입력과 동일 관례)
  const numberField = (key: 'min' | 'max', label: string) => {
    const current = nf[key];
    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (v === '') {
        if (key === 'min') {
          const { min: _drop, ...rest } = nf;
          emit(rest);
        } else {
          const { max: _drop, ...rest } = nf;
          emit(rest);
        }
        return;
      }
      if (!isPartialNumericInput(v)) return;
      const n = parseNumericInput(v);
      if (n === null) return;
      emit(key === 'min' ? { ...nf, min: n } : { ...nf, max: n });
    };
    return (
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-gray-600">{label}</span>
        <Input
          type="text"
          inputMode="decimal"
          value={current !== undefined ? String(current) : ''}
          onChange={handleChange}
          className="h-8 w-20"
          aria-label={label}
        />
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`${idPrefix}-thousand-separator`}
          checked={!!nf.thousandSeparator}
          onChange={handleThousandSeparatorChange}
          className="h-4 w-4"
        />
        <label htmlFor={`${idPrefix}-thousand-separator`} className="cursor-pointer">
          천단위 콤마 표시
        </label>
        <span className="text-xs text-gray-400">화면 표시 전용, 저장값은 숫자만</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-gray-600">단위</span>
          <select
            value={nf.unit ?? ''}
            onChange={handleUnitChange}
            className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm"
            aria-label="단위"
          >
            {UNIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {numberField('min', '최소')}
        {numberField('max', '최대')}
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-gray-600">소수 자릿수</span>
          <select
            value={nf.decimalPlaces !== undefined ? String(nf.decimalPlaces) : ''}
            onChange={handleDecimalPlacesChange}
            className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm"
            aria-label="소수 자릿수"
          >
            {DECIMAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
