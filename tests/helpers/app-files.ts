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
