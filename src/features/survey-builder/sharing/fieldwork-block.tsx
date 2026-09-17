'use client';

import { useEffect, useState } from 'react';

import { Loader2, Search } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import { FIELDWORK_ROLE_LABEL, type FieldworkRole } from '@/shared/contracts/auth';
import type {
  FieldworkCandidateItem,
  SurveyFieldworkItem,
} from '@/shared/contracts/workspace-io';

import {
  useAddSurveyFieldwork,
  useFieldworkCandidates,
  useRemoveSurveyFieldwork,
  useSurveyFieldwork,
} from '../queries/use-survey-fieldwork';

interface FieldworkBlockProps {
  surveyId: string;
}

/**
 * 공유 설정 모달의 실사 블록 (.pen FLOW 4-2, 역할 모델 v2 티켓 25).
 *
 * 게스트 블록과 나란히 서지만 **탭 칩 줄이 없다**. 실사가 갖는 권한은 초대되면 고정이고
 * (조사 대상 원본 + 결과코드 + 대리 응답) 설문마다 고르는 축이 없기 때문이다 — 게스트의
 * 탭 화이트리스트에 해당하는 것이 여기엔 존재하지 않는다.
 *
 * **초대는 개인 단위다**(ADR-0019). 업체를 통째로 붙이는 UI 를 두지 않는 것이 결정이고,
 * 대신 검색이 업체명을 함께 보여준다 — 같은 이름의 실사원이 업체마다 있을 수 있어 그것이
 * 사람을 가르는 정보다(.pen 「실사 계정 검색 · 업체명으로 구분」).
 *
 * 권한 축은 게스트와 같은 둘이다: 검색·추가는 이 모달을 연 사람이면 누구나, 「제외」는
 * 서버가 준 `canManage`(=`survey.manageAccess`)로 잠근다.
 *
 * 화면에 없는 것이 계약이다 — **실사 팀장의 업체 시야를 여기서 켜고 끄지 않는다.** 그것은
 * 행이 아니라 소속원 초대의 함수라(코어의 파생 분기), 마지막 소속원을 빼면 저절로 닫힌다.
 */
export function FieldworkBlock({ surveyId }: FieldworkBlockProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 타이핑마다 인력 명부를 왕복하지 않는다 — 참여자·게스트 검색과 같은 250ms.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isPending, isError } = useSurveyFieldwork(surveyId);
  const candidates = useFieldworkCandidates(surveyId, debounced, debounced.length > 0);
  const addFieldwork = useAddSurveyFieldwork();
  const removeFieldwork = useRemoveSurveyFieldwork();

  async function handleAdd(userId: string) {
    setError(null);
    try {
      await addFieldwork.mutateAsync({ surveyId, userId });
      setQuery('');
    } catch (err) {
      setError(getErrorMessage(err, '실사 계정을 초대하지 못했습니다.'));
    }
  }

  async function handleRemove(userId: string) {
    setError(null);
    try {
      await removeFieldwork.mutateAsync({ surveyId, userId });
    } catch (err) {
      setError(getErrorMessage(err, '실사 초대를 해제하지 못했습니다.'));
    }
  }

  const members = data?.members ?? [];
  const canManage = data?.canManage ?? false;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#374151]">실사 — 대리 응답</span>

      <div className="relative">
        <div className="flex h-8 items-center gap-2 rounded-[8px] border border-[#D1D5DB] bg-white px-3">
          <Search className="h-[13px] w-[13px] shrink-0 text-[#9CA3AF]" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder="실사 계정 검색 · 업체명으로 구분"
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
            isAdding={addFieldwork.isPending}
            onPick={handleAdd}
          />
        )}
      </div>

      {isPending && <p className="py-2 text-[11.5px] text-[#9CA3AF]">불러오는 중…</p>}
      {isError && (
        <p className="py-2 text-[11.5px] text-red-600">실사 초대를 불러올 수 없습니다.</p>
      )}

      {members.map((member) => (
        <MemberRow
          key={member.userId}
          member={member}
          canManage={canManage}
          isRemoving={removeFieldwork.isPending}
          onRemove={() => handleRemove(member.userId)}
        />
      ))}

      {error && <p className="text-[11.5px] text-red-600">{error}</p>}

      <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
        조사 대상 원본 열람 + 결과코드·메모 기록 + 대리 응답 · 실사 팀장은 자기 업체 초대
        설문을 자동 열람합니다.
      </p>
      {members.length > 0 && !canManage && (
        <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
          초대 해제는 소유자·팀장·슈퍼어드민만 할 수 있습니다.
        </p>
      )}
    </div>
  );
}

/** 이름 첫 글자 아바타 — 참여자·게스트 블록과 같은 규칙이되 색으로 갈라 놓는다. */
function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E0F2FE] text-[10px] font-semibold text-[#075985]">
      {name.slice(0, 1)}
    </span>
  );
}

/** 역할 필 — 팀장과 실사원을 갈라 보여준다. 팀장은 자기 업체 시야를 함께 갖는다. */
function RolePill({ role }: { role: FieldworkRole }) {
  return (
    <span className="shrink-0 rounded-full bg-[#E0F2FE] px-2 py-0.5 text-[10.5px] font-semibold text-[#075985]">
      {FIELDWORK_ROLE_LABEL[role]}
    </span>
  );
}

/** 업체 · 이메일 — 실사에게는 팀이 없어 이 줄이 「어디 사람인가」를 말한다. */
function metaLine(orgName: string, email: string): string {
  return `${orgName} · ${email}`;
}

function MemberRow({
  member,
  canManage,
  isRemoving,
  onRemove,
}: {
  member: SurveyFieldworkItem;
  canManage: boolean;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-[9px] rounded-[9px] border border-[#E5E5EA] bg-white px-2.5 py-[7px]">
      <Avatar name={member.name} />
      <div className="flex min-w-0 flex-1 items-center gap-[7px]">
        <span className="shrink-0 text-[12.5px] font-semibold text-[#1C1C1E]">{member.name}</span>
        <RolePill role={member.fieldworkRole} />
        <span className="truncate text-[11px] text-[#9CA3AF]">
          {metaLine(member.orgName, member.email)}
        </span>
      </div>
      {/* 해제는 소유자·팀장·슈퍼어드민만 — 권한이 없으면 버튼 자체를 그리지 않는다. */}
      {canManage && (
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
  candidates: readonly FieldworkCandidateItem[];
  isPending: boolean;
  isAdding: boolean;
  onPick: (userId: string) => void;
}) {
  return (
    <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-[220px] overflow-y-auto rounded-[9px] border border-[#E5E5EA] bg-white py-1 shadow-lg">
      {isPending && <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">검색 중…</p>}
      {!isPending && candidates.length === 0 && (
        <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">
          초대할 수 있는 실사 계정이 없습니다.
        </p>
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
          <RolePill role={candidate.fieldworkRole} />
          <span className="truncate text-[11px] text-[#9CA3AF]">
            {metaLine(candidate.orgName, candidate.email)}
          </span>
        </button>
      ))}
    </div>
  );
}
