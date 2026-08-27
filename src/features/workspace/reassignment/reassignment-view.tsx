'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';

import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import type {
  PendingSurveyItem,
  ReassignmentSummary,
  UnassignedUserItem,
} from '@/shared/contracts/workspace-io';

import { PENDING_OWNER_FALLBACK, formatPreviousTeam } from './reassignment-vocabulary';
import { SurveyAssignBar } from './survey-assign-bar';
import { UserAssignModal } from './user-assign-modal';
import { useReassignmentInbox } from './queries/use-reassignment';

type TabKey = 'users' | 'surveys';

/** 지표 카드 셋 (.pen 8-2). 배치 대기만 강조색인 것은 목업 그대로 — 대개 그쪽이 훨씬 많다. */
function SummaryCards({ summary }: { summary: ReassignmentSummary }) {
  const cards = [
    { label: '해산된 팀', value: summary.archivedTeamCount, accent: false },
    { label: '미배치 사용자', value: summary.unassignedUserCount, accent: false },
    { label: '배치 대기 설문', value: summary.pendingSurveyCount, accent: true },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`flex flex-col gap-[3px] rounded-[10px] border p-[15px] ${
            card.accent ? 'border-[#C7D2FE] bg-[#EEF2FF]' : 'border-[#E5E5EA] bg-white'
          }`}
        >
          <span className="text-[12px] text-[#6E6E73]">{card.label}</span>
          <span className="text-[22px] font-bold text-[#1C1C1E]">{card.value}</span>
        </div>
      ))}
    </div>
  );
}

function TableHead({ columns }: { columns: { key: string; label: string; className: string }[] }) {
  return (
    <div className="flex items-center border-b border-[#E5E5EA] bg-[#F9FAFB] px-4 py-[11px]">
      {columns.map((column) => (
        <span
          key={column.key}
          className={`text-[11.5px] font-semibold text-[#6E6E73] ${column.className}`}
        >
          {column.label}
        </span>
      ))}
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-[13px] text-[#9CA3AF]">{children}</p>;
}

/** 목록 상한을 넘겼을 때만 뜬다 — 지표는 전체 수라 두 수가 어긋나 보이면 안 된다. */
function TruncationNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="px-4 pb-3 text-[11.5px] text-[#9CA3AF]">
      전체 {total}건 중 상위 {shown}건입니다. 처리하면 다음 건이 올라옵니다.
    </p>
  );
}

function UnassignedUserTable({
  users,
  total,
  onAssign,
}: {
  users: UnassignedUserItem[];
  total: number;
  onAssign: (userId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E5EA] bg-white">
      <TableHead
        columns={[
          { key: 'user', label: '사용자', className: 'flex-1' },
          { key: 'prev', label: '이전 소속', className: 'w-[220px] shrink-0' },
          { key: 'action', label: '배치', className: 'w-[180px] shrink-0' },
        ]}
      />
      {users.length === 0 ? (
        <EmptyRow>미배치 사용자가 없습니다.</EmptyRow>
      ) : (
        users.map((user) => (
          <div
            key={user.userId}
            className="flex items-center border-b border-[#F1F1F4] px-4 py-[15px] last:border-b-0"
          >
            <div className="flex flex-1 flex-col gap-[2px]">
              <span className="text-[13.5px] font-semibold text-[#1C1C1E]">{user.name}</span>
              <span className="text-[11.5px] text-[#9CA3AF]">
                {user.email}
                {user.jobTitle ? ` · ${user.jobTitle}` : ''}
              </span>
            </div>
            <span className="w-[220px] shrink-0 text-[12.5px] text-[#374151]">
              {formatPreviousTeam(user.previousTeamName)}
            </span>
            <div className="flex w-[180px] shrink-0 items-center justify-between gap-2">
              <span className="text-[11.5px] text-[#EF4444]">미배치 · 로그인·프로필만</span>
              <button
                type="button"
                onClick={() => onAssign(user.userId)}
                className="shrink-0 rounded-lg bg-[#2E4FCE] px-3 py-[7px] text-[12.5px] font-semibold text-white hover:bg-[#2743AE]"
              >
                팀 배정
              </button>
            </div>
          </div>
        ))
      )}
      <TruncationNote shown={users.length} total={total} />
    </div>
  );
}

function PendingSurveyTable({
  surveys,
  total,
  selected,
  onToggle,
  onToggleAll,
}: {
  surveys: PendingSurveyItem[];
  total: number;
  selected: ReadonlySet<string>;
  onToggle: (surveyId: string) => void;
  onToggleAll: () => void;
}) {
  const allSelected = surveys.length > 0 && surveys.every((s) => selected.has(s.surveyId));
  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E5EA] bg-white">
      <div className="flex items-center border-b border-[#E5E5EA] bg-[#F9FAFB] px-4 py-[11px]">
        <input
          type="checkbox"
          aria-label="전체 선택"
          checked={allSelected}
          onChange={onToggleAll}
          disabled={surveys.length === 0}
          className="mr-3 h-4 w-4 shrink-0 accent-[#2E4FCE]"
        />
        <span className="flex-1 text-[11.5px] font-semibold text-[#6E6E73]">설문</span>
        <span className="w-[130px] shrink-0 text-[11.5px] font-semibold text-[#6E6E73]">
          현재 상태
        </span>
        <span className="w-[160px] shrink-0 text-[11.5px] font-semibold text-[#6E6E73]">
          현재 소유자
        </span>
      </div>
      {surveys.length === 0 ? (
        <EmptyRow>배치 대기 설문이 없습니다.</EmptyRow>
      ) : (
        surveys.map((survey) => (
          <div
            key={survey.surveyId}
            className="flex items-center border-b border-[#F1F1F4] px-4 py-[15px] last:border-b-0"
          >
            <input
              type="checkbox"
              aria-label={`${survey.title} 선택`}
              checked={selected.has(survey.surveyId)}
              onChange={() => onToggle(survey.surveyId)}
              className="mr-3 h-4 w-4 shrink-0 accent-[#2E4FCE]"
            />
            <div className="flex flex-1 flex-col gap-[2px]">
              <Link
                href={`/admin/reassignment/surveys/${survey.surveyId}`}
                className="text-[13.5px] font-semibold text-[#1C1C1E] hover:text-[#2E4FCE]"
              >
                {survey.title}
              </Link>
              <span className="text-[11.5px] text-[#9CA3AF]">
                {formatPreviousTeam(survey.previousTeamName)} · 미분류
              </span>
            </div>
            <span className="w-[130px] shrink-0">
              <span className="rounded-full bg-[#FEF3C7] px-[9px] py-1 text-[11px] font-semibold text-[#B45309]">
                배치 대기
              </span>
            </span>
            <span className="w-[160px] shrink-0 text-[12.5px] text-[#374151]">
              {survey.ownerName ?? PENDING_OWNER_FALLBACK}
              {survey.ownerIsUnassigned ? ' · 미배치' : ''}
            </span>
          </div>
        ))
      )}
      <TruncationNote shown={surveys.length} total={total} />
    </div>
  );
}

/**
 * 재배치 센터 (.pen FLOW 8-2·9-2) — 슈퍼어드민 전용 인박스.
 *
 * 팀 관리의 「메가리서치」 카드가 유일한 입구다. 사이드바 항목을 만들지 않는 것이 의도다 —
 * 메가리서치는 팀이 아니라 시스템 전체 보기이고(ADR-0006), 여기 있는 사람과 설문은 어느
 * 팀에도 속하지 않아 팀 범위로는 설명되지 않는다.
 *
 * 두 탭이 한 응답에서 나온다. 탭을 옮길 때마다 왕복하지 않기 위해서이기도 하지만, 더 큰
 * 이유는 지표 셋과 목록이 **같은 순간**을 보여야 해서다 — 따로 읽으면 「미배치 5」인데 표에
 * 4명만 있는 화면이 자연스럽게 만들어진다.
 */
export function ReassignmentView() {
  const [tab, setTab] = useState<TabKey>('users');
  const [assignUserId, setAssignUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const { data, isLoading, error } = useReassignmentInbox();

  const users = data?.unassignedUsers ?? [];
  // useMemo 의 의존이므로 매 렌더 새 배열이 되지 않게 memo 로 감싼다.
  const surveys = useMemo(() => data?.pendingSurveys ?? [], [data]);
  const summary = data?.summary ?? {
    archivedTeamCount: 0,
    unassignedUserCount: 0,
    pendingSurveyCount: 0,
  };
  // 목록에서 사라진 id(다른 창에서 먼저 배치)는 선택에서 자동으로 빠진다 — 남겨두면
  // 일괄 배치가 「배치 대기가 아님」으로 통째로 거부된다.
  const visibleSelected = useMemo(() => {
    const visible = new Set(surveys.map((s) => s.surveyId));
    return new Set([...selected].filter((id) => visible.has(id)));
  }, [selected, surveys]);

  // 목록 스냅샷이 아니라 id 로 최신 행을 읽는다(팀 해산 모달과 같은 이유).
  const assignTarget = users.find((u) => u.userId === assignUserId) ?? null;
  const pendingTotal = summary.unassignedUserCount + summary.pendingSurveyCount;

  function toggle(surveyId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(surveyId)) next.delete(surveyId);
      else next.add(surveyId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const allSelected = surveys.length > 0 && surveys.every((s) => prev.has(s.surveyId));
      return allSelected ? new Set() : new Set(surveys.map((s) => s.surveyId));
    });
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-[1048px] space-y-[18px]">
        <Link
          href="/admin/teams"
          className="inline-flex items-center gap-1 text-[13px] text-[#6E6E73] hover:text-[#1C1C1E]"
        >
          <ArrowLeft className="h-4 w-4" />팀 관리
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-[3px]">
            <h1 className="text-[22px] font-semibold text-[#1C1C1E]">재배치 센터</h1>
            <p className="text-[13px] text-[#6E6E73]">
              해산·미배치 사용자와 배치 대기 설문을 한곳에서 처리합니다.
            </p>
          </div>
          {pendingTotal > 0 && (
            <span className="flex shrink-0 items-center gap-[6px] rounded-full bg-[#FEF3C7] px-3 py-[6px] text-[12px] font-semibold text-[#B45309]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#F59E0B]" />
              처리 대기 {pendingTotal}
            </span>
          )}
        </div>

        <SummaryCards summary={summary} />

        <div className="flex gap-[3px] rounded-[10px] bg-[#F5F5F7] p-1">
          {(
            [
              { key: 'users', label: `미배치 사용자 ${summary.unassignedUserCount}` },
              { key: 'surveys', label: `배치 대기 설문 ${summary.pendingSurveyCount}` },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              aria-pressed={tab === item.key}
              className={`flex-1 rounded-[7px] py-[7px] text-[13px] font-semibold ${
                tab === item.key ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#6E6E73]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#6E6E73]">
            <Loader2 className="h-4 w-4 animate-spin" />
            재배치 대상을 불러오는 중...
          </div>
        )}
        {error && (
          <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-red-600">
            <AlertCircle className="h-4 w-4" />
            재배치 대상을 불러오지 못했습니다.
          </p>
        )}

        {!isLoading && !error && tab === 'users' && (
          <UnassignedUserTable
            users={users}
            total={summary.unassignedUserCount}
            onAssign={setAssignUserId}
          />
        )}

        {!isLoading && !error && tab === 'surveys' && (
          <>
            <SurveyAssignBar
              surveyIds={[...visibleSelected]}
              onAssigned={() => setSelected(new Set())}
            />
            <PendingSurveyTable
              surveys={surveys}
              total={summary.pendingSurveyCount}
              selected={visibleSelected}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
          </>
        )}

        <p className="pt-1 text-[11.5px] leading-relaxed text-[#9CA3AF]">
          해산된 팀의 외부 응답 · 게스트 열람 · 메일 발송은 재배치와 무관하게 계속 동작합니다.
        </p>
      </div>

      {assignTarget && (
        <UserAssignModal user={assignTarget} onClose={() => setAssignUserId(null)} />
      )}
    </div>
  );
}
