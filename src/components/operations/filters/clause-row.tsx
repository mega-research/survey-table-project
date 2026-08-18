'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type ColumnCandidate } from '@/lib/operations/filter-shared';

import { PiiExactMarker } from '@/components/operations/filter-pii-marker';

import type { RenderValueWidget } from './filter-bar-core';

export interface ClauseRowValue {
  /** 안정 key — 행 제거·재추가 시 React 가 다른 행과 state 를 혼동하지 않도록 id 부여. */
  id: string;
  op: 'AND' | 'OR';
  source: string;
  value: string;
}

interface Props {
  clause: ClauseRowValue;
  columnCandidates: ColumnCandidate[];
  renderValueWidget: RenderValueWidget;
  /** source 변경 시 초기 value (예: 조사 대상 web 은 'completed'). 기본 ''. */
  defaultValueForSource: (source: string) => string;
  onChange: (next: ClauseRowValue) => void;
  onRemove: () => void;
  index: number;
}

export function ClauseRow({
  clause,
  columnCandidates,
  renderValueWidget,
  defaultValueForSource,
  onChange,
  onRemove,
  index,
}: Props) {
  return (
    <div
      className="mb-2 flex items-center gap-2"
      role="group"
      aria-label={`조건 ${index + 2}`}
    >
      <Select
        value={clause.op}
        onValueChange={(v) => onChange({ ...clause, op: v as 'AND' | 'OR' })}
      >
        <SelectTrigger className="h-10 w-[88px] font-bold text-blue-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AND">AND</SelectItem>
          <SelectItem value="OR">OR</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={clause.source}
        onValueChange={(s) =>
          // source 변경 시 이전 mode 의 value 는 의미 없음 — 페이지별 기본값으로 초기화.
          onChange({ ...clause, source: s, value: defaultValueForSource(s) })
        }
      >
        <SelectTrigger className="h-10 w-[180px]">
          <SelectValue placeholder="컬럼 선택" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {columnCandidates.map((c) => (
            <SelectItem key={c.source} value={c.source}>
              {c.label}
              <PiiExactMarker source={c.source} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {renderValueWidget({
        source: clause.source,
        value: clause.value,
        onChange: (v) => onChange({ ...clause, value: v }),
      })}
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        ×
      </Button>
    </div>
  );
}
