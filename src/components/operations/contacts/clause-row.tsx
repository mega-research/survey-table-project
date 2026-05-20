'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ContactResultCode } from '@/db/schema/schema-types';

import { ValueWidget } from './value-widget';

interface ColumnCandidate {
  source: string;
  label: string;
}

export interface ClauseRowValue {
  op: 'AND' | 'OR';
  source: string;
  value: string;
}

interface Props {
  clause: ClauseRowValue;
  columnCandidates: ColumnCandidate[];
  resultCodeOptions: ContactResultCode[];
  onChange: (next: ClauseRowValue) => void;
  onRemove: () => void;
  index: number;
}

export function ClauseRow({
  clause,
  columnCandidates,
  resultCodeOptions,
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
        <SelectTrigger className="h-9 w-[70px] font-bold text-blue-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AND">AND</SelectItem>
          <SelectItem value="OR">OR</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={clause.source}
        onValueChange={(s) => onChange({ ...clause, source: s, value: '' })}
      >
        <SelectTrigger className="h-10 w-[180px]">
          <SelectValue placeholder="컬럼 선택" />
        </SelectTrigger>
        <SelectContent>
          {columnCandidates.map((c) => (
            <SelectItem key={c.source} value={c.source}>
              {c.label}
              {c.source.startsWith('pii.') && (
                <span className="ml-1 text-xs text-muted-foreground">(정확 일치)</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ValueWidget
        source={clause.source}
        value={clause.value}
        onChange={(v) => onChange({ ...clause, value: v })}
        resultCodeOptions={resultCodeOptions}
      />
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        ×
      </Button>
    </div>
  );
}
