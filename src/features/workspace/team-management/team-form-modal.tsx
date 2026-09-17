'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import { CreateTeamInput, RenameTeamInput } from '@/shared/contracts/workspace-io';

import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from '../field-styles';
import { useCreateTeam, useRenameTeam } from './queries/use-teams';

interface Props {
  /** 있으면 수정, 없으면 생성 — 두 폼이 같은 칸을 쓰므로 화면도 하나로 둔다. */
  team?: { id: string; name: string };
  onClose: () => void;
}

/**
 * 팀 생성·설정 모달 (.pen FLOW 7-1 「+ 새 팀」 / 7-2 「설정」).
 *
 * 이름은 전체 조직 경로를 담는다(`연구1본부 - 1팀`, ADR-0008) — 별도 본부 엔티티가 없으므로
 * 이 문자열이 조직도의 전부다. 그래서 이 화면은 슈퍼어드민만 연다.
 */
export function TeamFormModal({ team, onClose }: Props) {
  const [name, setName] = useState(team?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const createTeam = useCreateTeam();
  const renameTeam = useRenameTeam();
  const isPending = createTeam.isPending || renameTeam.isPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // 규칙은 경계 계약 한 곳에만 둔다 — 길이·공백 처리를 여기서 재현하면 서버와 갈린다.
    try {
      if (team) {
        const parsed = RenameTeamInput.safeParse({ teamId: team.id, name });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
          return;
        }
        await renameTeam.mutateAsync(parsed.data);
      } else {
        const parsed = CreateTeamInput.safeParse({ name });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
          return;
        }
        await createTeam.mutateAsync(parsed.data);
      }
      onClose();
    } catch (err) {
      // 같은 이름의 활성 팀은 서버가 CONFLICT 로 막는다 — 문구를 그대로 보여준다.
      setError(getErrorMessage(err, '팀을 저장하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[480px] gap-0 rounded-2xl p-7">
        <DialogTitle className="text-[16.5px] font-semibold text-[#1C1C1E]">
          {team ? '팀 설정' : '새 팀'}
        </DialogTitle>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-[18px]">
          <div className="space-y-2">
            <Label htmlFor="team-name" className={FIELD_LABEL}>
              팀 이름
            </Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="연구1본부 - 1팀"
              className={FIELD_INPUT}
              autoFocus
            />
            <p className={FIELD_HINT}>
              전체 조직 경로를 포함해 적습니다. 권한은 이름이 아니라 팀 자체로 판정합니다.
            </p>
          </div>

          {error && <p className="text-[12.5px] text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="h-[38px] rounded-[9px] px-4 text-[13px] text-[#6E6E73]"
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className={PRIMARY_BUTTON}
            >
              {team ? '저장' : '팀 만들기'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
