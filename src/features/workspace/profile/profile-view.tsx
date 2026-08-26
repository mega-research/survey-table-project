'use client';

import { useRef, useState } from 'react';

import Link from 'next/link';

import { AlertCircle, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';

import { LogoutButton } from '@/components/auth/logout-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { accountHomePath } from '@/lib/auth/account-home';
import { getErrorMessage } from '@/lib/get-error-message';
import { isInternalUser } from '@/shared/contracts/auth';
import type { ProfileView as Profile } from '@/shared/contracts/auth-io';
import { MIN_PASSWORD_LENGTH } from '@/shared/contracts/auth-io';

import { FIELD_INPUT, FIELD_LABEL } from '../user-management/field-styles';
import { useProfile, useUpdatePassword, useUpdateProfile, uploadAvatar } from './queries/use-profile';

/** 아바타 입력 정책 — 서버 라우트(/api/upload/avatar)와 같은 값이어야 한다. */
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/bmp';
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const CARD = 'rounded-[14px] border border-[#E5E5EA] bg-white p-6';
const CARD_TITLE = 'text-[15px] font-semibold text-[#1C1C1E]';
const NOTE = 'text-[11px] text-[#9CA3AF]';
const READONLY_INPUT = `${FIELD_INPUT} bg-[#F5F5F7] text-[#6E6E73]`;

function Banner({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-green-200 bg-green-50 text-green-700';
  const Icon = tone === 'error' ? AlertCircle : CheckCircle;
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-3 text-[12.5px] ${styles}`}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** 기본 정보 — 아바타·이름은 본인이 바꾸고, 이메일·직책은 읽기 전용이다 (.pen FLOW 3-2). */
function BasicInfoCard({ profile }: { profile: Profile }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile.name);
  // 저장 전 미리보기까지 상태로 들고 있는다 — 업로드는 끝났지만 아직 저장하지 않은 값이다.
  const [image, setImage] = useState<string | null>(profile.image);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { mutateAsync: updateProfile, isPending } = useUpdateProfile();

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 골라도 change 가 나도록 값을 비운다.
    event.target.value = '';
    if (!file) return;

    setError(null);
    setSaved(false);
    if (!AVATAR_ACCEPT.split(',').includes(file.type)) {
      setError('JPG, PNG, WebP, BMP 파일만 올릴 수 있습니다.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('파일 크기는 5MB 이하여야 합니다.');
      return;
    }

    setUploading(true);
    try {
      setImage(await uploadAvatar(file));
    } catch (err) {
      setError(getErrorMessage(err, '아바타를 업로드하지 못했습니다.'));
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ name: name.trim(), image });
      setSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, '프로필을 저장하지 못했습니다.'));
    }
  }

  return (
    <form onSubmit={handleSave} className={`${CARD} space-y-5`}>
      <h2 className={CARD_TITLE}>기본 정보</h2>

      <div className="flex items-center gap-4">
        <span className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full bg-[#E0E7FF] text-[24px] font-semibold text-[#2743AE]">
          {image ? (
            // 아바타는 R2 공개 URL 이라 next/image 최적화 대상이 아니다(원격 도메인 설정 불필요).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-cover" />
          ) : (
            profile.name.slice(0, 1)
          )}
        </span>
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="h-[32px] rounded-[9px] border-[#D1D5DB] px-3 text-[12.5px] font-semibold text-[#374151]"
          >
            {uploading ? '업로드 중...' : '이미지 변경'}
          </Button>
          <p className={NOTE}>PNG·JPG · 업로드 시 자동 리사이즈</p>
          {image && (
            <button
              type="button"
              onClick={() => setImage(null)}
              className="text-[11px] text-[#6E6E73] underline hover:text-[#1C1C1E]"
            >
              기본 이미지로 되돌리기
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={AVATAR_ACCEPT}
          onChange={handlePick}
          className="hidden"
          aria-label="아바타 이미지 파일"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-name" className={FIELD_LABEL}>
          이름
        </Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={50}
          className={FIELD_INPUT}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="profile-email" className={FIELD_LABEL}>
            이메일 (로그인 ID)
          </Label>
          <Input id="profile-email" value={profile.email} readOnly className={READONLY_INPUT} />
        </div>
        {isInternalUser(profile.userType) ? (
          <div className="space-y-2">
            <Label htmlFor="profile-job-title" className={FIELD_LABEL}>
              직책
            </Label>
            <Input
              id="profile-job-title"
              value={profile.jobTitle ?? '—'}
              readOnly
              className={READONLY_INPUT}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="profile-organization" className={FIELD_LABEL}>
              소속
            </Label>
            <Input
              id="profile-organization"
              value={profile.organization ?? '—'}
              readOnly
              className={READONLY_INPUT}
            />
          </div>
        )}
      </div>

      <p className={NOTE}>
        {isInternalUser(profile.userType)
          ? '이메일·직책은 본인이 수정할 수 없습니다 — 직책은 팀장·슈퍼어드민이 팀 상세에서 변경합니다.'
          : '이메일·소속은 본인이 수정할 수 없습니다 — 담당 연구원에게 요청하세요.'}
      </p>

      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="success">프로필을 저장했습니다.</Banner>}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || uploading}
          className="h-[34px] rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
        >
          {isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </form>
  );
}

const EMPTY_PASSWORDS = { currentPassword: '', newPassword: '', confirmPassword: '' };

/** 비밀번호 변경 — 현재 비밀번호 재인증 + 다른 기기 세션 해제 (현재 세션 유지). */
function PasswordCard() {
  const [form, setForm] = useState(EMPTY_PASSWORDS);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const { mutateAsync: updatePassword, isPending } = useUpdatePassword();

  function set(field: keyof typeof EMPTY_PASSWORDS, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setChanged(false);
    try {
      // 실패가 예외가 아니라 { error } 로 온다 — mutation 성공이 곧 변경 성공은 아니다.
      const result = await updatePassword(form);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setForm(EMPTY_PASSWORDS);
      setChanged(true);
    } catch (err) {
      setError(getErrorMessage(err, '비밀번호를 변경하지 못했습니다.'));
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} space-y-5`}>
      <h2 className={CARD_TITLE}>비밀번호 변경</h2>

      <div className="space-y-2">
        <Label htmlFor="current-password" className={FIELD_LABEL}>
          현재 비밀번호
        </Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(e) => set('currentPassword', e.target.value)}
          required
          className={FIELD_INPUT}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="new-password" className={FIELD_LABEL}>
            새 비밀번호
          </Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => set('newPassword', e.target.value)}
            required
            className={FIELD_INPUT}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password" className={FIELD_LABEL}>
            새 비밀번호 확인
          </Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => set('confirmPassword', e.target.value)}
            required
            className={FIELD_INPUT}
          />
        </div>
      </div>

      <p className={NOTE}>
        {MIN_PASSWORD_LENGTH}자 이상. 변경하면 다른 기기의 로그인이 모두 해제됩니다 (현재 세션
        유지).
      </p>

      {error && <Banner tone="error">{error}</Banner>}
      {changed && <Banner tone="success">비밀번호를 변경했습니다.</Banner>}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending}
          className="h-[34px] rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
        >
          {isPending ? '변경 중...' : '비밀번호 변경'}
        </Button>
      </div>
    </form>
  );
}

/**
 * 프로필 (.pen FLOW 3-2) — 세 계정 유형 공통 화면.
 *
 * 내부는 사이드바 하단 프로필 메뉴(티켓 08)로, 게스트·실사는 각자 홈의 사용자 메뉴로
 * 들어온다. 돌아갈 곳도 유형마다 다르므로 프로필이 알려주는 유형에서 홈을 계산한다.
 */
export function ProfileView() {
  const { data: profile, isLoading, error } = useProfile();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-[#F9FAFB] text-[13px] text-[#6E6E73]">
        <Loader2 className="h-4 w-4 animate-spin" />
        프로필을 불러오는 중...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] text-[13px] text-red-600">
        프로필을 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-[720px] space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href={accountHomePath(profile.userType)}
            className="inline-flex items-center gap-1 text-[13px] text-[#6E6E73] hover:text-[#1C1C1E]"
          >
            <ArrowLeft className="h-4 w-4" />
            돌아가기
          </Link>
          <LogoutButton />
        </div>

        <div className="space-y-1">
          <h1 className="text-[22px] font-semibold text-[#1C1C1E]">프로필</h1>
          <p className="text-[13px] text-[#6E6E73]">내 계정 정보를 관리합니다.</p>
        </div>

        <BasicInfoCard profile={profile} />
        <PasswordCard />
      </div>
    </div>
  );
}
