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

import { PiiExactMarker } from '@/features/operations/filter-pii-marker';

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
  /** stack 첫 줄 — AND/OR 대신 「조건」 라벨을 그린다 (결합 연산자가 없는 자리). */
  first?: boolean;
  /** 값 칸이 여러 줄로 자라는 화면 — 열 선택을 줄 맨 위에 붙인다. */
  alignTop?: boolean;
}

export function ClauseRow({
  clause,
  columnCandidates,
  renderValueWidget,
  defaultValueForSource,
  onChange,
  onRemove,
  index,
  first = false,
  alignTop = false,
}: Props) {
  return (
    <div
      className={`mb-2 flex gap-2 ${alignTop ? 'items-start' : 'items-center'}`}
      role="group"
      aria-label={`조건 ${index + 2}`}
    >
      {first ? (
        <span className="w-[88px] shrink-0 px-3 text-sm leading-10 text-slate-500">조건</span>
      ) : (
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
      )}
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
