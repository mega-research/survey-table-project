'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface CreateTeamPickDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: { id: string; name: string }[];
}

/**
 * 시스템 전체 보기에서 새 설문을 만들 때 소유 팀을 고르는 창.
 *
 * 시스템 전체 보기는 조회 범위라 소유 목적지가 될 수 없다. 작업 범위를 바꾸지 않고 만들 수
 * 있도록, 고른 팀을 생성 화면 주소(`?team=`)로 넘기고 생성 경로가 그 값을 명시 범위로
 * 실어 보낸다 — 서버가 다시 판정한다(해산된 팀이면 거부).
 */
export function CreateTeamPickDialog({ open, onOpenChange, teams }: CreateTeamPickDialogProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) setSelected(null);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>새 설문을 만들 팀 선택</DialogTitle>
          <DialogDescription>설문은 고른 팀 소유로 만들어집니다.</DialogDescription>
        </DialogHeader>

        {teams.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[#6E6E73]">활성 팀이 없습니다.</p>
        ) : (
          <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => setSelected(team.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-[9px] border px-3.5 py-2.5 text-left text-[14px] transition-colors',
                  selected === team.id
                    ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#1C1C1E]'
                    : 'border-[#E5E5EA] bg-white text-[#374151] hover:bg-[#F5F5F7]',
                )}
              >
                <Users className="h-4 w-4 shrink-0 text-[#6E6E73]" />
                <span className="min-w-0 truncate">{team.name}</span>
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            취소
          </Button>
          <Button
            type="button"
            disabled={selected === null}
            onClick={() => {
              if (selected === null) return;
              router.push(`/admin/surveys/create?team=${encodeURIComponent(selected)}`);
            }}
          >
            만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
