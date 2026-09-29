'use client';

import { useEffect, useState } from 'react';

import { Loader2, Search } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import type { ParticipantCandidateItem } from '@/shared/contracts/workspace-io';

import {
  useAddSurveyParticipant,
  useParticipantCandidates,
} from '../queries/use-survey-participants';
import { FieldworkLinkPanel } from './fieldwork-link-panel';
import { SegmentRow, type SegmentOption } from './segment-row';

interface FieldworkBlockProps {
  surveyId: string;
}

/**
 * 공유 설정 모달의 실사 블록 — 실사를 맡기는 **두 방식** (ADR-0026, 티켓 04·10).
 *
 * 담당자가 「이 설문은 누가 뛰는가」를 한 곳에서 정한다. 방식이 둘인 이유는 인력의 성격이
 * 다르기 때문이다 — 사내 인력은 계정이 이미 있어 초대하면 되고, 외주는 단기 인력이 접속
 * 수단 하나를 돌려쓰므로 계정을 만들지 않고 전용 링크를 발급한다. 설문 하나에 둘을 함께
 * 쓰는 일은 없다.
 *
 * ## 「내부 실사원」은 **전용 모델이 아니다**
 *
 * 사내 실사원에게는 계정 유형도 전용 콘솔도 없다. 설문마다 **전체 권한 참여자**로 초대되어
 * 연구원과 같은 운영 콘솔에서 일한다(스펙 §11, 스토리 48~51) — 그래서 이 자리는 참여자
 * 블록과 **같은 RPC** 를 쓴다. 실사팀 소속도 묻지 않는다: 실사팀은 그냥 팀이고, 어느 팀
 * 사람이든 초대된다.
 *
 * **목록을 여기 다시 그리지 않는다.** 추가된 사람은 위 「참여자 — 직원」 목록의 행이 되고,
 * 등급 배지(0123 의 `limited`)와 「제외」 버튼도 거기 있다. 같은 행을 한 모달에 두 번 그리면
 * 어느 쪽이 정본인지 알 수 없고, 한쪽만 고쳐지는 날이 온다.
 *
 * ## 옛 실사 계정 초대가 여기 있었다
 *
 * 이 자리는 티켓 25 까지 `users.user_type='fieldwork'` 계정을 개인 단위로 붙이는 UI 였다.
 * ADR-0026 이 그 모델을 링크로 대체하면서 **입구를 잃었다** — 표면(`workspace.fieldwork.*`)은
 * 공존 창 동안 그대로 돌지만 새 초대를 만들 화면이 없다. 철거는 별도 스펙이다(PRD §12).
 */
export function FieldworkBlock({ surveyId }: FieldworkBlockProps) {
  const [mode, setMode] = useState<FieldworkMode>('internal');

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#374151]">실사 조사원</span>

      <SegmentRow label="실사 방식" options={FIELDWORK_MODES} value={mode} onChange={setMode} />

      {mode === 'outsourced' ? (
        <FieldworkLinkPanel surveyId={surveyId} />
      ) : (
        <InternalFieldworkSection surveyId={surveyId} />
      )}
    </div>
  );
}

/** 실사를 맡기는 방식 둘. 설문 하나에 둘을 함께 쓰는 일은 없다. */
type FieldworkMode = 'internal' | 'outsourced';

const FIELDWORK_MODES: ReadonlyArray<SegmentOption<FieldworkMode>> = [
  { value: 'internal', label: '내부 실사원' },
  { value: 'outsourced', label: '외주' },
];

/**
 * 사내 계정을 전체 권한 참여자로 초대한다 — **참여자 블록의 두 번째 입구**.
 *
 * 컴포넌트를 갈라 둔 것은 입력 상태 때문이다. 세그먼트를 오갈 때 이 조각이 통째로 언마운트
 * 되므로 검색어가 남지 않는다 — 부모에 상태를 두면 외주 패널을 보고 돌아왔을 때 지난 검색이
 * 떠 있고, 그 목록은 이미 낡았을 수 있다.
 */
function InternalFieldworkSection({ surveyId }: { surveyId: string }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  // 타이핑마다 전사 명부를 왕복하지 않는다 — 참여자 블록과 같은 250ms.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // 검색어가 있을 때만 후보를 부른다 — 세그먼트를 여는 것만으로 전 사용자 명부를 당기지 않는다.
  const candidates = useParticipantCandidates(surveyId, debounced, debounced.length > 0);
  const addParticipant = useAddSurveyParticipant();

  async function handleAdd(candidate: ParticipantCandidateItem) {
    setError(null);
    try {
      await addParticipant.mutateAsync({ surveyId, userId: candidate.userId });
      setQuery('');
      setAdded(candidate.name);
    } catch (err) {
      setAdded(null);
      setError(getErrorMessage(err, '내부 실사원을 초대하지 못했습니다.'));
    }
  }

  return (
    <>
      <div className="relative">
        <div className="flex h-8 items-center gap-2 rounded-[8px] border border-[#D1D5DB] bg-white px-3">
          <Search className="h-[13px] w-[13px] shrink-0 text-[#9CA3AF]" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
              setAdded(null);
            }}
            placeholder="이름·이메일 검색 · 재직 중인 직원 (팀 무관)"
            className="h-full w-full bg-transparent text-[12px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:outline-none"
          />
          {candidates.isFetching && (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#9CA3AF]" />
          )}
        </div>

        {query.trim().length > 0 && (
          <CandidateList
            candidates={candidates.data ?? []}
            isPending={candidates.isPending}
            isAdding={addParticipant.isPending}
            onPick={handleAdd}
          />
        )}
      </div>

      {added && (
        <p className="text-[11.5px] text-[#166534]">
          {added} 님을 초대했습니다 — 위 「참여자 — 직원」 목록에서 확인하세요.
        </p>
      )}
      {error && <p className="text-[11.5px] text-red-600">{error}</p>}

      <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
        사내 실사원에게는 전용 콘솔이 없습니다. 초대하면 평소 설문 목록에 이 설문이 서고, 운영
        콘솔의 조사 대상·응답 수정·단건 메일을 모두 씁니다. 추가·등급·제외는 위 「참여자 —
        직원」 목록에서 다룹니다.
      </p>
    </>
  );
}

/** 이름 첫 글자 아바타 — 참여자 블록과 같은 규칙이다(같은 사람들이므로 같은 색). */
function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E0E7FF] text-[10px] font-semibold text-[#2743AE]">
      {name.slice(0, 1)}
    </span>
  );
}

/** 소속 · 이메일 — 팀 미배치면 이메일만 남는다(참여자 블록과 같은 근사). */
function metaLine(teamName: string | null, email: string): string {
  return teamName ? `${teamName} · ${email}` : email;
}

function CandidateList({
  candidates,
  isPending,
  isAdding,
  onPick,
}: {
  candidates: readonly ParticipantCandidateItem[];
  isPending: boolean;
  isAdding: boolean;
  onPick: (candidate: ParticipantCandidateItem) => void;
}) {
  return (
    <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-[220px] overflow-y-auto rounded-[9px] border border-[#E5E5EA] bg-white py-1 shadow-lg">
      {isPending && <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">검색 중…</p>}
      {!isPending && candidates.length === 0 && (
        <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">추가할 수 있는 직원이 없습니다.</p>
      )}
      {candidates.map((candidate) => (
        <button
          key={candidate.userId}
          type="button"
          disabled={isAdding}
          onClick={() => onPick(candidate)}
          className={cn(
            'flex w-full items-center gap-[9px] px-2.5 py-[7px] text-left',
            'hover:bg-[#F5F5F7] disabled:opacity-50',
          )}
        >
          <Avatar name={candidate.name} />
          <span className="shrink-0 text-[12.5px] font-semibold text-[#1C1C1E]">
            {candidate.name}
          </span>
          <span className="truncate text-[11px] text-[#9CA3AF]">
            {metaLine(candidate.teamName, candidate.email)}
          </span>
        </button>
      ))}
    </div>
  );
}
