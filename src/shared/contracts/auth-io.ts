// 계정 경계 계약 — 사용자 관리(목록·직접 생성)가 경계를 건너는 모양.
// 같은 폴더의 auth.ts — 계정 어휘(status·user_type) SSOT. 이 파일 — 서버와 UI 사이 RPC 입출력.
// client-safe — server-only·Node·DB 의존 없음(zod 는 런타임 의존).
import * as z from 'zod';

import {
  fieldworkRoleValues,
  type UserStatus,
  type UserStatusAction,
  type UserType,
  userStatusValues,
  userTypeValues,
} from './auth';
import { teamRoleValues } from './workspace';
// 퇴사 입력이 승계 지정을 함께 받는다(티켓 19) — 계약 파일끼리는 서로를 볼 수 있다.
import { SuccessionAssignment } from './workspace-io';

// ─────────────────────────────────────────────────────────────────────────────
// 필터 어휘
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 사용자 관리에서 고를 수 있는 상태.
 *
 * pending/rejected 는 v2 에서 도달 불가 어휘라(ADR-0018) 필터에 두지 않는다 — 만들 수 없는
 * 상태를 거르는 선택지는 화면에서 늘 0건이고, .pen FLOW 1-1 에도 승인 대기·거절 필터가 없다.
 * 목록 자체는 상태로 좁히지 않으면 전 상태를 그대로 보여주므로, 과거 데이터가 실려 있어도
 * 사라지지는 않는다.
 */
export const selectableUserStatusValues = [
  'active',
  'suspended',
  'departed',
] as const satisfies readonly UserStatus[];

/** 목록 필터 값 — 'all' 은 좁히지 않음. */
export const UserTypeFilter = z.enum(['all', ...userTypeValues]);
export type UserTypeFilter = z.infer<typeof UserTypeFilter>;

export const UserStatusFilter = z.enum(['all', ...userStatusValues]);
export type UserStatusFilter = z.infer<typeof UserStatusFilter>;

// ─────────────────────────────────────────────────────────────────────────────
// 목록
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 사용자 관리 목록 한 행.
 *
 * 「소속」 열은 유형마다 출처가 다르다 — internal 은 팀(티켓 06), guest 는 organization,
 * fieldwork 는 실사 업체(티켓 24). 팀만 아직 이 모양에 없다: 겸직이 가능해 값이 하나가
 * 아니고(team_members 는 여러 행), 팀 축의 화면은 팀 관리(.pen FLOW 7)가 따로 진다.
 */
export const UserListItem = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  userType: z.enum(userTypeValues),
  status: z.enum(userStatusValues),
  isSuperadmin: z.boolean(),
  /** 직책 — internal 전용 자유 입력. */
  jobTitle: z.string().nullable(),
  /** 소속 기관 메모 — guest 전용 자유 입력. */
  organization: z.string().nullable(),
  /** 소속 실사 업체 이름 — fieldwork 전용. 조인으로 채운다(티켓 24). */
  fieldworkOrgName: z.string().nullable(),
  /** 업체 내 역할 — fieldwork 전용. 「직책·역할」 열이 직책 대신 이 값을 그린다. */
  fieldworkRole: z.enum(fieldworkRoleValues).nullable(),
  /** 가입일 — 직렬화 경계를 건너므로 ISO 문자열. */
  createdAt: z.string(),
});
export type UserListItem = z.infer<typeof UserListItem>;

export const ListUsersInput = z.object({
  userType: UserTypeFilter.default('all'),
  status: UserStatusFilter.default('all'),
});
export type ListUsersInput = z.infer<typeof ListUsersInput>;

/**
 * 목록 + 유형 칩 카운트.
 *
 * 카운트는 **상태 필터만 반영하고 유형 필터는 반영하지 않는다** — 칩은 "지금 유형을 바꾸면
 * 몇 건이 보이는가"를 알려주는 자리라, 선택된 유형으로 카운트까지 좁으면 나머지 칩이 전부
 * 0 이 되어 쓸모가 없다.
 */
export const ListUsersOutput = z.object({
  items: z.array(UserListItem),
  typeCounts: z.object({
    all: z.number().int(),
    internal: z.number().int(),
    guest: z.number().int(),
    fieldwork: z.number().int(),
  }),
});
export type ListUsersOutput = z.infer<typeof ListUsersOutput>;

// ─────────────────────────────────────────────────────────────────────────────
// 직접 생성
// ─────────────────────────────────────────────────────────────────────────────

/** 전역 비밀번호 정책 — Better Auth emailAndPassword.minPasswordLength 와 같은 값이어야 한다. */
export const MIN_PASSWORD_LENGTH = 8;
/** Better Auth 기본 maxPasswordLength. 해시 비용 상한이지 정책이 아니다. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * 비밀번호 입력 — 발급·재설정·재입사가 같은 규칙을 본다.
 * 규칙이 갈리면 발급만 8자를 강제하고 재설정으로는 짧은 비밀번호가 들어온다.
 */
const PasswordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`)
  .max(MAX_PASSWORD_LENGTH);

const CreateUserCommon = z.object({
  name: z.string().trim().min(1, '이름을 입력하세요.').max(50),
  // Better Auth 가 이메일을 소문자로 저장·조회하므로 경계에서 같은 규칙으로 정규화한다.
  email: z.string().trim().toLowerCase().pipe(z.email('이메일 형식이 올바르지 않습니다.').max(255)),
  password: PasswordField,
});

/**
 * 비우고 보낼 수 있는 자유 입력 — 공백만 남은 값은 미입력으로 접는다.
 *
 * 폼은 비운 칸을 빈 문자열로 보낸다. 그대로 저장하면 DB 에 `''` 가 남아 목록의
 * `?? '—'` 폴백이 걸리지 않고 셀이 빈칸으로 렌더된다(값 없음과 빈 값이 갈린다).
 */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value ? value : undefined))
    .optional();
}

/**
 * 사용자 직접 생성 입력.
 *
 * **유형마다 소속의 출처가 다르고, 그 차이가 유니온의 존재 이유다.** internal 은 직책(팀은
 * 팀 관리에서 붙인다), guest 는 자유 입력 기관명, fieldwork 는 **업체 id + 역할**이다.
 * 실사만 두 칸이 필수인 것은 소속 없는 실사 계정이 성립하지 않기 때문이다(0120 의
 * users_fieldwork_fields_check). 유니온이 그 필수성을 경계에서 이미 강제하므로, 서비스의
 * 업체 검증은 「그 id 가 정말 활성 업체인가」만 묻는다.
 */
export const CreateUserInput = z.discriminatedUnion('userType', [
  CreateUserCommon.extend({
    userType: z.literal('internal'),
    jobTitle: optionalText(50),
  }),
  CreateUserCommon.extend({
    userType: z.literal('guest'),
    organization: optionalText(100),
  }),
  CreateUserCommon.extend({
    userType: z.literal('fieldwork'),
    fieldworkOrgId: z.uuid('소속 업체를 선택하세요.'),
    fieldworkRole: z.enum(fieldworkRoleValues),
  }),
]);
export type CreateUserInput = z.infer<typeof CreateUserInput>;

/**
 * 생성 가능한 유형 — 모달 세그먼트의 활성 여부 판정에 UI 도 쓴다.
 *
 * 티켓 24 로 셋 전부가 열렸지만 **손으로 적은 목록으로 남긴다.** `userTypeValues` 를 그대로
 * 가리키면 새 유형이 어휘에 추가되는 순간 발급 경로가 없는데도 모달 세그먼트가 저절로
 * 열린다 — 그때 실제로 눌러 보기 전까지 아무도 모른다. 지금은 값이 같지만 묻는 질문이 다르다:
 * 「존재하는 유형」과 「이 화면에서 발급할 수 있는 유형」.
 */
export const creatableUserTypes = [
  'internal',
  'guest',
  'fieldwork',
] as const satisfies readonly UserType[];

export const CreateUserOutput = z.object({ id: z.uuid() });
export type CreateUserOutput = z.infer<typeof CreateUserOutput>;

// ─────────────────────────────────────────────────────────────────────────────
// 상태 전이 · 비밀번호 재설정
// ─────────────────────────────────────────────────────────────────────────────

const UserTarget = z.object({ userId: z.uuid() });

/**
 * 상태 전이 입력 — action 판별 유니온.
 *
 * 재입사만 모양이 다르다. ADR-0010 에 따라 퇴사자는 일반 재직 복귀로 살리지 않고
 * "새로 시작"시키므로 임시 비밀번호를 함께 정한다(전 세션은 이미 퇴사 시점에 폐기됐고,
 * 이 전이도 다시 폐기한다). 직책은 필요하면 이 자리에서 고칠 수 있다.
 *
 * **재입사만 팀 배정을 함께 받는다**(.pen FLOW 9-4 의 별표, 티켓 14). 재입사를 「새 소속으로
 * 다시 시작」이라고 부르는 이상 목적지를 여기서 받아야 한다. 상태 전이와 배정은 한
 * 트랜잭션이다(server/workflows/user-rehire).
 *
 * 필드가 **nullable 인 이유**는 팀에 소속될 수 없는 계정이 있어서다 — guest·fieldwork 는
 * 멤버십 자체가 금지고(스펙 §1) 슈퍼어드민은 팀 소속과 무관한 전역 관리자다(CONTEXT.md).
 * 그 계정들까지 팀을 요구하면 한 번 퇴사한 뒤 영영 돌아올 수 없다. 「필수」는 계약이 아니라
 * **유형별 규칙**이라 서버가 대상의 유형을 읽고 강제한다(화면도 같은 규칙으로 칸을 감춘다).
 */
export const ChangeUserStatusInput = z.discriminatedUnion('action', [
  UserTarget.extend({ action: z.literal('suspend') }),
  UserTarget.extend({ action: z.literal('resume') }),
  UserTarget.extend({
    action: z.literal('depart'),
    /**
     * 소유 설문의 승계 지정 (.pen FLOW 9-3, 티켓 19).
     *
     * **소유 설문 전수를 적어야 한다** — 서버가 대조해 빠진 것이 있으면 거부한다. 빠뜨린
     * 설문을 조용히 승계 대기로 흘려보내면 화면이 보여준 것과 결과가 달라지고, 그 차이는
     * 재배치 인박스에서야 드러난다. `newOwnerUserId: null` 은 「후보 없음 — 승계 대기로」
     * 라는 **명시적 선택**이다.
     *
     * 소유 설문이 없으면 빈 배열이다. 옵셔널로 두지 않는 것은 「안 보냈다」와 「없다」를
     * 서버가 구별할 이유가 없어서다 — 어느 쪽이든 전수 대조가 답을 낸다.
     */
    succession: z.array(SuccessionAssignment),
  }),
  UserTarget.extend({
    action: z.literal('rehire'),
    password: PasswordField,
    jobTitle: optionalText(50),
    /**
     * 새 소속 팀. 내부 일반 계정에는 **필수**다 — 비우면 미배치로 되살아나 재배치 센터로
     * 다시 흘러간다. 팀에 소속될 수 없는 계정(guest·fieldwork·슈퍼어드민)에는 null 이어야 한다.
     */
    teamId: z.uuid().nullable(),
    teamRole: z.enum(teamRoleValues).nullable(),
  }),
]);
export type ChangeUserStatusInput = z.infer<typeof ChangeUserStatusInput>;

/** 전이 후 상태 — 화면이 낙관적 갱신 없이 결과를 확인하는 값. */
export const ChangeUserStatusOutput = z.object({ status: z.enum(userStatusValues) });
export type ChangeUserStatusOutput = z.infer<typeof ChangeUserStatusOutput>;

/**
 * 비밀번호 재설정 입력 — 이메일 링크 플로우는 없다(.pen FLOW 1-3).
 * 슈퍼어드민이 새 임시 비밀번호를 정하고 사내 채널로 전달한다.
 */
export const ResetUserPasswordInput = UserTarget.extend({ password: PasswordField });
export type ResetUserPasswordInput = z.infer<typeof ResetUserPasswordInput>;

export const ResetUserPasswordOutput = z.object({ success: z.literal(true) });
export type ResetUserPasswordOutput = z.infer<typeof ResetUserPasswordOutput>;

/**
 * 역방향 포함 검사 — 어휘(userStatusActionValues)에 action 이 늘면 이 return 할당이
 * 컴파일 에러가 된다. 판별 유니온의 variant 는 손으로 나열할 수밖에 없어(zod), 어휘를
 * 빠짐없이 덮는지는 tsc 에게 맡긴다. types/question-types.ts 의 같은 관례.
 */
export function toChangeUserStatusAction(
  action: UserStatusAction,
): ChangeUserStatusInput['action'] {
  return action;
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로필 — 세 계정 유형 공통 자기 계정 화면 (.pen FLOW 3-2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 프로필 화면이 읽는 내 계정.
 *
 * 세션 페이로드가 아니라 DB 에서 읽는다 — 아바타 URL 은 세션에 실리지 않고, 직책·소속은
 * 다른 사람이 바꿀 수 있어(사용자 관리) 세션 발급 시점 값이 낡아 있을 수 있다.
 */
export const MyProfile = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  /** 아바타 이미지 URL (R2 공개 URL). 미설정이면 null — 화면은 이름 첫 글자로 대체한다. */
  image: z.string().nullable(),
  userType: z.enum(userTypeValues),
  /** 직책 — 본인 수정 불가(읽기 전용). 팀장·슈퍼어드민이 바꾼다. */
  jobTitle: z.string().nullable(),
  /** 소속 기관 — guest 전용. 본인 수정 불가. */
  organization: z.string().nullable(),
});
export type MyProfile = z.infer<typeof MyProfile>;

/**
 * 프로필 수정 입력 — 본인이 바꿀 수 있는 것만.
 *
 * 이메일(로그인 ID)·직책·소속·유형·상태는 여기 없다. 있어야 할 이유가 없는 게 아니라
 * **있으면 안 된다** — 자기 계정 표면에서 바꿀 수 있으면 계정 발급 정책이 무의미해진다.
 *
 * image 는 null 로 보내 지울 수 있다(기본 아바타로 되돌리기). 값이 있으면 서버가 우리
 * R2 공개 URL 인지 확인한다 — 외부 URL 을 넣으면 남의 서버가 우리 화면에 그림을 그린다.
 */
export const UpdateProfileInput = z.object({
  name: z.string().trim().min(1, '이름을 입력하세요.').max(50),
  image: z.string().max(2048).nullable(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const UpdateProfileOutput = MyProfile;
export type UpdateProfileOutput = z.infer<typeof UpdateProfileOutput>;

// ─────────────────────────────────────────────────────────────────────────────
// 비밀번호 변경 — 본인이 바꾼다 (재설정은 슈퍼어드민 소관, 위 ResetUserPasswordInput)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 비밀번호 변경 입력. 현재 비밀번호 재인증이 필수라 재설정과 모양이 다르다.
 *
 * 길이·일치 검증은 서비스가 한 번 더 하고 결과를 문구로 돌려준다 — 여기서 zod 로 조이면
 * 같은 규칙이 두 벌이 되고, 실패가 BAD_REQUEST 예외가 되어 폼 옆 문구 UX 가 깨진다.
 */
export const UpdatePasswordInput = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
  confirmPassword: z.string(),
});
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordInput>;

/**
 * 비밀번호 변경 출력 — 판별 유니온.
 * 검증 실패·재인증 실패를 예외가 아니라 문구로 돌려준다(폼 옆에 그대로 띄운다).
 */
export const UpdatePasswordOutput = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ error: z.string() }),
]);
export type UpdatePasswordOutput = z.infer<typeof UpdatePasswordOutput>;
