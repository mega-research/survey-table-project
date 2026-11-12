import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `useEffectEvent` 를 `memo`·`forwardRef` 로 감싼 컴포넌트 안에서 쓰지 않는다 (루트 AGENTS.md 주의사항 17).
 *
 * React 19.2.3 은 memo·forwardRef 컴포넌트의 `useEffectEvent` 를 갱신하지 않아 이벤트가 첫 렌더 값을
 * 계속 읽는다. 컴포넌트 단위로 걸리므로 그 컴포넌트가 부르는 **훅 안에 숨어 있어도** 같다 — 그래서
 * 이 검사는 `useEffectEvent` 를 (직접이든 다른 훅을 거쳐서든) 쓰는 훅을 먼저 모으고, memo·forwardRef 로
 * 감싼 컴포넌트가 그것을 부르는지 본다. 훅은 이름으로 잇는다(같은 이름의 훅은 하나로 본다 — 넓게 잡는 쪽).
 *
 * React 를 올려 이 제약이 풀렸는지 확인했으면 이 파일을 지운다.
 */

const WRAPPERS = new Set(['memo', 'forwardRef']);

function walkSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walkSources(full);
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) return [];
    return /\.test\.(ts|tsx)$/.test(entry.name) ? [] : [full];
  });
}

/** `foo(...)` 또는 `React.foo(...)` 의 `foo`. 그 밖의 호출은 null. */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name.text;
  return null;
}

/** 본문이 부르는 함수 이름 전부. */
function calledNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name) names.add(name);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

interface FileFacts {
  /** 이 파일에 선언된 이름 있는 함수 — 이름 → 본문이 부르는 이름들. */
  functions: Map<string, Set<string>>;
  /** memo·forwardRef 로 감싼 것 — 안쪽 함수가 부르는 이름들(인라인이면 바로, 식별자면 파일 안에서 푼다). */
  wrapped: { line: number; calls: Set<string> | null; ref: string | null }[];
}

function analyze(fileName: string, text: string): FileFacts {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = new Map<string, Set<string>>();
  const wrapped: FileFacts['wrapped'] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, calledNames(node.body));
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functions.set(node.name.text, calledNames(node.initializer.body));
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const inner = node.arguments[0];
      if (name && WRAPPERS.has(name) && inner) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
          wrapped.push({ line, calls: calledNames(inner.body), ref: null });
        } else if (ts.isIdentifier(inner)) {
          wrapped.push({ line, calls: null, ref: inner.text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { functions, wrapped };
}

/** 파일 묶음에서 위반(「파일:줄 — 경로」)을 찾는다. */
function findOffenders(files: { name: string; text: string }[]): string[] {
  const facts = files.map((f) => ({ name: f.name, ...analyze(f.name, f.text) }));

  // useEffectEvent 를 직접 또는 다른 훅을 거쳐 쓰는 훅 이름 — 고정점까지 넓힌다.
  const tainted = new Set<string>(['useEffectEvent']);
  for (let grew = true; grew; ) {
    grew = false;
    for (const fact of facts) {
      for (const [name, calls] of fact.functions) {
        if (tainted.has(name) || !/^use[A-Z]/.test(name)) continue;
        if ([...calls].some((c) => tainted.has(c))) {
          tainted.add(name);
          grew = true;
        }
      }
    }
  }

  const offenders: string[] = [];
  for (const fact of facts) {
    for (const w of fact.wrapped) {
      const calls = w.calls ?? (w.ref ? fact.functions.get(w.ref) : undefined);
      if (!calls) continue;
      const hit = [...calls].filter((c) => tainted.has(c));
      if (hit.length > 0) offenders.push(`${fact.name}:${w.line} — ${hit.join(', ')}`);
    }
  }
  return offenders;
}

describe('useEffectEvent 는 memo·forwardRef 컴포넌트 안에 없다', () => {
  it('검사기가 직접 호출·훅을 거친 호출·식별자로 넘긴 컴포넌트를 모두 잡는다', () => {
    const offenders = findOffenders([
      {
        name: 'hooks.ts',
        text: `
          export function useTracker() { const onTick = useEffectEvent(() => {}); return onTick; }
          export function useOuter() { return useTracker(); }
          export function usePlain() { return useState(0); }
        `,
      },
      {
        name: 'direct.tsx',
        text: `export const A = memo(function A() { const e = useEffectEvent(() => {}); return null; });`,
      },
      {
        name: 'via-hook.tsx',
        text: `export const B = React.forwardRef((props, ref) => { useOuter(); return null; });`,
      },
      {
        name: 'by-ref.tsx',
        text: `function Inner() { useTracker(); return null; }\nexport const C = memo(Inner);`,
      },
      {
        name: 'clean.tsx',
        text: `
          export const D = memo(function D() { usePlain(); return null; });
          export function E() { const e = useEffectEvent(() => {}); return null; }
        `,
      },
    ]);
    expect(offenders.map((o) => o.split(':')[0])).toEqual(['direct.tsx', 'via-hook.tsx', 'by-ref.tsx']);
  });

  it('src 에 그 조합이 없다', () => {
    const root = join(process.cwd(), 'src');
    const files = walkSources(root).map((full) => ({
      name: relative(process.cwd(), full),
      text: readFileSync(full, 'utf8'),
    }));
    const offenders = findOffenders(files);
    expect(
      offenders,
      `memo·forwardRef 컴포넌트가 useEffectEvent 를 쓴다 — 감싼 것을 걷거나(ref 는 React 19 의 ref prop) 바깥 컴포넌트만 memo 로 둔다:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
