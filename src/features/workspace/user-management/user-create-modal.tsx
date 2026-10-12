'use client';

import { useState } from 'react';

import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/get-error-message';
import {
  CreateUserInput,
  MIN_PASSWORD_LENGTH,
  type creatableUserTypes,
} from '@/shared/contracts/auth-io';

import { FIELD_INPUT, FIELD_LABEL } from '../field-styles';
import { useCreateUser } from './queries/use-users';

/**
 * 이 창이 만드는 유형 — **내부 하나다** (ADR-0029, 2026-10-12).
 *
 * .pen FLOW 1-2 에는 유형 세그먼트(직원 | 게스트 | 실사)가 있었다. 외주 실사와 클라이언트가
 * 둘 다 설문별 링크로 바뀌어 그 두 유형의 계정을 쓸 곳이 사라졌고, 고를 것이 하나뿐이라
 * 세그먼트 자체를 그리지 않는다 — 선택지가 하나인 선택 컨트롤은 「다른 유형도 있었나」만
 * 묻게 만든다. 게스트 전용이던 소속 기관 칸도 함께 없다.
 *
 * 닫은 것은 입구다. 서버의 발급 표면도 같은 목록(`creatableUserTypes`)으로 막고, 옛 모델의
 * 코드·테이블과 이미 있는 계정은 그대로다 — 철거는 링크 모델로 실제 조사 한 건을
 * 프로덕션에서 끝낸 뒤의 일이다.
 *
 * 값을 계약의 목록에 `satisfies` 로 묶어 둔다 — 그 목록에서 내부 유형이 빠지거나 발급 유형이
 * 다시 늘면 여기서 컴파일이 멈춰, 화면만 옛 모양으로 남지 않는다.
 */
const CREATED_USER_TYPE = 'internal' satisfies (typeof creatableUserTypes)[number];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY = { name: '', email: '', password: '', jobTitle: '' };

/**
 * 사용자 생성 모달 — 슈퍼어드민이 계정을 직접 발급한다(ADR-0018).
 * 생성 즉시 active 라 승인 단계도 안내 메일도 없다.
 */
export function UserCreateModal({ open, onOpenChange }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: createUser, isPending } = useCreateUser();

  function set(field: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function close() {
    setForm(EMPTY);
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // 규칙은 경계 계약 한 곳에만 둔다 — 여기서 길이·형식을 손으로 재현하면 서버와 갈린다.
    const parsed = CreateUserInput.safeParse({
      userType: CREATED_USER_TYPE,
      name: form.name,
      email: form.email,
      password: form.password,
      jobTitle: form.jobTitle,
    });
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

          <p className="text-[11px] text-[#9CA3AF]">
            생성 즉시 재직 중이라 이 계정으로 바로 로그인할 수 있습니다. 승인 단계와 안내 메일은
            없습니다.
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
