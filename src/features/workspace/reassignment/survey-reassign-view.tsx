'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AlertCircle, Globe, Loader2, Users } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';

import {
  DestinationTeamField,
  NewOwnerField,
  NoCandidateNotice,
  VisibilityField,
  useAssignmentFields,
} from './assignment-fields';
import {
  PENDING_KIND_LABEL,
  PENDING_OWNER_FALLBACK,
  SUCCESSION_REPLY_WARNING,
  formatPendingTeam,
} from './reassignment-vocabulary';
import { usePendingSurvey, useAssignSurveys } from './queries/use-reassignment';

/** 현재 상태 요약 — 바뀌는 것 둘과 바뀌지 않는 것 하나 (.pen 8-4). */
function StatusCard({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-[3px] rounded-[10px] border border-[#E5E5EA] bg-white p-[14px]">
      <span className="flex items-center gap-1.5 text-[11.5px] text-[#6E6E73]">
        {icon}
        {label}
      </span>
      <span className="text-[13px] font-semibold text-[#1C1C1E]">{value}</span>
    </div>
  );
}

/**
 * 단건 설문 재배치 (.pen FLOW 8-4) — 새 소유자·목적지 팀·공개 범위를 함께 확정한다.
 *
 * 일괄 배치(9-2)와 **같은 RPC** 를 부른다. 화면 둘이 하는 일이 「선택한 설문들에 같은
 * 조건을 적용한다」로 정확히 같고, 이쪽은 그 목록의 길이가 1 인 경우다 — 나누면 원자성
 * 규칙이 두 벌이 된다.
 *
 * 배치가 끝나면 그 설문은 배치 대기가 아니게 되어 이 주소가 null 을 돌려준다. 그래서
 * 성공 직후 인박스로 되돌린다 — 그대로 두면 방금 처리한 화면이 「없는 설문」이 된다.
 */
export function SurveyReassignView({ surveyId }: { surveyId: string }) {
  const router = useRouter();
  const fields = useAssignmentFields();
  const [error, setError] = useState<string | null>(null);
  const { data: survey, isLoading, error: loadError } = usePendingSurvey(surveyId);
  const assign = useAssignSurveys();

  if (isLoading) {
    return (
      <CenterMessage>
        <Loader2 className="h-4 w-4 animate-spin" />
        설문을 불러오는 중...
      </CenterMessage>
    );
  }

  if (loadError) {
    return (
      <CenterMessage tone="error">
        <AlertCircle className="h-4 w-4" />
        설문을 불러오지 못했습니다.
      </CenterMessage>
    );
  }

  // 배치 대기가 아니면 서버가 null 을 준다(없는 설문과 같은 취급). 이미 다른 창에서 처리한
  // 경우가 대부분이라 안내는 짧게 두고 인박스로 가는 길만 준다.
  if (!survey) {
    return (
      <CenterMessage>
        이 설문은 더 이상 배치 대기 상태가 아닙니다.
        <Link href="/reassignment" className="font-semibold text-[#2E4FCE]">
          재배치 센터로
        </Link>
      </CenterMessage>
    );
  }

  const canAssign = fields.ready && !assign.isPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canAssign || fields.teamId === null || fields.ownerUserId === null) return;
    setError(null);
    try {
      await assign.mutateAsync({
        surveyIds: [surveyId],
        teamId: fields.teamId,
        ownerUserId: fields.ownerUserId,
        visibility: fields.visibility,
      });
      router.push('/reassignment');
    } catch (err) {
      setError(getErrorMessage(err, '설문을 배치하지 못했습니다.'));
    }
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-[820px] space-y-[18px]">
        <nav className="text-[13px] text-[#6E6E73]">
          <Link href="/reassignment" className="hover:text-[#1C1C1E]">
            재배치 센터
          </Link>
          <span className="px-1.5">/</span>
          <span>{PENDING_KIND_LABEL[survey.pendingKind]} 설문</span>
        </nav>

        <h1 className="text-[22px] font-semibold text-[#1C1C1E]">{survey.title}</h1>

        <div className="flex flex-col gap-3 sm:flex-row">
          <StatusCard label="현재 소유 팀" value={formatPendingTeam(survey)} />
          <StatusCard
            icon={<Users className="h-3.5 w-3.5" />}
            label="현재 소유자"
            value={`${survey.ownerName ?? PENDING_OWNER_FALLBACK}${
              survey.ownerIsUnassigned ? ' · 미배치' : ''
            }`}
          />
          <StatusCard
            icon={<Globe className="h-3.5 w-3.5" />}
            label="외부 운영"
            value="응답 · 게스트 · 메일 계속"
          />
        </div>

        {/* 소유자만 비었을 뿐 설문은 계속 돈다 — 회신·문의가 아직 이전 소유자에게 간다는
            사실을 여기서도 말한다(티켓 20). 인박스와 같은 문구를 쓴다. */}
        {survey.pendingKind === 'succession' && (
          <p className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-[14px] py-[11px] text-[12.5px] text-[#B45309]">
            {SUCCESSION_REPLY_WARNING}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-[14px] rounded-xl border border-[#E5E5EA] bg-white p-[18px]"
        >
          <div className="flex flex-col gap-[3px]">
            <h2 className="text-[15px] font-semibold text-[#1C1C1E]">설문 재배치</h2>
            <p className="text-[12.5px] text-[#6E6E73]">소유권과 소유 팀을 함께 이전합니다.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <NewOwnerField fields={fields} width="w-[220px]" />
            <DestinationTeamField fields={fields} width="w-[220px]" />
            <VisibilityField fields={fields} width="w-[160px]" />
          </div>

          <NoCandidateNotice fields={fields} />

          {/*
            이전이 무엇을 건드리고 무엇을 건드리지 않는지 (.pen 8-4). 셋 다 지금 동작이다 —
            배치는 참여 행(survey_participants)과 링크 행을 건드리지 않고, 회신·문의 주소는
            발송 시점의 소유자에서 읽는다(소유자 연동). 처음에는 앞의 둘이 아직 없는 기능이라
            「이후 티켓」 표식을 달고 흐리게 그렸는데, 기능이 선 뒤에도 그 표식이 화면에 남아 있었다.
          */}
          <div className="flex flex-col gap-2 rounded-[10px] bg-[#F9FAFB] p-3.5">
            <EffectRow title="기존 참여자 유지" detail="참여자·클라이언트·실사 부여를 그대로 이전" />
            <EffectRow title="문의·메일 회신" detail="다음 발송부터 새 소유자 연동" />
            <EffectRow title="새 팀 그룹" detail="미분류로 시작 (그룹은 팀 소유물)" />
          </div>

          {error && <p className="text-[12.5px] text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Link
              href="/reassignment"
              className="rounded-lg border border-[#E5E5EA] bg-white px-3.5 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
            >
              취소
            </Link>
            <button
              type="submit"
              disabled={!canAssign}
              className="flex items-center gap-1.5 rounded-lg bg-[#2E4FCE] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#2743AE] disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
            >
              {assign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}소유권 이전
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EffectRow({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="flex items-baseline gap-2 text-[12.5px]">
      <span className="font-semibold text-[#374151]">{title}</span>
      <span className="text-[#6E6E73]">{detail}</span>
    </span>
  );
}

function CenterMessage({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] px-4">
      <p
        className={`flex items-center gap-2 text-[13px] ${
          tone === 'error' ? 'text-red-600' : 'text-[#6E6E73]'
        }`}
      >
        {children}
      </p>
    </div>
  );
}
