/**
 * 외주 링크 이름표를 **읽는 자리**를 고정한다 (fieldwork-multi-company 티켓 02).
 *
 * 이름표는 연구원의 메모라 외주 콘솔·비밀번호 화면·링크 세션이 여는 어떤 응답 모양에도 실리면
 * 안 된다. 그 성질은 「이름표 칸을 고르는 코드가 연구원 표면에만 있다」로 지켜진다 — 링크 세션
 * 판정(`server/access-link`)이 링크 행을 읽을 때 이 칸을 고르기 시작하면 actor·RSC payload 로 번질
 * 길이 생긴다. 동작 테스트(`fieldwork-link-names.realdb`)는 지금 있는 화면만 보므로, 새로 읽는
 * 자리가 생기는 것은 소스로 잡는다.
 *
 * 허용 목록에 새 자리를 넣으려면 그 자리가 **링크 주체에게 열리지 않는** 표면인지 먼저 확인할 것.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');

/** 이름표 칸을 읽어도 되는 자리 — 둘 다 연구원(내부 계정)만 닿는다. */
const ALLOWED = [
  // 관리 표면(`workspace.accessLinks.*`) — authed + survey.manageAccess.
  'server/workspace/services/access-links.ts',
  // 내부 콘솔의 기록 이름 — 외주 트리의 조립은 부르지 않는다(contact-detail-screen).
  'server/read-models/fieldwork-link-names.ts',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return [];
    return [path];
  });
}

describe('외주 링크 이름표를 읽는 자리', () => {
  it('surveyAccessLinks.label 을 고르는 코드는 연구원 표면 둘뿐이다', () => {
    const readers = sourceFiles(SRC_DIR)
      .filter((path) => readFileSync(path, 'utf8').includes('surveyAccessLinks.label'))
      .map((path) => relative(SRC_DIR, path))
      .sort();
    expect(readers).toEqual([...ALLOWED].sort());
  });

  it('링크 판정 코어는 이름표 칸도 행 전체도 고르지 않는다', () => {
    const core = readFileSync(join(SRC_DIR, 'server/access-link.ts'), 'utf8');
    expect(core).not.toContain('label');
    // `select()` 는 모든 칸을 고른다 — 이름표가 함께 실린다.
    expect(core).not.toMatch(/\.select\(\s*\)/);
  });
});
