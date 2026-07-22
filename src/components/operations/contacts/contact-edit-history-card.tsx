import { LocalDateTime } from '@/components/ui/local-date-time';
import type { ResponseEditChange } from '@/db/schema/schema-types';
import type { ResponseEditLogRow } from '@/lib/operations/contacts.server';

/** 바뀐 질문 요약 — 앞 3개 code/title + "외 N개". */
function summarizeChanges(changes: ResponseEditChange[], count: number): string {
  const labels = changes.slice(0, 3).map((c) => c.code ?? c.title);
  const head = labels.join(', ');
  if (count <= 3) return head ? `${head} 수정` : '응답 수정';
  return `${head} 외 ${count - 3}개 수정`;
}

interface Props {
  rows: ResponseEditLogRow[];
  /** 매칭된 응답이 있는지 (없으면 "매칭된 응답 없음" 안내). */
  hasResponse: boolean;
}

/** 응답 편집 audit 이력 — 기본 접힘 collapsible. */
export function ContactEditHistoryCard({ rows, hasResponse }: Props) {
  return (
    <details open={hasResponse} className="rounded-lg border bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm">
        <span className="font-medium text-slate-700">
          수정 / 편집 현황 ({rows.length}건)
        </span>
      </summary>
      <div className="border-t px-5 py-3">
        {!hasResponse ? (
          <p className="text-sm text-slate-400">매칭된 응답이 없습니다.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">수정 이력이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="border-b border-slate-100 pb-2 last:border-0 last:pb-0"
              >
                <div className="text-sm text-slate-700">{r.editorEmail ?? '관리자'}</div>
                <div className="text-xs text-slate-500">
                  <LocalDateTime value={r.createdAt} /> ·{' '}
                  {summarizeChanges(r.changedQuestions, r.changedCount)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
