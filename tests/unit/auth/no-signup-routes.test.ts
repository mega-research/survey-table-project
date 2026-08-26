import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 회귀 가드: 공개 가입·이메일 재설정 표면이 다시 생기지 못하게 막는다 (ADR-0018).
 *
 * v2 에서 계정은 슈퍼어드민이 직접 발급하고(사용자 관리, 티켓 03) 비밀번호 분실은
 * 슈퍼어드민 재설정으로 처리한다(티켓 04). 가입 신청·승인 대기·비밀번호 찾기 메일 흐름은
 * 스펙 §10 「내림」 목록이다.
 *
 * 서버 쪽 봉쇄(sign-up API 는 disableSignUp)는 better-auth-session.realdb.test.ts 가 잡는다.
 * 여기서 보는 것은 라우트 파일의 부재 — 라우트가 살아 있으면 화면이 열리고, 그 화면이
 * 무엇을 부르든 v2 계정 공급 모델과 어긋난다.
 */

const APP_DIR = resolve(__dirname, '..', '..', '..', 'src/app');

const RETIRED_ROUTES = ['admin/signup', 'admin/forgot-password', 'admin/reset-password'];

describe('은퇴한 인증 라우트', () => {
  it.each(RETIRED_ROUTES)('%s 라우트가 존재하지 않는다', (route) => {
    expect(existsSync(resolve(APP_DIR, route))).toBe(false);
  });
});
