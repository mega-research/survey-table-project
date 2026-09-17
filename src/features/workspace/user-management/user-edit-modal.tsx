'use client';

import { useState } from 'react';

import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import {
  FIELDWORK_ROLE_LABEL,
  type FieldworkRole,
  fieldworkRoleValues,
} from '@/shared/contracts/auth';
import { UpdateUserInput, type UserListItem } from '@/shared/contracts/auth-io';

import { USER_TYPE_LABEL } from '../account-vocabulary';
import { FIELD_INPUT, FIELD_LABEL } from '../field-styles';
import { useFieldworkOrgOptions } from '../fieldwork-orgs/queries/use-fieldwork-orgs';
import { SegmentedChoice } from '../segmented-choice';
import { useUpdateUser } from './queries/use-users';

interface Props {
  user: UserListItem;
  onClose: () => void;
}

/**
 * 사용자 정보 편집 모달 — 이름·이메일과 유형별 소속 칸(직책·소속 기관·실사 업체와 역할).
 *
 * 유형은 보여주기만 한다 — 유형 전환은 이 표면 밖이다(UpdateUserInput 주석). 비밀번호와
 * 상태는 케밥의 각자 입구가 맡는다. 팀 소속은 팀 관리가 맡는다.
 */
export function UserEditModal({ user, onClose }: Props) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const [organization, setOrganization] = useState(user.organization ?? '');
  const [fieldworkOrgId, setFieldworkOrgId] = useState(user.fieldworkOrgId ?? '');
  const [fieldworkRole, setFieldworkRole] = useState<FieldworkRole>(
    user.fieldworkRole ?? 'worker',
  );
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: updateUser, isPending } = useUpdateUser();
  const { data: orgOptions } = useFieldworkOrgOptions(user.userType === 'fieldwork');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const common = { userId: user.id, name, email };
    // 규칙은 경계 계약 한 곳에만 둔다 — 생성 모달과 같은 방식이다.
    const parsed = UpdateUserInput.safeParse(
      user.userType === 'internal'
        ? { userType: 'internal', ...common, jobTitle }
        : user.userType === 'guest'
          ? { userType: 'guest', ...common, organization }
          : { userType: 'fieldwork', ...common, fieldworkOrgId, fieldworkRole },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
      return;
    }

    try {
      await updateUser(parsed.data);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '사용자 정보를 저장하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[520px] gap-0 rounded-2xl p-7">
        <DialogTitle className="text-[16.5px] font-semibold text-[#1C1C1E]">
          사용자 정보 편집
        </DialogTitle>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-[18px]">
          <div className="space-y-2">
            <span className={FIELD_LABEL}>계정 유형</span>
            <p className="text-[13px] text-[#3A3A3C]">{USER_TYPE_LABEL[user.userType]}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-user-name" className={FIELD_LABEL}>
              이름
            </Label>
            <Input
              id="edit-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
              className={FIELD_INPUT}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-user-email" className={FIELD_LABEL}>
              이메일 (로그인 ID)
            </Label>
            <Input
              id="edit-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={FIELD_INPUT}
            />
            <p className="text-[10.5px] text-[#9CA3AF]">
              바꾸면 다음 로그인부터 새 이메일로 로그인합니다.
            </p>
          </div>

          {user.userType === 'internal' && (
            <div className="space-y-2">
              <Label htmlFor="edit-user-job-title" className={FIELD_LABEL}>
                직책
              </Label>
              <Input
                id="edit-user-job-title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={50}
                className={FIELD_INPUT}
              />
            </div>
          )}

          {user.userType === 'guest' && (
            <div className="space-y-2">
              <Label htmlFor="edit-user-organization" className={FIELD_LABEL}>
                소속 기관
              </Label>
              <Input
                id="edit-user-organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                maxLength={100}
                className={FIELD_INPUT}
              />
            </div>
          )}

          {user.userType === 'fieldwork' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-user-fieldwork-org" className={FIELD_LABEL}>
                  소속 업체
                </Label>
                <select
                  id="edit-user-fieldwork-org"
                  value={fieldworkOrgId}
                  onChange={(e) => setFieldworkOrgId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#D1D5DB] bg-white px-2 text-[13px] text-[#3A3A3C]"
                >
                  <option value="">업체를 선택하세요</option>
                  {/* 현재 업체가 선택지(활성 업체)에 없으면 이름만이라도 남긴다 — 비우면 저장 시
                      소속이 사라진 것처럼 보인다. 그대로 저장하면 서버가 종료 여부를 다시 본다. */}
                  {user.fieldworkOrgId &&
                    !(orgOptions ?? []).some((org) => org.id === user.fieldworkOrgId) && (
                      <option value={user.fieldworkOrgId}>
                        {user.fieldworkOrgName ?? '현재 업체'}
                      </option>
                    )}
                  {(orgOptions ?? []).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <span className={FIELD_LABEL}>역할</span>
                <SegmentedChoice
                  options={fieldworkRoleValues}
                  value={fieldworkRole}
                  label={(role) => FIELDWORK_ROLE_LABEL[role]}
                  onChange={setFieldworkRole}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="h-[34px] rounded-[9px] border-[#D1D5DB] px-4 text-[13px] font-semibold text-[#374151]"
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-[34px] rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
            >
              {isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
