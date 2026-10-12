/**
 * `src/app` 트리 훑기 — 라우터가 없는 표면(RSC 페이지·Route Handler)의 목록 출처.
 *
 * 가드 테스트 세 곳이 같은 재귀 워커를 각자 들고 있었다. 훑는 규칙이 갈리면 한쪽 가드만
 * 조용히 좁아지므로 여기로 모은다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const APP_DIR = resolve(REPO_ROOT, 'src/app');

export interface AppFile {
  /** `src/app` 기준 상대경로 — 항상 `/` 구분자. */
  rel: string;
  source: string;
}

function collect(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collect(full, name));
    else if (entry === name) found.push(full);
  }
  return found;
}

/** `src/app` 아래 같은 이름의 파일 전부를 내용과 함께 읽는다. */
export function loadAppFiles(name: 'page.tsx' | 'layout.tsx' | 'route.ts'): AppFile[] {
  return collect(APP_DIR, name).map((full) => ({
    rel: relative(APP_DIR, full).replaceAll('\\', '/'),
    source: readFileSync(full, 'utf8'),
  }));
}

/**
 * 인증 없이 열려야 하는 페이지 — 응답자·외주 표면.
 *
 * 다섯 다 URL 에 실린 토큰이 곧 자격이다(초대 코드·프리뷰 토큰·수신거부 토큰·링크 토큰).
 * 로그인을 요구하면 응답자가 설문에 들어올 수 없다. 여기 새 항목을 더할 때는 **왜 무인증이어야
 * 하는지**를 같은 줄에 적을 것 — 적을 말이 없으면 가드가 빠진 것이다.
 *
 * 소비자가 둘이라 여기 산다 — `rsc-page-guards`(이 페이지들만 가드를 면제)와
 * `proxy-matcher-coverage`(이 페이지들의 루트가 matcher 밖이어야 한다). 목록이 갈리면 한쪽만
 * 조용히 좁아진다.
 */
export const PUBLIC_PAGES: Record<string, string> = {
  'i/[code]/page.tsx': '짧은 초대 링크 — inviteCode 가 자격이다',
  'preview/[token]/page.tsx': '빌더 미리보기 — previewToken 이 자격이다',
  'unsubscribe/[token]/page.tsx': '메일 수신거부 — unsubscribeToken 이 자격이다',
  'survey/[id]/page.tsx': '공개 응답 페이지 — 설문 자체가 공개 표면이다',
  'fw/[token]/page.tsx':
    '외주 실사 링크의 비밀번호 화면 — 세션을 **만드는** 자리라 가드를 붙이면 아무도 들어올 수 없다',
  'client/[token]/page.tsx':
    '클라이언트 링크의 비밀번호 화면 — 위와 같은 이유다. 조사 이름조차 받지 않는다(ADR-0029)',
};

/** `src/app` 직속 디렉터리 이름 — 라우트 그룹 `(…)`·비공개 폴더 `_…` 는 제외한다. */
export function appRootSegments(): string[] {
  return readdirSync(APP_DIR)
    .filter((entry) => statSync(resolve(APP_DIR, entry)).isDirectory())
    .filter((entry) => !entry.startsWith('(') && !entry.startsWith('_'));
}

/** 라우트 그룹 `app/(name)/` 직속 디렉터리 이름 — 괄호가 주소에서 사라지므로 이들이 루트다. */
export function routeGroupRootSegments(group: string): string[] {
  const dir = resolve(APP_DIR, `(${group})`);
  return readdirSync(dir).filter((entry) => statSync(resolve(dir, entry)).isDirectory());
}
