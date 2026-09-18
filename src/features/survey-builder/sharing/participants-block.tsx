'use client';

import { useEffect, useState } from 'react';

import { Loader2, Search } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import { SURVEY_PARTICIPANT_KIND_LABEL } from '@/shared/contracts/workspace';
import type {
  ParticipantCandidateItem,
  SurveyParticipantItem,
} from '@/shared/contracts/workspace-io';

import {
  useAddSurveyParticipant,
  useParticipantCandidates,
  useRemoveSurveyParticipant,
  useSurveyParticipants,
} from '../queries/use-survey-participants';

interface ParticipantsBlockProps {
  surveyId: string;
}

/**
 * 공유 설정 모달의 참여자 블록 (.pen FLOW 4-2, 역할 모델 v2 티켓 18).
 *
 * **추가와 제외의 권한 축이 다르다**(스펙 §7·§11-5). 검색·추가는 이 모달을 연 사람이면
 * 누구나 할 수 있고(관문은 `survey.invite`), 제외 버튼만 서버가 준 `canRemove` 로 잠근다 —
 * 화면이 역할을 다시 세면 「목록엔 제외가 있는데 누르면 FORBIDDEN」이 된다.
 *
 * 후보 검색은 **팀으로 좁히지 않는다**. 참여자는 팀 경계를 넘고 팀 멤버십을 만들지 않으므로
 * (스펙 §4) 소속 표기는 「어디 사람인가」를 알려주는 정보일 뿐 필터가 아니다.
 */
export function ParticipantsBlock({ surveyId }: ParticipantsBlockProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 타이핑마다 전사 명부를 왕복하지 않는다 — 팀원 추가 모달과 같은 250ms.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isPending, isError } = useSurveyParticipants(surveyId);
  // 검색어가 있을 때만 후보를 부른다 — 모달을 열자마자 전 사용자 명부를 당기지 않는다.
  const candidates = useParticipantCandidates(surveyId, debounced, debounced.length > 0);
  const addParticipant = useAddSurveyParticipant();
  const removeParticipant = useRemoveSurveyParticipant();

  async function handleAdd(userId: string) {
    setError(null);
    try {
      await addParticipant.mutateAsync({ surveyId, userId });
      setQuery('');
    } catch (err) {
      setError(getErrorMessage(err, '참여자를 추가하지 못했습니다.'));
    }
  }

  async function handleRemove(userId: string) {
    setError(null);
    try {
      await removeParticipant.mutateAsync({ surveyId, userId });
    } catch (err) {
      setError(getErrorMessage(err, '참여자를 제외하지 못했습니다.'));
    }
  }

  const participants = data?.participants ?? [];
  const canRemove = data?.canRemove ?? false;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#374151]">참여자 — 직원</span>

      <div className="relative">
        <div className="flex h-8 items-center gap-2 rounded-[8px] border border-[#D1D5DB] bg-white px-3">
          <Search className="h-[13px] w-[13px] shrink-0 text-[#9CA3AF]" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
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

      {isPending && <p className="py-2 text-[11.5px] text-[#9CA3AF]">불러오는 중…</p>}
      {isError && <p className="py-2 text-[11.5px] text-red-600">참여자를 불러올 수 없습니다.</p>}

      {participants.map((participant) => (
        <ParticipantRow
          key={participant.userId}
          participant={participant}
          canRemove={canRemove}
          isRemoving={removeParticipant.isPending}
          onRemove={() => handleRemove(participant.userId)}
        />
      ))}

      {error && <p className="text-[11.5px] text-red-600">{error}</p>}

      <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
        열람·편집·운영·삭제 가능 · 발행·공유 관리·소유권 이전은 소유자·팀장·슈퍼어드민 전용 · 초대
        추가는 접근자 누구나 · 팀원이 초대하면 「제한」(응답 상세·조사 대상·메일·내보내기·삭제 제외).
      </p>

      {/* 전파는 참여 행을 만들지 않아 위 목록에 나타나지 않는다 — 초대자가 눌러보기 전에
          알아야 하는 사실이라 문구로 밝힌다. 팀장 명단을 싣지 않는 것은 그 값이 동적이기
          때문이다(팀장이 바뀌면 접근자도 바뀐다). */}
      <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
        초대한 사람이 속한 팀의 팀장에게도 같은 권한이 전파됩니다(응답 상세·조사 대상·메일·내보내기·삭제
        제외). 팀장은 목록에 표시되지 않으며, 팀장이 바뀌면 접근 권한도 함께 옮겨갑니다.
      </p>
    </div>
  );
}

/** 이름 첫 글자 아바타 (.pen 4-2) — 이미지는 이 블록의 관심사가 아니다. */
function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E0E7FF] text-[10px] font-semibold text-[#2743AE]">
      {name.slice(0, 1)}
    </span>
  );
}

/** 소속 · 이메일 — .pen 의 「부가」. 팀 미배치면 이메일만 남는다. */
function metaLine(teamName: string | null, email: string): string {
  return teamName ? `${teamName} · ${email}` : email;
}

function ParticipantRow({
  participant,
  canRemove,
  isRemoving,
  onRemove,
}: {
  participant: SurveyParticipantItem;
  canRemove: boolean;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-[9px] rounded-[9px] border border-[#E5E5EA] bg-white px-2.5 py-[7px]">
      <Avatar name={participant.name} />
      <div className="flex min-w-0 flex-1 items-center gap-[7px]">
        <span className="shrink-0 text-[12.5px] font-semibold text-[#1C1C1E]">
          {participant.name}
        </span>
        <span className="shrink-0 rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10.5px] font-semibold text-[#1D4ED8]">
          {SURVEY_PARTICIPANT_KIND_LABEL[participant.kind]}
        </span>
        {/* 제한 참여자(0123) — 초대자가 참여자 권한 전부를 갖지 않아 열람·편집·현황·분석만 선다. */}
        {participant.accessLevel === 'limited' && (
          <span
            className="shrink-0 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10.5px] font-semibold text-[#4B5563]"
            title="응답 상세·조사 대상·메일·내보내기·삭제는 할 수 없습니다. 소유자·팀장이 다시 초대하면 전체 권한이 됩니다."
          >
            제한
          </span>
        )}
        <span className="truncate text-[11px] text-[#9CA3AF]">
          {metaLine(participant.teamName, participant.email)}
        </span>
      </div>
      {/* 제외는 소유자·팀장·슈퍼어드민만 — 권한이 없으면 버튼 자체를 그리지 않는다. */}
      {canRemove && (
        <button
          type="button"
          disabled={isRemoving}
          onClick={onRemove}
          className="shrink-0 text-[11.5px] text-[#9CA3AF] hover:text-[#B91C1C] disabled:opacity-50"
        >
          제외
        </button>
      )}
    </div>
  );
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
  onPick: (userId: string) => void;
}) {
  return (
    <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-[220px] overflow-y-auto rounded-[9px] border border-[#E5E5EA] bg-white py-1 shadow-lg">
      {isPending && <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">검색 중…</p>}
      {!isPending && candidates.length === 0 && (
        <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">추가할 수 있는 사용자가 없습니다.</p>
      )}
      {candidates.map((candidate) => (
        <button
          key={candidate.userId}
          type="button"
          disabled={isAdding}
          onClick={() => onPick(candidate.userId)}
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
