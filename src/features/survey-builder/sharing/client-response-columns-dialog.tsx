'use client';

import { useState } from 'react';

import { ORPCError } from '@orpc/client';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import { CLIENT_RESPONSE_FIRST_COLUMN_KEY } from '@/shared/contracts/workspace';
import type {
  ClientResponseColumnCandidateView,
  ClientResponseColumnsOutput,
} from '@/shared/contracts/workspace-io';

import {
  useClientResponseColumns,
  useSetClientResponseColumns,
} from '../queries/use-survey-access-link';

interface Props {
  surveyId: string;
  onClose: () => void;
}

const KIND_LABEL: Record<ClientResponseColumnCandidateView['kind'], string> = {
  sys: '응답 정보',
  entry: '이어 넘길 값',
  attrs: '명단',
  answer: '응답값',
};

/**
 * 클라이언트 링크 응답 내역의 「열 설정」 (`.scratch/client-link-response-list` 티켓 04).
 *
 * 내부 응답 내역의 컬럼 설정과 **따로** 고른다. 후보는 서버가 정한다 — 개인정보 열·암호화 저장
 * 응답 칸·IP 해시는 후보에서부터 빠져 있어 화면이 거를 일이 없다. 순번은 언제나 첫 열이고 뺄 수
 * 없다.
 *
 * 저장은 불러온 `version` 과 함께 간다. 그 사이 다른 연구원이 먼저 저장했으면 서버가 CONFLICT 로
 * 거부하고, 화면은 새로 불러온 설정으로 다시 그린다 — 남이 뺀 열이 이 화면의 저장으로 되살아나지
 * 않는다. 고른 것을 다시 고르는 일은 연구원에게 남긴다.
 */
export function ClientResponseColumnsDialog({ surveyId, onClose }: Props) {
  const { data, isPending, isError } = useClientResponseColumns(surveyId, true);
  /** 충돌 뒤 새로 불러왔다는 안내 — 편집 칸이 새 version 으로 다시 열려도 남아야 한다. */
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[480px] gap-0 rounded-2xl p-[22px]">
        <DialogTitle className="text-[17px] font-semibold text-[#1C1C1E]">
          응답 내역 열 설정
        </DialogTitle>
        <DialogDescription className="mt-1 text-[12px] leading-[1.5] text-[#6E6E73]">
          클라이언트가 보는 응답 내역의 열입니다. 내부 응답 내역의 컬럼 설정과 따로 저장됩니다.
          개인정보 열·암호화 저장 응답 칸·IP 해시는 클라이언트에게 보일 수 없어 목록에 없습니다.
        </DialogDescription>

        {isPending ? (
          <div className="flex items-center gap-2 py-6 text-[12px] text-[#9CA3AF]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            불러오는 중…
          </div>
        ) : isError || !data ? (
          <p className="py-6 text-[12px] text-[#DC2626]">열 설정을 불러오지 못했습니다.</p>
        ) : (
          // version 이 바뀌면(남의 저장을 새로 불러오면) 편집 칸을 새 값으로 다시 연다.
          <ColumnsEditor
            key={data.version}
            surveyId={surveyId}
            data={data}
            notice={notice}
            onConflict={setNotice}
            onSaved={onClose}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ColumnsEditor({
  surveyId,
  data,
  notice,
  onConflict,
  onSaved,
  onCancel,
}: {
  surveyId: string;
  data: ClientResponseColumnsOutput;
  notice: string | null;
  onConflict: (message: string) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [keys, setKeys] = useState<string[]>(data.keys);
  const [error, setError] = useState<string | null>(null);
  const save = useSetClientResponseColumns();

  const byKey = new Map(data.candidates.map((c) => [c.key, c]));
  const chosen = keys.flatMap((key) => {
    const candidate = byKey.get(key);
    return candidate ? [candidate] : [];
  });
  const rest = data.candidates.filter((c) => !keys.includes(c.key));

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    // 순번(0번 자리)과는 자리를 바꾸지 않는다 — 언제나 첫 열이다.
    if (target < 1 || target >= keys.length) return;
    const next = [...keys];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setKeys(next);
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ surveyId, keys, expectedVersion: data.version });
      onSaved();
    } catch (err) {
      if (err instanceof ORPCError && err.code === 'CONFLICT') {
        // 무효화가 새 설정을 다시 읽어 오고, 새 version 으로 이 편집 칸이 다시 열린다.
        onConflict(getErrorMessage(err, '다른 사람이 먼저 열 설정을 바꿨습니다.'));
        return;
      }
      setError(getErrorMessage(err, '열 설정을 저장하지 못했습니다.'));
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {notice && (
        <p role="status" className="rounded-[8px] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
          {notice}
        </p>
      )}

      <section className="flex flex-col gap-1">
        <h3 className="text-[12px] font-medium text-[#374151]">보이는 열 (순서대로)</h3>
        <ul className="flex flex-col gap-1">
          {chosen.map((c, index) => {
            const fixed = c.key === CLIENT_RESPONSE_FIRST_COLUMN_KEY;
            return (
              <li
                key={c.key}
                className="flex items-center gap-2 rounded-[8px] border border-[#E5E5EA] px-2.5 py-1.5"
              >
                <input
                  type="checkbox"
                  checked
                  disabled={fixed}
                  aria-label={`${c.label} 빼기`}
                  onChange={() => setKeys(keys.filter((key) => key !== c.key))}
                />
                <ColumnName candidate={c} />
                {fixed ? (
                  <span className="text-[11px] text-[#9CA3AF]">언제나 첫 열</span>
                ) : (
                  <span className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label={`${c.label} 위로`}
                      disabled={index <= 1}
                      onClick={() => move(index, -1)}
                      className="rounded p-1 text-[#6E6E73] hover:bg-[#F3F4F6] disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${c.label} 아래로`}
                      disabled={index >= chosen.length - 1}
                      onClick={() => move(index, 1)}
                      className="rounded p-1 text-[#6E6E73] hover:bg-[#F3F4F6] disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {rest.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-[12px] font-medium text-[#374151]">더할 수 있는 열</h3>
          <ul className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
            {rest.map((c) => (
              <li key={c.key} className="flex items-center gap-2 px-2.5 py-1">
                <input
                  type="checkbox"
                  checked={false}
                  aria-label={`${c.label} 더하기`}
                  onChange={() => setKeys([...keys, c.key])}
                />
                <ColumnName candidate={c} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="text-[12px] text-[#DC2626]">{error}</p>}

      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-[8px] border border-[#D1D5DB] px-3 text-[13px] text-[#374151]"
        >
          취소
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => void submit()}
          className="flex h-9 items-center gap-1.5 rounded-[8px] bg-[#3b82f6] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#2563eb] disabled:bg-[#9CA3AF]"
        >
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          저장
        </button>
      </div>
    </div>
  );
}

function ColumnName({ candidate }: { candidate: ClientResponseColumnCandidateView }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="truncate text-[13px] text-[#1C1C1E]">{candidate.label}</span>
      <span className="shrink-0 text-[11px] text-[#9CA3AF]">
        {candidate.varName ?? KIND_LABEL[candidate.kind]}
      </span>
    </span>
  );
}
