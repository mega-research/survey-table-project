'use client';

import { useMemo, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SURVEY_VISIBILITY_LABEL, type SurveyVisibility } from '@/shared/contracts/workspace';

import { useTeams } from '../team-management/queries/use-teams';
import { useOwnerCandidates } from './queries/use-reassignment';

const SELECT_TRIGGER = 'h-[34px] rounded-lg border-[#E5E5EA] bg-white text-[13px]';

/**
 * 목적지·소유자·공개 범위 한 벌 — 일괄 배치 바(.pen 9-2)와 단건 패널(.pen 8-4)이 공유한다.
 *
 * **팀을 바꾸면 소유자를 비운다.** 소유자 후보는 그 팀의 활성 멤버라서 팀이 바뀌면 이전
 * 선택이 대개 무효가 되는데, 남겨두면 화면에는 이름이 보이는 채로 서버가 BAD_REQUEST 를
 * 던진다. 사용자에게는 "고른 값을 서버가 거부한다" 로 보인다.
 */
export function useAssignmentFields() {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<SurveyVisibility>('team');

  const teams = useTeams();
  const owners = useOwnerCandidates(teamId);

  const candidates = useMemo(() => owners.data ?? [], [owners.data]);
  const candidatesLoading = teamId !== null && owners.isLoading;

  // 지금 선택이 후보 목록에 없으면 **없는 것으로 친다**. 다른 창에서 그 사람이 팀에서 빠졌을
  // 수 있고, 남겨두면 화면에는 이름이 보이는 채로 서버가 거부하는 조합이 된다.
  //
  // effect 로 state 를 되돌리지 않고 파생값으로 두는 이유: 목록이 도착할 때마다 한 번 더
  // 렌더가 돌고, 그 사이의 한 프레임 동안 화면은 이미 무효인 값을 유효한 것처럼 보여준다.
  // 로딩 중에는 접지 않는다 — 후보가 아직 비어 있을 뿐인데 방금 고른 값이 사라지면 안 된다.
  const ownerIsValid =
    ownerUserId !== null && (candidatesLoading || candidates.some((c) => c.userId === ownerUserId));
  const effectiveOwnerUserId = ownerIsValid ? ownerUserId : null;

  return {
    teamId,
    ownerUserId: effectiveOwnerUserId,
    visibility,
    setVisibility,
    setTeamId: (next: string) => {
      setTeamId(next);
      setOwnerUserId(null);
    },
    setOwnerUserId,
    teams: teams.data?.teams ?? [],
    teamsLoading: teams.isLoading,
    candidates,
    candidatesLoading,
    /** 셋이 다 정해져야 배치할 수 있다. 서버도 같은 조합만 받는다. */
    ready: teamId !== null && effectiveOwnerUserId !== null,
  };
}

type Fields = ReturnType<typeof useAssignmentFields>;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11.5px] font-semibold text-[#6E6E73]">{children}</span>;
}

export function DestinationTeamField({ fields, width }: { fields: Fields; width: string }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <FieldLabel>목적지 팀</FieldLabel>
      {/* 미선택은 빈 문자열로 **계속 제어**한다. value 를 붙였다 뗐다 하면 Radix 가 제어 →
          비제어로 전환돼 옛 값을 안에 남기고 트리거가 빈칸으로 굳는다(placeholder 도 안 나온다).
          빈 문자열은 Radix 가 「선택 없음」으로 알아보는 값이라 placeholder 가 그대로 뜬다. */}
      <Select value={fields.teamId ?? ''} onValueChange={fields.setTeamId}>
        <SelectTrigger className={`${SELECT_TRIGGER} ${width}`} aria-label="목적지 팀">
          <SelectValue placeholder={fields.teamsLoading ? '불러오는 중...' : '팀 선택'} />
        </SelectTrigger>
        <SelectContent>
          {fields.teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/**
 * 새 소유자 — 목적지 팀을 고르기 전에는 비활성이다.
 *
 * 후보를 그 팀 활성 멤버로 좁히는 것은 UI 편의가 아니라 판정 코어와의 계약이다:
 * `resolveSurveyCapabilities` 의 소유자 분기가 **소유 팀 소속일 때만** 전권을 주므로,
 * 팀 밖 사람을 앉히면 자기 설문을 못 여는 소유자가 만들어진다(서버도 같은 이유로 거부한다).
 */
export function NewOwnerField({ fields, width }: { fields: Fields; width: string }) {
  const disabled = fields.teamId === null;
  return (
    <label className="flex flex-col gap-[6px]">
      <FieldLabel>새 소유자</FieldLabel>
      <Select
        value={fields.ownerUserId ?? ''}
        onValueChange={fields.setOwnerUserId}
        disabled={disabled}
      >
        <SelectTrigger className={`${SELECT_TRIGGER} ${width}`} aria-label="새 소유자">
          <SelectValue
            placeholder={
              disabled
                ? '팀 먼저 선택'
                : fields.candidatesLoading
                  ? '불러오는 중...'
                  : fields.candidates.length === 0
                    ? '후보 없음'
                    : '소유자 선택'
            }
          />
        </SelectTrigger>
        <SelectContent>
          {fields.candidates.map((candidate) => (
            <SelectItem key={candidate.userId} value={candidate.userId}>
              {candidate.name}
              {candidate.role === 'leader' ? ' · 팀장' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function VisibilityField({ fields, width }: { fields: Fields; width: string }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <FieldLabel>공개 범위</FieldLabel>
      <Select
        value={fields.visibility}
        onValueChange={(next) => fields.setVisibility(next as SurveyVisibility)}
      >
        <SelectTrigger className={`${SELECT_TRIGGER} ${width}`} aria-label="공개 범위">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SURVEY_VISIBILITY_LABEL) as SurveyVisibility[]).map((value) => (
            <SelectItem key={value} value={value}>
              {SURVEY_VISIBILITY_LABEL[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/**
 * 팀 밖 소유자가 되는 조합을 화면에서 미리 막을 수 없을 때의 안내.
 *
 * 목적지 팀에 활성 멤버가 없으면 어떤 소유자도 고를 수 없다 — 그 팀에 사람을 먼저 넣어야
 * 한다. 이 문장이 없으면 「소유자 선택」이 비어 있는 이유를 화면이 말해주지 않는다.
 */
export function NoCandidateNotice({ fields }: { fields: Fields }) {
  if (fields.teamId === null || fields.candidatesLoading || fields.candidates.length > 0) {
    return null;
  }
  return (
    <p className="text-[11.5px] text-[#B45309]">
      이 팀에는 소유자가 될 수 있는 재직 중 팀원이 없습니다. 미배치 사용자 탭에서 팀원을 먼저
      배정하세요.
    </p>
  );
}
