'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { RightOperand } from '@/types/survey';

import { LookupKeyMappingEditor } from './lookup-key-mapping-editor';
import { LookupSelector } from './lookup-selector';

type LookupOperand = Extract<RightOperand, { kind: 'lookup' }>;

const NONE_SENTINEL = '__none__';

interface Props {
  value: LookupOperand;
  onChange: (next: LookupOperand) => void;
}

/**
 * 분기 조건 우변에서 "LUT 룩업" 를 선택했을 때 노출되는 에디터.
 *
 * 구성:
 *  1. LookupSelector — 비교 대상 LUT 를 선택 (현재 설문에 등록된 사본 목록).
 *  2. LookupKeyMappingEditor — 선택한 LUT 의 keyColumns 를 컨택 attrs 키와 매핑.
 *  3. valueColumn 선택 — LUT 가 가진 valueColumns 후보 중 비교에 쓸 컬럼을 픽.
 */
export function LookupComparandEditor({ value, onChange }: Props) {
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.lookups ?? []);
  const selected = lookups.find((l) => l.id === value.surveyLookupId);

  return (
    <div className="space-y-3 rounded border bg-gray-50/50 p-3">
      <div className="text-sm font-medium">외부 데이터 룩업</div>

      <LookupSelector
        value={value.surveyLookupId}
        onChange={(id, lookup) =>
          onChange({
            ...value,
            surveyLookupId: id,
            // LUT 가 바뀌면 키 매핑도 새 keyColumns 기준으로 초기화 + 값 컬럼도 첫 후보로 자동 선택.
            keyMapping: lookup.keyColumns.map((k) => ({
              lutKey: k,
              attrsKey: '',
            })),
            valueColumn: lookup.valueColumns[0] ?? '',
          })
        }
      />

      {selected && (
        <>
          <LookupKeyMappingEditor
            lutKeys={selected.keyColumns}
            value={value.keyMapping}
            onChange={(km) => onChange({ ...value, keyMapping: km })}
          />
          <div className="space-y-1">
            <div className="text-sm font-medium">비교 대상 값 컬럼</div>
            {selected.valueColumns.length === 0 ? (
              <div className="text-xs text-amber-600">
                선택한 LUT 에 값 컬럼이 없습니다. LUT 편집에서 값 컬럼을 1개 이상 추가하세요.
              </div>
            ) : (
              <Select
                value={value.valueColumn || NONE_SENTINEL}
                onValueChange={(v) =>
                  onChange({ ...value, valueColumn: v === NONE_SENTINEL ? '' : v })
                }
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="값 컬럼 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_SENTINEL} disabled>
                    — 미선택 —
                  </SelectItem>
                  {selected.valueColumns.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      )}
    </div>
  );
}
