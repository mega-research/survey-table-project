'use client';

import { useState } from 'react';

import { Loader2 } from 'lucide-react';

import type { FieldworkOrgListItem } from '@/shared/contracts/workspace-io';

import { UserCreateModal } from '../user-management/user-create-modal';
import { FieldworkOrgCard } from './fieldwork-org-card';
import { FieldworkOrgFormModal } from './fieldwork-org-form-modal';
import { useFieldworkOrgs } from './queries/use-fieldwork-orgs';

interface Props {
  /** 「+ 새 실사 업체」는 사용자 관리 헤더에 있다 — 그 버튼의 열림 상태를 위에서 받는다. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

/**
 * 실사 업체 관리 (.pen FLOW 10-4) — 사용자 관리의 하위 탭.
 *
 * 화면은 사용자 관리 안에 있지만 엔티티는 워크스페이스 소관이다(업체는 팀과 같은 「소속
 * 경계」 계열이고 관리 축도 슈퍼어드민으로 같다). 그래서 이 묶음이 `workspace` 아래 산다.
 *
 * **계정 발급 모달은 사용자 관리 것을 그대로 쓴다.** 업체 카드에서 여는 발급도 같은 계정
 * 생성이고(.pen 1-2 의 「같은 모달로 진입한다」), 폼을 두 벌 두면 유형별 필드 규칙이 두 곳에
 * 복제된다 — 실사 계정의 필수 칸이 늘어날 때 한쪽만 고쳐진다.
 */
export function FieldworkOrgsView({ createOpen, onCreateOpenChange }: Props) {
  const [editTarget, setEditTarget] = useState<FieldworkOrgListItem | null>(null);
  /** 발급 모달이 미리 고를 소속 업체. 카드의 「+ 계정 발급」이 정한다. */
  const [issueForOrg, setIssueForOrg] = useState<FieldworkOrgListItem | null>(null);
  const { data, isLoading, error } = useFieldworkOrgs();

  const orgs = data?.orgs ?? [];

  return (
    <div className="space-y-3">
      {orgs.map((org, index) => (
        <FieldworkOrgCard
          key={org.id}
          org={org}
          defaultExpanded={index === 0}
          onEdit={setEditTarget}
          onIssueAccount={setIssueForOrg}
        />
      ))}

      {isLoading && (
        <div className="flex items-center justify-center gap-2 rounded-[11px] border border-[#E5E5EA] bg-white py-10 text-[13px] text-[#6E6E73]">
          <Loader2 className="h-4 w-4 animate-spin" />
          실사 업체를 불러오는 중...
        </div>
      )}
      {error && (
        <p className="rounded-[11px] border border-[#E5E5EA] bg-white py-10 text-center text-[13px] text-red-600">
          실사 업체를 불러오지 못했습니다.
        </p>
      )}
      {!isLoading && !error && orgs.length === 0 && (
        <p className="rounded-[11px] border border-[#E5E5EA] bg-white py-10 text-center text-[13px] text-[#9CA3AF]">
          등록된 실사 업체가 없습니다. 「+ 새 실사 업체」로 먼저 업체를 만드세요.
        </p>
      )}

      {createOpen && <FieldworkOrgFormModal onClose={() => onCreateOpenChange(false)} />}
      {editTarget && <FieldworkOrgFormModal org={editTarget} onClose={() => setEditTarget(null)} />}
      {issueForOrg && (
        <UserCreateModal
          open
          onOpenChange={(next) => (next ? undefined : setIssueForOrg(null))}
          presetFieldworkOrgId={issueForOrg.id}
        />
      )}
    </div>
  );
}
