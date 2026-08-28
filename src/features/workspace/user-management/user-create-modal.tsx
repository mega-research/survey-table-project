'use client';

import { useState } from 'react';

import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import type { UserType } from '@/shared/contracts/auth';
import { CreateUserInput, MIN_PASSWORD_LENGTH } from '@/shared/contracts/auth-io';

import { FIELD_INPUT, FIELD_LABEL } from '../field-styles';
import { useCreateUser } from './queries/use-users';
import { USER_TYPE_LABEL } from './user-vocabulary';

/**
 * 유형 세그먼트 — .pen FLOW 1-2. 실사는 노출하되 비활성이다: 실사 계정은 소속 업체가
 * 있어야 성립하고 그 엔티티(fieldwork_orgs)는 티켓 24 에서 생긴다.
 */
const TYPE_SEGMENTS: { value: UserType; disabled?: boolean }[] = [
  { value: 'internal' },
  { value: 'guest' },
  { value: 'fieldwork', disabled: true },
];

type CreatableType = Extract<UserType, 'internal' | 'guest'>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY = { name: '', email: '', password: '', jobTitle: '', organization: '' };

/**
 * 사용자 생성 모달 — 슈퍼어드민이 계정을 직접 발급한다(ADR-0018).
 * 생성 즉시 active 라 승인 단계도 안내 메일도 없다.
 */
export function UserCreateModal({ open, onOpenChange }: Props) {
  const [userType, setUserType] = useState<CreatableType>('internal');
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: createUser, isPending } = useCreateUser();

  function set(field: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function close() {
    setForm(EMPTY);
    setUserType('internal');
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const common = { name: form.name, email: form.email, password: form.password };
    // 규칙은 경계 계약 한 곳에만 둔다 — 여기서 길이·형식을 손으로 재현하면 서버와 갈린다.
    const parsed = CreateUserInput.safeParse(
      userType === 'internal'
        ? { userType: 'internal', ...common, jobTitle: form.jobTitle }
        : { userType: 'guest', ...common, organization: form.organization },
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
            <div className="flex gap-1 rounded-[10px] bg-[#EEF0F4] p-[3px]">
              {TYPE_SEGMENTS.map((segment) => {
                const selected = segment.value === userType;
                return (
                  <button
                    key={segment.value}
                    type="button"
                    disabled={segment.disabled}
                    aria-pressed={selected}
                    title={segment.disabled ? '실사 업체 관리 이후에 열립니다.' : undefined}
                    onClick={() => setUserType(segment.value as CreatableType)}
                    className={`h-[30px] flex-1 rounded-lg text-[12.5px] transition-colors ${
                      selected
                        ? 'bg-white font-semibold text-[#2743AE] shadow-sm'
                        : 'text-[#6E6E73] hover:text-[#3A3A3C]'
                    } ${segment.disabled ? 'cursor-not-allowed opacity-50 hover:text-[#6E6E73]' : ''}`}
                  >
                    {USER_TYPE_LABEL[segment.value]}
                  </button>
                );
              })}
            </div>
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

          {userType === 'internal' ? (
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
                {/* 팀 엔티티는 티켓 06 에서 생긴다 — 자리만 두고 비활성으로 표시한다. */}
                <Input
                  id="user-team"
                  disabled
                  placeholder="팀 기능 도입 후 사용"
                  className={FIELD_INPUT}
                />
              </div>
            </div>
          ) : (
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

          <p className="text-[11px] text-[#9CA3AF]">
            생성 즉시 재직 중이라 이 계정으로 바로 로그인할 수 있습니다. 승인 단계와 안내 메일은
            없습니다. 실사 유형은 실사 업체 관리 이후에 열립니다.
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
