// 계정 경계 계약 — 사용자 관리(목록·직접 생성)가 경계를 건너는 모양.
// 같은 폴더의 auth.ts — 계정 어휘(status·user_type) SSOT. 이 파일 — 서버와 UI 사이 RPC 입출력.
// client-safe — server-only·Node·DB 의존 없음(zod 는 런타임 의존).
import * as z from 'zod';

import {
  type UserStatus,
  type UserStatusAction,
  type UserType,
  userStatusValues,
  userTypeValues,
} from './auth';

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
 * fieldwork 는 실사 업체(티켓 24). 이 티켓 시점에 채울 수 있는 것은 organization 뿐이라
 * 나머지 두 출처는 뒤 티켓이 이 모양에 필드를 더한다.
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
 * fieldwork 는 의도적으로 빠져 있다 — 실사 계정은 소속 업체(fieldwork_orgs)가 있어야
 * 성립하고 그 엔티티는 티켓 24 에서 생긴다. 모달의 실사 세그먼트도 같은 이유로 비활성이며,
 * 유니온에 없으므로 우회 호출은 zod 단계에서 BAD_REQUEST 로 떨어진다.
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
]);
export type CreateUserInput = z.infer<typeof CreateUserInput>;

/** 생성 가능한 유형 — 모달 세그먼트의 활성 여부 판정에 UI 도 쓴다. */
export const creatableUserTypes = ['internal', 'guest'] as const satisfies readonly UserType[];

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
 * .pen FLOW 9-4 의 「새 소속 팀」·「팀 역할」은 여기 없다 — 팀 엔티티가 티켓 06 에서
 * 생기고 재입사 배정 연계는 티켓 14 소관이라, 지금 필드를 받으면 저장할 곳이 없다.
 */
export const ChangeUserStatusInput = z.discriminatedUnion('action', [
  UserTarget.extend({ action: z.literal('suspend') }),
  UserTarget.extend({ action: z.literal('resume') }),
  UserTarget.extend({ action: z.literal('depart') }),
  UserTarget.extend({
    action: z.literal('rehire'),
    password: PasswordField,
    jobTitle: optionalText(50),
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
