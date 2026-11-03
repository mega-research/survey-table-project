import { ChevronDown } from 'lucide-react';

import { LocalDateTime } from '@/components/ui/local-date-time';
import {
  describeContactTargetEditChange,
  summarizeContactTargetEdit,
} from '@/lib/operations/contact-target-edit-format';
import type { ContactTargetEditLogRow } from '@/shared/contracts/contacts-io';

interface Props {
  /** 최신순 기록 — 읽기 로더가 이 화면이 볼 변경만 담아 넘긴다(게스트면 컨택원 변경 없음). */
  rows: ContactTargetEditLogRow[];
}

/**
 * 「대상 정보 수정 현황」 — 조사 대상 상세에서 명단 값·메모·컨택 방법·컨택원·회차를 손으로 바꾼 기록.
 * 기본 접힘. 한 줄은 누가·언제·요약(「… 외 N개」)이고, 줄을 펼치면 변경 하나당 한 줄로 전체 값이 보인다.
 * 값은 글자로만 그린다(HTML 해석 없음).
 */
export function ContactTargetEditHistoryCard({ rows }: Props) {
  return (
    <details className="group rounded-lg border bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          대상 정보 수정 현황 ({rows.length}건)
          <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t px-5 py-3">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">수정 이력이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <div className="text-sm text-slate-700">{r.editorEmail ?? '관리자'}</div>
                <details className="group/row text-xs text-slate-500">
                  <summary className="flex cursor-pointer items-center gap-1 [&::-webkit-details-marker]:hidden">
                    <span className="shrink-0">
                      <LocalDateTime value={r.createdAt} /> ·
                    </span>
                    <span className="min-w-0 truncate">
                      {summarizeContactTargetEdit(r.changes)}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-slate-400 transition-transform group-open/row:rotate-180" />
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {r.changes.map((c, i) => (
                      <li key={i} className="break-all whitespace-pre-wrap text-slate-600">
                        {describeContactTargetEditChange(c)}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          명단 업로드·컨택원 일괄 배정으로 바뀐 값은 여기에 남지 않습니다.
        </p>
      </div>
    </details>
  );
}
