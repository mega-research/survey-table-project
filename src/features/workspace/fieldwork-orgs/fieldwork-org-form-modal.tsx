'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import { CreateFieldworkOrgInput, UpdateFieldworkOrgInput } from '@/shared/contracts/workspace-io';

import { FIELD_HINT, FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON } from '../field-styles';
import { useCreateFieldworkOrg, useUpdateFieldworkOrg } from './queries/use-fieldwork-orgs';

interface Props {
  /** 있으면 수정, 없으면 생성 — 두 폼이 같은 칸을 쓰므로 화면도 하나로 둔다(팀 모달의 선례). */
  org?: { id: string; name: string; memo: string | null };
  onClose: () => void;
}

/**
 * 실사 업체 생성·수정 모달 (.pen FLOW 10-4 「+ 새 실사 업체」).
 *
 * 업체는 이름·상태·메모만 갖는 가벼운 엔티티다(ADR-0019) — 팀처럼 조직 경로를 담지도,
 * 설문을 소유하지도 않는다. 그래서 칸이 둘뿐이고, 그것이 이 화면이 짧은 이유다.
 */
export function FieldworkOrgFormModal({ org, onClose }: Props) {
  const [name, setName] = useState(org?.name ?? '');
  const [memo, setMemo] = useState(org?.memo ?? '');
  const [error, setError] = useState<string | null>(null);
  const createOrg = useCreateFieldworkOrg();
  const updateOrg = useUpdateFieldworkOrg();
  const isPending = createOrg.isPending || updateOrg.isPending;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // 규칙은 경계 계약 한 곳에만 둔다 — 길이·공백 처리를 여기서 재현하면 서버와 갈린다.
    try {
      if (org) {
        const parsed = UpdateFieldworkOrgInput.safeParse({ orgId: org.id, name, memo });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
          return;
        }
        await updateOrg.mutateAsync(parsed.data);
      } else {
        const parsed = CreateFieldworkOrgInput.safeParse({ name, memo });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
          return;
        }
        await createOrg.mutateAsync(parsed.data);
      }
      onClose();
    } catch (err) {
      // 같은 이름의 활성 업체는 서버가 CONFLICT 로 막는다 — 문구를 그대로 보여준다.
      setError(getErrorMessage(err, '실사 업체를 저장하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[480px] gap-0 rounded-2xl p-7">
        <DialogTitle className="text-[16.5px] font-semibold text-[#1C1C1E]">
          {org ? '실사 업체 설정' : '새 실사 업체'}
        </DialogTitle>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-[18px]">
          <div className="space-y-2">
            <Label htmlFor="org-name" className={FIELD_LABEL}>
              업체 이름
            </Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="그린리서치"
              className={FIELD_INPUT}
              autoFocus
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-memo" className={FIELD_LABEL}>
              메모 (선택)
            </Label>
            <Input
              id="org-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="담당자·계약 메모"
              className={FIELD_INPUT}
              maxLength={200}
            />
            <p className={FIELD_HINT}>운영 참고용입니다. 권한 판정에는 쓰이지 않습니다.</p>
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="h-[38px] rounded-[9px] border-[#D1D5DB] px-4 text-[13px] font-semibold text-[#374151]"
            >
              취소
            </Button>
            <Button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
              {isPending ? '저장 중...' : org ? '저장' : '생성'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
