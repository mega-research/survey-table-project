import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 회귀 가드: 인증 없는 server action 이 다시 생기지 못하게 막는다.
 *
 * server action 은 어디에 선언하든 컴파일 시 공개 POST 엔드포인트가 되는데, 페이지 진입을
 * 막는 미들웨어(lib/supabase/middleware.ts)는 세션 유무만 보므로 ADMIN_USER_IDS allowlist
 * 밖 세션이 액션 id 로 직접 호출하면 인증 없이 응답을 받아간다. 실제로 analytics 페이지
 * 2곳의 내보내기 액션 4개가 복호화 PII 를 그대로 반환했다.
 *
 * 관리 표면의 인증은 oRPC authed/scoped 미들웨어 한 곳에서만 결정한다. 잔존 서버 액션은
 * 아래 ALLOWED 목록뿐이며(로그인·로그아웃·수신거부) redirect+쿠키 의미론 때문에 의도적으로
 * 남아 있다. 목록에 없는 파일이 'use server' 를 선언하면 이 테스트가 실패한다.
 *
 * 스캔 범위는 src/app 이 아니라 src 전체다 — 결함의 본질은 '페이지 인라인' 이라는 위치가
 * 아니라 '본문 인증 없는 액션' 이므로, components/ 나 features/ 로 옮겨도 잡혀야 한다.
 */

const SRC_DIR = resolve(__dirname, '..', '..', 'src');

/** 의도적으로 남긴 서버 액션 파일 (src 기준 상대경로, POSIX 구분자). */
const ALLOWED = ['actions/auth-actions.ts', 'actions/unsubscribe-actions.ts'];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('인증 없는 server action 금지', () => {
  it("src 아래 'use server' 선언은 의도적 잔존 파일뿐이다", () => {
    const declared = collectSourceFiles(SRC_DIR)
      .filter((file) => /^\s*['"]use server['"]/m.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC_DIR, file).split(/[\\/]/).join('/'))
      .sort();
    expect(declared).toEqual([...ALLOWED].sort());
  });

  it("src/app 아래에는 인라인 'use server' 가 없다", () => {
    const appDir = join(SRC_DIR, 'app');
    const offenders = collectSourceFiles(appDir)
      .filter((file) => /['"]use server['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(appDir, file).split(/[\\/]/).join('/'));
    expect(offenders).toEqual([]);
  });
});
