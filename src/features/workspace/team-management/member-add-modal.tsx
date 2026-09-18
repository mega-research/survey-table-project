'use client';

import { useEffect, useState } from 'react';

import { Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getErrorMessage } from '@/lib/get-error-message';

import { useAddTeamMember, useAssignableUsers } from './queries/use-teams';

interface Props {
  teamId: string;
  /**
   * 타 팀 소속자를 겸직으로 추가할 수 있는가 — 서버가 준 `canPullCrossTeam` 그대로.
   *
   * 화면이 주체를 다시 판정하지 않는다. 검색 후보도 서버가 같은 경계로 좁히므로 이 값은
   * **문구만** 가른다 — 두 주체에게 같은 문구를 보이면 한쪽에게는 거짓이 된다.
   */
  canPullCrossTeam: boolean;
  onClose: () => void;
}

/**
 * 팀원 추가 모달 (.pen FLOW 7-3) — pull 모델.
 *
 * 팀장에게는 **미배치 internal 사용자만** 잡힌다. 타 팀 소속 멤버를 여기서 빼올 수 없고,
 * 이동이 필요하면 슈퍼어드민이 처리한다. 이 제한은 화면이 아니라 서버가 지키지만, 화면이
 * 먼저 알려줘야 "검색해도 안 나온다" 가 버그로 읽히지 않는다.
 *
 * 슈퍼어드민에게는 타 팀 소속자도 잡히고 **겸직**으로 추가된다(기존 소속을 지우지 않는다).
 * 본부 차원에서 여러 팀을 관장하는 사람이 각 팀 팀장 멤버십을 갖는 경로다(CONTEXT.md 「팀」).
 * 후보 행에 현재 소속을 함께 적는 것이 이 화면의 계약이다 — 없으면 모르고 남의 팀 사람을
 * 당기게 되어, 팀장의 pull 을 막아 둔 이유가 여기서 재현된다.
 */
export function MemberAddModal({ teamId, canPullCrossTeam, onClose }: Props) {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: addMember, isPending } = useAddTeamMember();
  const { data, isLoading } = useAssignableUsers(teamId, debounced);

  // 타이핑마다 왕복하지 않는다 — 250ms 는 사람이 다음 글자를 치는 간격보다 짧다.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword.trim()), 250);
    return () => clearTimeout(timer);
  }, [keyword]);

  const candidates = data ?? [];

  async function handleAdd(userId: string) {
    setError(null);
    try {
      await addMember({ teamId, userId, role: 'member' });
      onClose();
    } catch (err) {
      // 목록을 띄워둔 사이 다른 팀이 먼저 데려갔을 수 있다 — 서버 문구를 그대로 띄운다.
      setError(getErrorMessage(err, '팀원을 추가하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[480px] gap-0 rounded-[14px] p-[22px]">
        <DialogTitle className="text-[17px] font-semibold text-[#1C1C1E]">팀원 추가</DialogTitle>
        <p className="mt-[3px] text-[12.5px] text-[#6E6E73]">
          {canPullCrossTeam
            ? '이름 또는 이메일로 검색해 추가합니다. 타 팀 소속자는 겸직으로 추가됩니다.'
            : '미배치 사용자만 검색해 추가할 수 있습니다.'}
        </p>

        <div className="mt-[14px] flex items-center gap-2 rounded-[9px] border border-[#E5E5EA] px-3">
          <Search className="h-[15px] w-[15px] shrink-0 text-[#9CA3AF]" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="이름 또는 이메일 검색"
            aria-label="이름 또는 이메일 검색"
            className="h-9 border-0 px-0 text-[13px] placeholder:text-[#9CA3AF] focus-visible:ring-0"
            autoFocus
          />
        </div>

        <div className="mt-[14px] flex max-h-[280px] flex-col gap-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <div
              key={candidate.userId}
              className="flex items-center gap-3 rounded-[10px] border border-[#E5E5EA] px-3 py-[10px]"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E0E7FF] text-[12px] font-semibold text-[#2743AE]"
              >
                {candidate.name.slice(0, 1)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] font-semibold text-[#1C1C1E]">
                  {candidate.name}
                </span>
                <span className="truncate text-[11.5px] text-[#6E6E73]">
                  {candidate.email}
                  {candidate.jobTitle ? ` · ${candidate.jobTitle}` : ''} ·{' '}
                  {candidate.teamNames.length > 0
                    ? candidate.teamNames.join(', ')
                    : '팀 미배치'}
                </span>
              </span>
              <Button
                type="button"
                disabled={isPending}
                onClick={() => handleAdd(candidate.userId)}
                className="h-[30px] rounded-[7px] bg-[#2E4FCE] px-3 text-[12.5px] font-semibold text-white hover:bg-[#2743AE]"
              >
                추가
              </Button>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-[#6E6E73]">
              <Loader2 className="h-4 w-4 animate-spin" />
              검색 중...
            </div>
          )}
          {!isLoading && candidates.length === 0 && (
            <p className="py-6 text-center text-[12.5px] text-[#9CA3AF]">
              {canPullCrossTeam
                ? '추가할 수 있는 사용자가 없습니다.'
                : '추가할 수 있는 미배치 사용자가 없습니다.'}
            </p>
          )}
        </div>

        {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}

        <p className="mt-[14px] text-[11.5px] leading-relaxed text-[#9CA3AF]">
          {canPullCrossTeam
            ? '타 팀 소속자를 추가해도 기존 소속은 그대로 남습니다(겸직). 옮기려면 그 팀에서 먼저 제외하세요. 팀장으로 세우려면 추가한 뒤 역할을 바꿉니다.'
            : '타 팀 소속 멤버는 검색되지 않습니다. 이동이 필요하면 슈퍼어드민에게 요청하세요.'}
        </p>
      </DialogContent>
    </Dialog>
  );
}
