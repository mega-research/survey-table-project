'use client';

import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useSurveyBuilderStore } from '@/stores/survey-store';

const CUSTOM_SENTINEL = '__custom__';
const NONE_SENTINEL = '__none__';

interface Props {
  /** LUT 가 제공하는 모든 컬럼 (사용자가 키로 픽 가능한 후보) */
  availableLutColumns: string[];
  /** 현재 설정된 키 매핑. 각 row 는 "LUT 컬럼 X = 컨택 attrs Y 와 같아야 한다" 를 의미. */
  value: Array<{ lutKey: string; attrsKey: string }>;
  onChange: (next: Array<{ lutKey: string; attrsKey: string }>) => void;
}

/**
 * LUT 의 어떤 컬럼을 키로 쓸지 + 각 키를 어떤 컨택 attrs 와 매칭할지 정의.
 *
 * 키 row 를 자유롭게 추가/삭제할 수 있다. 같은 LUT 컬럼을 두 번 매핑하는 것도 가능
 * (실용성은 없지만 막지 않음 — 평가는 마지막 매핑이 유효한 식으로 동작).
 *
 * LUT 의 keyColumns 정의에 종속되지 않음 — 사용자가 조건마다 어떤 컬럼을 키로 쓸지 결정.
 */
export function LookupKeyMappingEditor({ availableLutColumns, value, onChange }: Props) {
  const contactColumns = useSurveyBuilderStore(
    (s) => s.currentSurvey.contactColumns?.columns ?? [],
  );

  const handleSetLutKey = (idx: number, lutKey: string) => {
    onChange(value.map((row, i) => (i === idx ? { ...row, lutKey } : row)));
  };

  const handleSetAttrsKey = (idx: number, attrsKey: string) => {
    onChange(value.map((row, i) => (i === idx ? { ...row, attrsKey } : row)));
  };

  const handleDelete = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleAdd = () => {
    // 아직 매핑되지 않은 첫 LUT 컬럼을 디폴트로
    const used = new Set(value.map((r) => r.lutKey));
    const unused = availableLutColumns.find((c) => !used.has(c)) ?? '';
    onChange([...value, { lutKey: unused, attrsKey: '' }]);
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">키 컬럼 매칭</div>
      <div className="text-muted-foreground text-xs">
        LUT 의 어떤 컬럼이 어떤 컨택 attrs 와 같아야 행을 매칭할지 정합니다. 여러 줄이면 모두 AND.
      </div>

      {value.length === 0 && (
        <div className="text-xs text-amber-600">
          키가 1개 이상 필요합니다. 아래 "키 추가" 로 등록하세요.
        </div>
      )}

      {value.map((row, idx) => {
        const isInColumns = contactColumns.some((c) => c.key === row.attrsKey);
        const selectorValue = row.attrsKey && isInColumns ? row.attrsKey : CUSTOM_SENTINEL;
        return (
          <div
            key={idx}
            className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2"
          >
            <Select
              value={row.lutKey || NONE_SENTINEL}
              onValueChange={(v) => handleSetLutKey(idx, v === NONE_SENTINEL ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="LUT 컬럼 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL} disabled>
                  — 미선택 —
                </SelectItem>
                {availableLutColumns.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">=</span>
            <div className="flex items-center gap-1">
              <Select
                value={selectorValue}
                onValueChange={(v) =>
                  handleSetAttrsKey(idx, v === CUSTOM_SENTINEL ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="컨택 attrs" />
                </SelectTrigger>
                <SelectContent>
                  {contactColumns.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label ?? c.key}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_SENTINEL}>직접 입력…</SelectItem>
                </SelectContent>
              </Select>
              {!isInColumns && (
                <Input
                  value={row.attrsKey}
                  placeholder="attrs 키"
                  onChange={(e) => handleSetAttrsKey(idx, e.target.value)}
                  className="w-32"
                />
              )}
            </div>
            <button
              onClick={() => handleDelete(idx)}
              className="text-gray-400 hover:text-red-500"
              aria-label="키 삭제"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      <Button variant="outline" size="sm" onClick={handleAdd}>
        <Plus size={14} className="mr-1" /> 키 추가
      </Button>

      {value.some(
        (r) => r.attrsKey && !contactColumns.some((c) => c.key === r.attrsKey),
      ) && (
        <div className="text-xs text-amber-600">
          컨택 컬럼에 없는 attrs 키가 포함돼 있습니다. 응답 시 해당 키가 비어있으면 fail-safe SHOW 됩니다.
        </div>
      )}
    </div>
  );
}
