import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { surveyFieldworkLinks } from '@/db/schema';
import { decryptSharedSecret, encryptSharedSecret } from '@/lib/crypto/aes';
import { isUniqueViolation } from '@/lib/pg-error';
import type { FieldworkLinkView } from '@/shared/contracts/workspace-io';

import {
  FieldworkLinkAlreadyIssuedError,
  FieldworkLinkNotFoundError,
  generateFieldworkLinkPassword,
  generateFieldworkLinkToken,
} from '../domain/fieldwork-link';

/**
 * 외주 실사 링크의 저장소 계층 (ADR-0026).
 *
 * 이 파일이 지는 계약 셋.
 *  ① **활성 링크는 설문당 하나** — 부분 UNIQUE 가 강제하고, 부딪히면 CONFLICT 로 옮긴다.
 *  ② **토큰은 UPDATE 하지 않는다** — 주소가 영구 고정이라는 약속이 여기서 지켜진다.
 *     비밀번호 재설정도 `token` 을 set 하지 않는다.
 *  ③ **비밀번호는 가역 암호화** — 연구원이 다시 읽어 업체에 답해 준다(해시가 아니다).
 *
 * 중단 연동은 이 계층의 일이 아니다 — 판정 코어(server/survey-access)가 `surveys.is_paused` 로
 * 한다. 링크 행에 만료 축을 두지 않은 이유가 그것이고, 여기서 중단을 함께 보면 판정이 두 벌이 된다.
 */

/** drizzle 행 → 화면이 보는 모양. 암호문은 절대 섞지 않는다. */
function toView(row: {
  id: string;
  token: string;
  passwordUpdatedAt: Date;
  createdAt: Date;
}): FieldworkLinkView {
  return {
    id: row.id,
    token: row.token,
    passwordUpdatedAt: row.passwordUpdatedAt,
    createdAt: row.createdAt,
  };
}

/** 이 설문의 활성 링크 조건 — 종료된 행은 감사 계보이므로 조회에서 빠진다. */
function activeLink(surveyId: string) {
  return and(
    eq(surveyFieldworkLinks.surveyId, surveyId),
    isNull(surveyFieldworkLinks.closedAt),
  );
}

export async function getFieldworkLink(surveyId: string): Promise<FieldworkLinkView | null> {
  const [row] = await db
    .select({
      id: surveyFieldworkLinks.id,
      token: surveyFieldworkLinks.token,
      passwordUpdatedAt: surveyFieldworkLinks.passwordUpdatedAt,
      createdAt: surveyFieldworkLinks.createdAt,
    })
    .from(surveyFieldworkLinks)
    .where(activeLink(surveyId))
    .limit(1);
  return row ? toView(row) : null;
}

/**
 * 링크 발급 — 비밀번호를 생략하면 읽어 주기 쉬운 값을 만들어 **평문으로 함께 돌려준다.**
 *
 * 평문을 응답에 싣는 유일한 자리가 여기와 재설정이다. 자동 생성을 골랐을 때 연구원이 그 값을
 * 알 방법이 이것뿐이고, 이후 조회는 전용 표면(revealPassword)을 지난다.
 *
 * 중복은 DB 제약으로 받는다. 먼저 SELECT 해서 확인하면 두 요청이 같은 창에서 통과해 둘 다
 * INSERT 를 시도하고, 그때 나는 것은 제약 위반이 아니라 **두 번째 링크**다(제약이 없다면).
 */
export async function issueFieldworkLink(input: {
  surveyId: string;
  password?: string | undefined;
  actorId: string;
}): Promise<{ link: FieldworkLinkView; password: string }> {
  const password = input.password ?? generateFieldworkLinkPassword();
  try {
    const [row] = await db
      .insert(surveyFieldworkLinks)
      .values({
        surveyId: input.surveyId,
        token: generateFieldworkLinkToken(),
        passwordCipher: encryptSharedSecret(password),
        passwordUpdatedBy: input.actorId,
        createdBy: input.actorId,
      })
      .returning({
        id: surveyFieldworkLinks.id,
        token: surveyFieldworkLinks.token,
        passwordUpdatedAt: surveyFieldworkLinks.passwordUpdatedAt,
        createdAt: surveyFieldworkLinks.createdAt,
      });
    if (!row) throw new Error('외주 실사 링크 INSERT 실패');
    return { link: toView(row), password };
  } catch (error) {
    if (isUniqueViolation(error)) throw new FieldworkLinkAlreadyIssuedError();
    throw error;
  }
}

/**
 * 비밀번호 재설정 — **주소는 그대로 두고** 표식만 갱신한다.
 *
 * `passwordUpdatedAt` 을 함께 올리는 것이 세션 폐기다: 링크 세션 쿠키가 그 값을 들고 다니며
 * 매 요청 대조하므로, 이 UPDATE 하나로 이미 들어와 있던 외주 세션 전부가 끊긴다. ADR 의
 * 「사람을 막는 일은 전부 이 비밀번호가 진다」가 이 한 줄에 걸려 있다.
 */
export async function resetFieldworkLinkPassword(input: {
  surveyId: string;
  password?: string | undefined;
  actorId: string;
}): Promise<{ link: FieldworkLinkView; password: string }> {
  const password = input.password ?? generateFieldworkLinkPassword();
  const now = new Date();
  const [row] = await db
    .update(surveyFieldworkLinks)
    .set({
      passwordCipher: encryptSharedSecret(password),
      passwordUpdatedAt: now,
      passwordUpdatedBy: input.actorId,
      updatedAt: now,
    })
    .where(activeLink(input.surveyId))
    .returning({
      id: surveyFieldworkLinks.id,
      token: surveyFieldworkLinks.token,
      passwordUpdatedAt: surveyFieldworkLinks.passwordUpdatedAt,
      createdAt: surveyFieldworkLinks.createdAt,
    });
  if (!row) throw new FieldworkLinkNotFoundError();
  return { link: toView(row), password };
}

/**
 * 비밀번호 평문 조회 — 조회(get)와 **다른 표면**인 것이 이 함수의 존재 이유다.
 *
 * 목록 응답에 평문을 실으면 그 값이 캐시·로그·RSC payload 로 번지고, 「누가 언제 읽었는가」도
 * 남지 않는다. 따로 두면 rpc-logging 이 호출 한 줄을 기록한다.
 */
export async function revealFieldworkLinkPassword(surveyId: string): Promise<string> {
  const [row] = await db
    .select({ passwordCipher: surveyFieldworkLinks.passwordCipher })
    .from(surveyFieldworkLinks)
    .where(activeLink(surveyId))
    .limit(1);
  if (!row) throw new FieldworkLinkNotFoundError();
  return decryptSharedSecret(row.passwordCipher);
}

/**
 * 링크 종료 — 행을 지우지 않고 `closedAt` 을 찍는다.
 *
 * 귀속(결과코드 회차·대리 응답)이 이 테이블을 RESTRICT 로 가리키므로 하드 삭제는 기록이 남은
 * 링크에서 막힌다. 활성 UNIQUE 가 부분 인덱스라 종료 뒤 재발급이 되고, 옛 행은 「그 링크가
 * 무엇을 넣었는가」의 계보로 남는다.
 */
export async function closeFieldworkLink(input: {
  surveyId: string;
  actorId: string;
}): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(surveyFieldworkLinks)
    .set({ closedAt: now, closedBy: input.actorId, updatedAt: now })
    .where(activeLink(input.surveyId))
    .returning({ id: surveyFieldworkLinks.id });
  if (!row) throw new FieldworkLinkNotFoundError();
}
