'use client';

import { useState } from 'react';

import { Building2, Check, ChevronDown, Globe2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  SYSTEM_SCOPE,
  SYSTEM_SCOPE_LABEL,
  type WorkScope,
} from '@/shared/contracts/workspace';

interface Props {
  /** 서버가 해석한 현재 범위 — 화면이 고른 값이 아니라 이쪽이 정답이다. */
  scope: WorkScope;
  teams: { id: string; name: string }[];
  /** 「메가리서치」를 고를 수 있는가 — 슈퍼어드민만. */
  canSeeSystemScope: boolean;
  onSelect: (scope: string) => void;
}

/**
 * 작업 범위 스위처 (.pen FLOW 6-1 팀 전환 팝오버).
 *
 * 티켓 08 이 사이드바 상단으로 옮긴다 — 지금은 설문 목록 화면이 직접 연다. 목록·생성이
 * 범위에 묶인 이상 범위를 바꿀 수단이 화면에 있어야 하기 때문이다.
 */
export function ScopeSwitcher({ scope, teams, canSeeSystemScope, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const currentLabel =
    scope.kind === 'system'
      ? SYSTEM_SCOPE_LABEL
      : scope.kind === 'team'
        ? (teams.find((t) => t.id === scope.teamId)?.name ?? '알 수 없는 팀')
        : '소속 팀 없음';

  function choose(next: string) {
    setOpen(false);
    onSelect(next);
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        className="h-10 gap-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Building2 className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium">{currentLabel}</span>
        <ChevronDown className="h-4 w-4 text-gray-400" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute left-0 z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            <p className="px-3 py-1.5 text-[11px] font-semibold text-gray-400">팀 전환</p>
            {teams.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-500">소속된 팀이 없습니다</p>
            )}
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                role="menuitem"
                onClick={() => choose(team.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
              >
                <Building2 className="h-4 w-4 text-gray-400" />
                <span className="flex-1 truncate">{team.name}</span>
                {scope.kind === 'team' && scope.teamId === team.id && (
                  <Check className="h-4 w-4 text-blue-600" />
                )}
              </button>
            ))}
            {canSeeSystemScope && (
              <>
                <hr className="my-1" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => choose(SYSTEM_SCOPE)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100"
                >
                  <Globe2 className="h-4 w-4 text-gray-400" />
                  <span className="flex-1">
                    <span className="block text-sm text-gray-700">{SYSTEM_SCOPE_LABEL}</span>
                    <span className="block text-[11px] text-gray-400">
                      시스템 전체 보기 · 슈퍼어드민 전용
                    </span>
                  </span>
                  {scope.kind === 'system' && <Check className="h-4 w-4 text-blue-600" />}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
