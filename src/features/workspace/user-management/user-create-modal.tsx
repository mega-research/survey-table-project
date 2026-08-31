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
  type UserType,
  fieldworkRoleValues,
} from '@/shared/contracts/auth';
import {
  CreateUserInput,
  MIN_PASSWORD_LENGTH,
  creatableUserTypes,
} from '@/shared/contracts/auth-io';

import { USER_TYPE_LABEL } from '../account-vocabulary';
import { FIELD_INPUT, FIELD_LABEL } from '../field-styles';
import { useFieldworkOrgOptions } from '../fieldwork-orgs/queries/use-fieldwork-orgs';
import { SegmentedChoice } from '../segmented-choice';
import { useCreateUser } from './queries/use-users';

/**
 * 유형 세그먼트 — .pen FLOW 1-2. 티켓 24 로 셋 전부가 열렸다.
 *
 * 어휘(`creatableUserTypes`)를 그대로 쓰므로 발급 가능한 유형이 늘거나 줄면 세그먼트가
 * 저절로 따라간다 — 목록을 손으로 적으면 계약과 화면이 갈린다.
 */
const TYPE_SEGMENTS: readonly UserType[] = creatableUserTypes;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 업체 카드의 「+ 계정 발급」이 넘기는 소속 업체 (.pen FLOW 10-4).
   *
   * 있으면 유형이 실사로 고정되고 업체 셀렉트가 그 값으로 잠긴다 — 「이 업체에 계정을
   * 만든다」가 그 버튼의 뜻이라, 열린 모달에서 업체를 바꿀 수 있으면 버튼이 거짓말이 된다.
   */
  presetFieldworkOrgId?: string;
}

const EMPTY = { name: '', email: '', password: '', jobTitle: '', organization: '' };

/**
 * 사용자 생성 모달 — 슈퍼어드민이 계정을 직접 발급한다(ADR-0018).
 * 생성 즉시 active 라 승인 단계도 안내 메일도 없다.
 */
export function UserCreateModal({ open, onOpenChange, presetFieldworkOrgId }: Props) {
  const [userType, setUserType] = useState<UserType>(
    presetFieldworkOrgId ? 'fieldwork' : 'internal',
  );
  const [form, setForm] = useState(EMPTY);
  const [fieldworkOrgId, setFieldworkOrgId] = useState(presetFieldworkOrgId ?? '');
  const [fieldworkRole, setFieldworkRole] = useState<FieldworkRole>('worker');
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: createUser, isPending } = useCreateUser();
  // 실사 칸이 보일 때만 선택지를 당긴다 — 내부·게스트 발급에 업체 목록은 필요 없다.
  const { data: orgOptions } = useFieldworkOrgOptions(userType === 'fieldwork');

  function set(field: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function close() {
    setForm(EMPTY);
    setUserType(presetFieldworkOrgId ? 'fieldwork' : 'internal');
    setFieldworkOrgId(presetFieldworkOrgId ?? '');
    setFieldworkRole('worker');
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const common = { name: form.name, email: form.email, password: form.password };
    // 규칙은 경계 계약 한 곳에만 둔다 — 여기서 길이·형식을 손으로 재현하면 서버와 갈린다.
    // 유형별 칸의 차이도 그 유니온이 정한다: 실사에 업체를 안 고르면 여기서 문구가 나온다.
    const parsed = CreateUserInput.safeParse(
      userType === 'internal'
        ? { userType: 'internal', ...common, jobTitle: form.jobTitle }
        : userType === 'guest'
          ? { userType: 'guest', ...common, organization: form.organization }
          : { userType: 'fieldwork', ...common, fieldworkOrgId, fieldworkRole },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
      return;
    }

    try {
      await createUser(parsed.data);
      close();
    } catch (err) {
      // 서버가 유일한 판정자다 — 이메일 중복(CONFLICT)·입력 검증 실패 문구를 그대로 보여준다.
      setError(getErrorMessage(err, '계정을 생성하지 못했습니다.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-[520px] gap-0 rounded-2xl p-7">
        <DialogTitle className="text-[16.5px] font-semibold text-[#1C1C1E]">
          사용자 생성
        </DialogTitle>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-[18px]">
          <div className="space-y-2">
            <span className={FIELD_LABEL}>계정 유형</span>
            {/* 업체 카드에서 연 발급은 유형이 실사로 못 박혀 있다 — 그 버튼의 뜻이
                「이 업체에 계정을 만든다」라서 유형을 바꾸면 소속이 사라진다. */}
            <SegmentedChoice
              options={TYPE_SEGMENTS}
              value={userType}
              label={(value) => USER_TYPE_LABEL[value]}
              onChange={setUserType}
              isDisabled={(value) => presetFieldworkOrgId !== undefined && value !== 'fieldwork'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-name" className={FIELD_LABEL}>
              이름
            </Label>
            <Input
              id="user-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              maxLength={50}
              className={FIELD_INPUT}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-email" className={FIELD_LABEL}>
              이메일 (로그인 ID)
            </Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              required
              className={FIELD_INPUT}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="user-password" className={FIELD_LABEL}>
              초기 비밀번호
            </Label>
            <Input
              id="user-password"
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              required
              className={FIELD_INPUT}
            />
            <p className="text-[10.5px] text-[#9CA3AF]">
              {MIN_PASSWORD_LENGTH}자 이상 · 사내 채널로 전달 · 본인이 프로필에서 변경
            </p>
          </div>

          {userType === 'internal' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="user-job-title" className={FIELD_LABEL}>
                  직책
                </Label>
                <Input
                  id="user-job-title"
                  value={form.jobTitle}
                  onChange={(e) => set('jobTitle', e.target.value)}
                  maxLength={50}
                  className={FIELD_INPUT}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-team" className={FIELD_LABEL}>
                  팀 배정 (선택)
                </Label>
                {/* 팀 배정은 팀 관리(.pen FLOW 7-2)의 「팀원 추가」가 한다 — 발급 시점에
                    겸직·역할까지 고르게 하면 같은 규칙이 두 화면에 복제된다. */}
                <Input
                  id="user-team"
                  disabled
                  placeholder="팀 관리에서 배정"
                  className={FIELD_INPUT}
                />
              </div>
            </div>
          )}

          {userType === 'guest' && (
            <div className="space-y-2">
              <Label htmlFor="user-organization" className={FIELD_LABEL}>
                소속 기관
              </Label>
              <Input
                id="user-organization"
                value={form.organization}
                onChange={(e) => set('organization', e.target.value)}
                maxLength={100}
                placeholder="한국물류협회"
                className={FIELD_INPUT}
              />
            </div>
          )}

          {userType === 'fieldwork' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="user-fieldwork-org" className={FIELD_LABEL}>
                  소속 업체
                </Label>
                <select
                  id="user-fieldwork-org"
                  value={fieldworkOrgId}
                  onChange={(e) => setFieldworkOrgId(e.target.value)}
                  disabled={presetFieldworkOrgId !== undefined}
                  className="h-9 w-full rounded-lg border border-[#D1D5DB] bg-white px-2 text-[13px] text-[#3A3A3C] disabled:opacity-60"
                >
                  <option value="">업체를 선택하세요</option>
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

          <p className="text-[11px] text-[#9CA3AF]">
            생성 즉시 재직 중이라 이 계정으로 바로 로그인할 수 있습니다. 승인 단계와 안내 메일은
            없습니다.
            {userType === 'fieldwork'
              ? ' 실사 계정은 소속 업체와 역할이 반드시 있어야 합니다.'
              : ''}
          </p>

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
              onClick={close}
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
              {isPending ? '생성 중...' : '생성'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
