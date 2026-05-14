'use client';

import { useMemo } from 'react';

import { AlertTriangle } from 'lucide-react';

import { extractVariableKeys } from '@/lib/mail/variable-extractor';
import type { VariableDef } from '@/components/operations/mail-template/variable-catalog';
import type { Question } from '@/types/survey';

interface Props {
  questions: Question[];
  catalog: VariableDef[];
}

/**
 * 본문에 사용된 토큰 키 중 contact_columns 카탈로그에 없는 키 경고.
 * - hard error 아님 — 발송 시 빈 문자열로 치환되므로 동작은 가능
 * - 사용자가 의도적으로 빈 값 처리할 수도 있어 발행은 차단하지 않음
 */
export function TokenWarningPanel({ questions, catalog }: Props) {
  const knownKeys = useMemo(
    () => new Set(catalog.filter((v) => v.category === 'attrs').map((v) => v.key)),
    [catalog],
  );

  const usedKeys = useMemo(() => {
    const sources: string[] = [];
    for (const q of questions) {
      if (q.description) sources.push(q.description);
      if (q.noticeContent) sources.push(q.noticeContent);
      if (q.defaultValueTemplate) sources.push(q.defaultValueTemplate);
      if (q.tableRowsData) {
        for (const row of q.tableRowsData) {
          for (const cell of row.cells) {
            if (cell.content) sources.push(cell.content);
            if (cell.defaultValueTemplate) sources.push(cell.defaultValueTemplate);
          }
        }
      }
    }
    return extractVariableKeys(...sources);
  }, [questions]);

  const unknown = usedKeys.filter((k) => !knownKeys.has(k));

  if (unknown.length === 0) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">컨택 컬럼에 없는 토큰 {unknown.length}개</div>
        <div className="mt-1 font-mono text-xs">
          {unknown.map((k) => `{{${k}}}`).join(', ')}
        </div>
        <div className="mt-1 text-xs">발송 시 빈 값으로 치환됩니다.</div>
      </div>
    </div>
  );
}
