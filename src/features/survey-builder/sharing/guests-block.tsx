'use client';

import { useEffect, useState } from 'react';

import { Check, Loader2, Search } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import {
  SURVEY_GUEST_TAB_LABEL,
  type SurveyGuestTab,
  type SurveyGuestTabs,
  surveyGuestTabValues,
} from '@/shared/contracts/workspace';
import type { GuestCandidateItem, SurveyGuestItem } from '@/shared/contracts/workspace-io';

import {
  useAddSurveyGuest,
  useGuestCandidates,
  useRemoveSurveyGuest,
  useSetSurveyGuestTabs,
  useSurveyGuests,
} from '../queries/use-survey-guests';

interface GuestsBlockProps {
  surveyId: string;
}

/**
 * 공유 설정 모달의 클라이언트(게스트) 블록 (.pen FLOW 4-2, 역할 모델 v2 티켓 21).
 *
 * 참여자 블록과 나란히 서지만 **탭 칩 줄이 하나 더 있다**. 게스트가 갖는 권한은 언제나
 * 같고(프리뷰 + 현황) 설문마다 달라지는 것은 어느 탭이 열리는가라, 그 선택이 이 화면의
 * 본체다. 칩은 부여된 사람마다 따로 산다 — 한 설문에 여러 클라이언트가 붙고 각자 볼 것이
 * 다르기 때문이다.
 *
 * 권한 축은 **둘**이다. 검색·추가는 이 모달을 연 사람이면 누구나 하고, 「제외」와 **탭 칩**은
 * 서버가 준 `canManage`(=`survey.manageAccess`)로 함께 잠근다 — 스펙 §11-5 의 「초대 제거·범위
 * 변경」이 그 둘이고, 탭을 넓히면 조사 대상(마스킹)·쿼터가 외부인에게 열린다. 새 부여는 언제나
 * 기본 탭으로 서므로 「추가는 누구나」와 어긋나지 않는다.
 *
 * 화면에 없는 것이 계약이다 — 메일 탭 체크박스가 없고, 「분석」·「다운로드」도 없다.
 * 열 수 없는 것은 어휘에도 두지 않는다(SurveyGuestTabs 주석).
 */
export function GuestsBlock({ surveyId }: GuestsBlockProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 타이핑마다 계정 명부를 왕복하지 않는다 — 참여자 검색과 같은 250ms.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isPending, isError } = useSurveyGuests(surveyId);
  const candidates = useGuestCandidates(surveyId, debounced, debounced.length > 0);
  const addGuest = useAddSurveyGuest();
  const setTabs = useSetSurveyGuestTabs();
  const removeGuest = useRemoveSurveyGuest();

  async function handleAdd(userId: string) {
    setError(null);
    try {
      await addGuest.mutateAsync({ surveyId, userId });
      setQuery('');
    } catch (err) {
      setError(getErrorMessage(err, '게스트를 추가하지 못했습니다.'));
    }
  }

  async function handleToggleTab(guest: SurveyGuestItem, tab: SurveyGuestTab) {
    setError(null);
    try {
      await setTabs.mutateAsync({
        surveyId,
        userId: guest.userId,
        tabs: { ...guest.tabs, [tab]: !guest.tabs[tab] },
      });
    } catch (err) {
      setError(getErrorMessage(err, '열람 탭을 저장하지 못했습니다.'));
    }
  }

  async function handleRemove(userId: string) {
    setError(null);
    try {
      await removeGuest.mutateAsync({ surveyId, userId });
    } catch (err) {
      setError(getErrorMessage(err, '게스트 부여를 해제하지 못했습니다.'));
    }
  }

  const guests = data?.guests ?? [];
  const canManage = data?.canManage ?? false;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#374151]">클라이언트 — 게스트 계정</span>

      <div className="relative">
        <div className="flex h-8 items-center gap-2 rounded-[8px] border border-[#D1D5DB] bg-white px-3">
          <Search className="h-[13px] w-[13px] shrink-0 text-[#9CA3AF]" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder="게스트 계정 검색"
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
            isAdding={addGuest.isPending}
            onPick={handleAdd}
          />
        )}
      </div>

      {isPending && <p className="py-2 text-[11.5px] text-[#9CA3AF]">불러오는 중…</p>}
      {isError && <p className="py-2 text-[11.5px] text-red-600">게스트를 불러올 수 없습니다.</p>}

      {guests.map((guest) => (
        <GuestCard
          key={guest.userId}
          guest={guest}
          canManage={canManage}
          isSaving={setTabs.isPending}
          isRemoving={removeGuest.isPending}
          onToggleTab={(tab) => handleToggleTab(guest, tab)}
          onRemove={() => handleRemove(guest.userId)}
        />
      ))}

      {error && <p className="text-[11.5px] text-red-600">{error}</p>}

      <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
        설문지 미리보기는 항상 포함, 현황은 체크한 탭만 보입니다 ·
        분석·다운로드·응답 상세·컨택 원본·메일은 항상 차단.
      </p>
      {guests.length > 0 && !canManage && (
        <p className="text-[11px] leading-[1.45] text-[#9CA3AF]">
          열람 탭 변경과 부여 해제는 소유자·팀장·슈퍼어드민만 할 수 있습니다.
        </p>
      )}
    </div>
  );
}

/** 이름 첫 글자 아바타 — 참여자 블록과 같은 규칙이되 색으로 갈라 놓는다. */
function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FEF3C7] text-[10px] font-semibold text-[#92400E]">
      {name.slice(0, 1)}
    </span>
  );
}

/** 소속 기관 · 이메일 — 게스트에게는 팀이 없어 이 줄이 「어디 사람인가」를 말한다. */
function metaLine(organization: string | null, email: string): string {
  return organization ? `${organization} · ${email}` : email;
}

function GuestCard({
  guest,
  canManage,
  isSaving,
  isRemoving,
  onToggleTab,
  onRemove,
}: {
  guest: SurveyGuestItem;
  canManage: boolean;
  isSaving: boolean;
  isRemoving: boolean;
  onToggleTab: (tab: SurveyGuestTab) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[9px] border border-[#E5E5EA] bg-white px-2.5 py-[7px]">
      <div className="flex items-center gap-[9px]">
        <Avatar name={guest.name} />
        <div className="flex min-w-0 flex-1 items-center gap-[7px]">
          <span className="shrink-0 text-[12.5px] font-semibold text-[#1C1C1E]">{guest.name}</span>
          <span className="shrink-0 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10.5px] font-semibold text-[#92400E]">
            게스트
          </span>
          <span className="truncate text-[11px] text-[#9CA3AF]">
            {metaLine(guest.organization, guest.email)}
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

      {/* 칩은 권한이 없어도 **보여준다** — 지금 무엇이 열려 있는지는 초대한 사람도 알아야
          한다. 잠기는 것은 누르는 것뿐이다. */}
      <TabChips tabs={guest.tabs} disabled={isSaving || !canManage} onToggle={onToggleTab} />
    </div>
  );
}

/**
 * 탭 칩 넷 — 체크가 켜진 것만 아이콘을 단다 (.pen 4-2).
 *
 * 어휘 순서는 `surveyGuestTabValues` 가 정한다. 화면이 자기 배열을 들면 탭이 늘었을 때
 * 계약에는 있는데 안 그려지는 값이 생긴다.
 *
 * `disabled` 는 저장 중이거나 관리 권한이 없을 때 선다 — 강제는 서버 관문이 하고 여기는
 * 「눌러도 FORBIDDEN 인 버튼」을 안 만드는 것이 목적이다.
 */
function TabChips({
  tabs,
  disabled,
  onToggle,
}: {
  tabs: SurveyGuestTabs;
  disabled: boolean;
  onToggle: (tab: SurveyGuestTab) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {surveyGuestTabValues.map((tab) => {
        const active = tabs[tab];
        return (
          <button
            key={tab}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onToggle(tab)}
            className={cn(
              'flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50',
              active
                ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#2743AE]'
                : 'border-[#E5E5EA] bg-white text-[#6E6E73] hover:text-[#1C1C1E]',
            )}
          >
            {active && <Check className="h-3 w-3" />}
            {SURVEY_GUEST_TAB_LABEL[tab]}
          </button>
        );
      })}
    </div>
  );
}

function CandidateList({
  candidates,
  isPending,
  isAdding,
  onPick,
}: {
  candidates: readonly GuestCandidateItem[];
  isPending: boolean;
  isAdding: boolean;
  onPick: (userId: string) => void;
}) {
  return (
    <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-[220px] overflow-y-auto rounded-[9px] border border-[#E5E5EA] bg-white py-1 shadow-lg">
      {isPending && <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">검색 중…</p>}
      {!isPending && candidates.length === 0 && (
        <p className="px-3 py-2 text-[11.5px] text-[#9CA3AF]">추가할 수 있는 계정이 없습니다.</p>
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
            {metaLine(candidate.organization, candidate.email)}
          </span>
        </button>
      ))}
    </div>
  );
}
