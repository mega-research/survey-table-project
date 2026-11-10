import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `src/lib` 잔류 기준 (루트 AGENTS.md 「src/lib 잔류 기준」).
 *
 * lib 에 남는 것은 인프라와 「서버와 프론트가 함께 쓰는 계산」뿐이다. **부르는 곳이 `features`·
 * `components` 뿐인 파일은 lib 을 떠난다** — 한 feature 만 부르면 그 feature 안으로, 여럿이 부르면
 * `src/utils`(순수 함수)나 `src/shared/lib`(런타임 조각)으로.
 *
 * 이 판정은 예전에 gitignore 된 `.scratch/tools/lib-final.mjs` 로만 할 수 있었다. CI 가 돌릴 수 없는
 * 자리라, 2026-11-09 에 `lib/operations/fieldwork-share-overlap.ts`(소비자가 feature 하나)가 그대로
 * 들어왔고 리뷰에서야 잡혔다. 그래서 같은 실측을 여기로 옮긴다.
 *
 * 판정은 폴더 이름이 아니라 소비자 실측이다:
 *  - 테스트 파일은 소비자로 세지 않는다.
 *  - lib·utils·shared·server·app 등 **features·components 밖의 소비자가 하나라도 있으면 잔류**다.
 *    옮기면 공용 구역이 features 를 가리키게 되기 때문이다(ESLint 금지).
 *  - 아무도 부르지 않는 파일은 이 테스트의 소관이 아니다.
 *
 * 한계: `from '...'`·`import('...')` 의 문자열만 본다. 경로를 조립하는 동적 import 는 못 본다.
 */

const REPO_ROOT = join(import.meta.dirname, '../..');

/**
 * 이 테스트를 들일 때 이미 있던 위반. **새 항목을 더하지 않는다** — 옮기는 것이 답이다.
 * 옮기고 나면 여기서도 지운다(지우지 않으면 아래 단언이 빨개진다).
 */
const KNOWN_FRONT_ONLY: Record<string, string> = {
  'src/lib/operations/contact-target-edit-format.ts': 'features/operations 만 부른다',
  'src/lib/operations/id-list-paste.ts': 'features/operations 만 부른다',
  'src/lib/question/label.ts': 'features/question-renderer·survey-response 만 부른다',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** import 지정자를 레포 상대 경로로 푼다. 패키지 import 는 null. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(REPO_ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? join(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile())
      return relative(REPO_ROOT, candidate);
  }
  return null;
}

const isFrontOnlyZone = (file: string) =>
  file.startsWith('src/features/') || file.startsWith('src/components/');

describe('src/lib 잔류 기준', () => {
  const files = sourceFiles(join(REPO_ROOT, 'src'));
  const consumers = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const target = resolveImport(file, match[1]!);
      if (!target?.startsWith('src/lib/') || target === rel) continue;
      if (!consumers.has(target)) consumers.set(target, new Set());
      consumers.get(target)!.add(rel);
    }
  }

  const frontOnly = [...consumers.entries()]
    .filter(([, users]) => [...users].every(isFrontOnlyZone))
    .map(([file]) => file)
    .sort();

  it('lib 파일 수백 개의 소비자를 실제로 읽었다 — 빈 스캔이 통과로 보이지 않게', () => {
    expect(consumers.size).toBeGreaterThan(100);
  });

  it('부르는 곳이 features·components 뿐인 lib 파일은 등재된 기존 위반뿐이다', () => {
    expect(frontOnly).toEqual(Object.keys(KNOWN_FRONT_ONLY).sort());
  });
});
