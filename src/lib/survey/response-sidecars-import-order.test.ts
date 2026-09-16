/**
 * 루트 사이드카 등록부를 두 방향으로 고정한다 — 영속 키 문자열과 모듈 순환.
 *
 * 등록부(`response-sidecars`)가 `OPT_TEXTS_KEY` 를 소유하던 동안
 * `response-sidecars → change-confirmation → prior-answers → response-sidecars`
 * 3-사이클이 닫혀 있었다. 순환이 닫히면 등록부가 남의 상수를 초기화 전에 읽게 되고,
 * 그러면 `SANITIZERS` 의 계산 키가 성립하지 않는다 — 예외로 터지거나, 번들러가 undefined 를
 * 주면 키가 문자열 `'undefined'` 로 굳고 진짜 키가 등록 목록에서 빠진다. 후자면 그 사이드카
 * 값이 저장 경계에서 조용히 사라진다(AGENTS.md 주의사항 13 이 `__optTexts__` 로 이미 두 번
 * 겪었다고 못박은 사고 계열).
 *
 * **순환을 닫은 것은 등록부의 직접 import 가 아니라 closure 안쪽에서 돌아온 간선**
 * (prior-answers → response-sidecars)이었다. 그러니 런타임 진입 순서를 흔드는 것만으로는
 * 재발을 잡지 못한다 — 주 가드는 소스를 읽어 그래프를 따라가는 '되돌아오는 간선' 테스트다.
 * 런타임 쪽은 옛 사고의 재현 모양으로 한 건 남겨 둔 것이다.
 *
 * 옛 가드는 파일 맨 위 side-effect import 가 change-confirmation 쪽 그래프를 먼저 세운다는
 * 전제 위에 있었다. 전제가 줄 위치에만 적혀 있어 import 를 정리하면 조용히 무력해지고
 * (이 레포는 `@trivago/prettier-plugin-sort-imports` 를 쓴다), 읽는 사람에게도 보이지 않는다.
 * 지금은 `vi.resetModules()` 로 그래프를 다시 세우고 진입 순서를 테스트 본문이 정한다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');
const REGISTRY_FILE = join(SRC_DIR, 'lib/survey/response-sidecars.ts');

/**
 * 등록부에 실려야 하는 영속 키.
 *
 * 상수를 import 해 오지 않고 리터럴로 적는다 — 잡으려는 것이 **개명**이라 양변을 같은
 * 출처에서 가져오면 아무것도 지키지 못한다. 이 키들은 `survey_responses.question_responses`
 * JSONB 에 그대로 박혀 있어, 개명하면 이미 저장된 응답의 사이드카가 고아가 된다.
 *
 * 개별 리터럴은 다른 동작 테스트의 픽스처에도 박혀 있지만(예 `question-visibility.test.ts`),
 * 등록 집합 전체를 한 자리에서 못박는 것은 여기뿐이다 — 개명과 목록 드리프트를 같이 본다.
 */
const PERSISTED_KEY_LITERALS = ['__changeConfirm__', '__dynamicRowSelections__', '__optTexts__'];

/**
 * 등록부가 직접 import 하는 모듈. 새 사이드카를 올리면 여기도 한 줄 는다.
 *
 * 2026-09-16 실측: 이 중 자기도 밖으로 import 하는 것은 change-confirmation 하나뿐이고
 * (prior-answers, 그리고 타입 전용 types/survey), 나머지 둘은 import 0 인 잎이다.
 */
const REGISTRY_DIRECT_IMPORTS = [
  '@/lib/option-text-read',
  '@/lib/survey/change-confirmation',
  '@/utils/dynamic-row-selection-sidecar',
];

function importRegistry(): Promise<typeof import('@/lib/survey/response-sidecars')> {
  return import('@/lib/survey/response-sidecars');
}

function expectKeysPinned(keys: readonly string[]): void {
  expect([...keys].sort()).toEqual([...PERSISTED_KEY_LITERALS].sort());
}

/** src 기준 상대경로(POSIX 구분자) — 실패 메시지를 읽을 수 있게 한다. */
function toRel(file: string): string {
  return relative(SRC_DIR, file).split(/[\\/]/).join('/');
}

/** 주석을 걷어낸 소스. 주석 속 모듈 경로가 간선으로 잡히는 것을 막는다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FROM_SPEC_RE = /\b(?:import|export)\s+([\s\S]*?)\sfrom\s*['"]([^'"]+)['"]/g;
const BARE_SPEC_RE = /\bimport\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * 파일이 내는 **런타임** import 지정자. side-effect import 와 `import()` 도 센다.
 *
 * `import type ... from` 은 컴파일에서 지워지므로 뺀다. 인라인 `{ type X }` 는 구분하지 않아
 * 간선을 조금 넓게 본다 — 없는 순환을 RED 로 낼 수는 있어도 있는 순환을 놓치지는 않는다.
 * 타입 전용 간선 때문에 아래 가드가 터지면, 확인한 뒤 그 사실을 주석으로 남기고 걷어낼 것.
 */
function runtimeImportSpecs(file: string): string[] {
  const source = stripComments(readFileSync(file, 'utf8'));
  const specs: string[] = [];
  for (const [, clause, spec] of source.matchAll(FROM_SPEC_RE)) {
    if (!/^type\b/.test((clause ?? '').trim())) specs.push(spec ?? '');
  }
  for (const [, spec] of source.matchAll(BARE_SPEC_RE)) specs.push(spec ?? '');
  return specs.filter((spec) => spec.length > 0);
}

/** `@/x` 와 상대경로를 실제 파일로 푼다. 패키지 import 는 레포 그래프 밖이라 null. */
function resolveSpec(spec: string, fromFile: string): string | null {
  const base = spec.startsWith('@/')
    ? join(SRC_DIR, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(fromFile), spec)
      : null;
  if (base === null) return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * `entry` 에서 나가는 import 를 전이적으로 따라가, `entry` 로 되돌아오는 간선의 경로를 모은다.
 * 빈 배열이면 등록부가 순환에 걸려 있지 않다는 뜻이다.
 */
function findPathsBackTo(entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>([entry]);
  const queue: { file: string; path: string[] }[] = [{ file: entry, path: [toRel(entry)] }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const spec of runtimeImportSpecs(current.file)) {
      const next = resolveSpec(spec, current.file);
      if (next === null) continue;
      if (next === entry) {
        if (current.file !== entry) found.push([...current.path, toRel(entry)].join(' → '));
        continue;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ file: next, path: [...current.path, toRel(next)] });
    }
  }
  return found;
}

describe('루트 사이드카 등록부 — 키 고정과 모듈 순환', () => {
  it('등록 키 집합이 리터럴 그대로다 — 개명하면 저장된 응답의 사이드카가 고아가 된다', async () => {
    vi.resetModules();
    expectKeysPinned((await importRegistry()).PERSISTED_ROOT_SIDECAR_KEYS);
  });

  it('등록부가 직접 import 하는 것은 키 모듈 셋뿐이다 — 새 간선은 손으로 등재해야 한다', () => {
    expect(runtimeImportSpecs(REGISTRY_FILE).sort()).toEqual([...REGISTRY_DIRECT_IMPORTS].sort());
  });

  it('등록부에서 나가는 어떤 경로도 등록부로 돌아오지 않는다 — 옛 순환의 모양이다', () => {
    expect(findPathsBackTo(REGISTRY_FILE)).toEqual([]);
  });

  it('가드 하네스가 그래프를 실제로 다시 세운다 — 여기가 깨지면 아래 진입 순서 단언이 헛것이다', async () => {
    vi.resetModules();
    const first = await importRegistry();
    vi.resetModules();
    const second = await importRegistry();

    // 등록부가 다시 평가됐다면 Object.keys 결과가 새 배열이다. 같은 참조로 돌아오면
    // 리셋이 먹지 않은 것이고, 그러면 진입 순서를 바꿔 봐야 첫 평가 결과만 다시 본다.
    expect(second.PERSISTED_ROOT_SIDECAR_KEYS).not.toBe(first.PERSISTED_ROOT_SIDECAR_KEYS);
    // 두 평가 결과를 서로 대조하지 않는다 — 같은 진입점에서 나온 둘이라 서로 같은 것은
    // 당연하고 어떤 구현에서도 깨지지 않는다. 각각을 리터럴 목록에 대는 것이 판정이다.
    expectKeysPinned(first.PERSISTED_ROOT_SIDECAR_KEYS);
    expectKeysPinned(second.PERSISTED_ROOT_SIDECAR_KEYS);
  });

  /**
   * 옛 사고의 재현 모양 — 등록부보다 change-confirmation 쪽으로 먼저 들어간다.
   *
   * 진입점을 표로 돌려 세 키 모듈을 다 태우지는 않는다. 나머지 둘은 import 0 인 잎이라
   * 그쪽으로 먼저 들어가는 것이 등록부로 바로 들어가는 것과 같고, 행만 늘 뿐 잡는 것이 없다.
   */
  it('change-confirmation 쪽으로 먼저 진입해도 등록 키가 온전하다', async () => {
    vi.resetModules();
    await import('@/lib/survey/change-confirmation');
    const { PERSISTED_ROOT_SIDECAR_KEYS } = await importRegistry();

    // 등록 집합을 리터럴에 대는 것 하나로 충분하다. CHANGE_CONFIRM_KEY 를 따로 toContain 하면
    // 양변이 같은 출처라(그 상수가 SANITIZERS 의 계산 키다) 순환이 없는 한 항상 참이고,
    // 순환이 있으면 이 단언이 먼저 잡는다.
    expectKeysPinned(PERSISTED_ROOT_SIDECAR_KEYS);
  });
});
