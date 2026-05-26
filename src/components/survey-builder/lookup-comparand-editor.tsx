'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { RightOperand, SurveyLookup } from '@/types/survey';

import { LookupKeyMappingEditor } from './lookup-key-mapping-editor';
import { LookupSelector } from './lookup-selector';
import { NONE_SENTINEL } from './lookup-shared';

type LookupOperand = Extract<RightOperand, { kind: 'lookup' }>;

// selector 안에서 ?? [] 하면 매 렌더마다 새 빈 배열 → useSyncExternalStore 무한 루프 경고.
// 모듈 스코프 안정 참조 fallback.
const EMPTY_LOOKUPS: SurveyLookup[] = [];

interface Props {
  value: LookupOperand;
  onChange: (next: LookupOperand) => void;
}

/**
 * 분기 조건 우변에서 "LUT 룩업" 를 선택했을 때 노출되는 에디터.
 *
 * 구성:
 *  1. LookupSelector — 비교 대상 LUT 를 선택 (현재 설문에 등록된 사본 목록).
 *  2. LookupKeyMappingEditor — LUT 의 컬럼 중 키로 쓸 것을 자유롭게 픽 + 각 키를 컨택 attrs 와 매핑.
 *  3. valueColumn 선택 — 키로 쓰지 않은 나머지 컬럼 중에서 비교에 쓸 컬럼을 픽.
 *
 * 이전 모델과 차이: LUT 가 keyColumns/valueColumns 를 미리 정의하지 않는다. 모든 의미는 여기서 결정.
 */
export function LookupComparandEditor({ value, onChange }: Props) {
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.lookups) ?? EMPTY_LOOKUPS;
  const selected = lookups.find((l) => l.id === value.surveyLookupId);

  // 키로 이미 사용된 LUT 컬럼은 값 컬럼 후보에서 제외 (의미상 같은 컬럼을 키와 값으로 쓰면 항상 일치)
  const usedAsKey = new Set(value.keyMapping.map((m) => m.lutKey).filter(Boolean));
  const valueCandidates = (selected?.columns ?? []).filter((c) => !usedAsKey.has(c));

  return (
    <div className="space-y-3 rounded border bg-gray-50/50 p-3">
      <div className="text-sm font-medium">외부 데이터 룩업</div>

      <LookupSelector
        value={value.surveyLookupId}
        onChange={(id) =>
          onChange({
            ...value,
            surveyLookupId: id,
            // LUT 가 바뀌면 키 매핑과 값 컬럼을 리셋 (이전 LUT 의 컬럼 이름이 안 맞을 수 있음)
            keyMapping: [],
            valueColumn: '',
          })
        }
      />

      {selected && (
        <>
          <LookupKeyMappingEditor
            availableLutColumns={selected.columns}
            value={value.keyMapping}
            onChange={(km) => {
              // 키 변경으로 valueColumn 이 키와 중복되면 valueColumn 도 비움
              const newUsed = new Set(km.map((m) => m.lutKey).filter(Boolean));
              const nextValueColumn = newUsed.has(value.valueColumn) ? '' : value.valueColumn;
              onChange({ ...value, keyMapping: km, valueColumn: nextValueColumn });
            }}
          />

          <div className="space-y-1">
            <div className="text-sm font-medium">비교 대상 값 컬럼</div>
            {selected.columns.length === 0 ? (
              <div className="text-xs text-amber-600">
                선택한 LUT 에 컬럼이 없습니다. LUT 편집에서 컬럼을 1개 이상 추가하세요.
              </div>
            ) : valueCandidates.length === 0 ? (
              <div className="text-xs text-amber-600">
                모든 컬럼이 키로 사용 중입니다. 비교할 컬럼이 남도록 키를 줄이거나 LUT 에 컬럼을 추가하세요.
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
                  {valueCandidates.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
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
