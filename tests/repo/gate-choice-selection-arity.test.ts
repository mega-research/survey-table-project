import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * 칸 게이팅 판정 함수는 운영 코드에서 인자 넷을 모두 받는다 — 셋째 표 전체 칸, 넷째 보기 선택 집합.
 *
 * 둘 다 선택 인자라 빼먹어도 컴파일된다. 빼먹으면 보기 선택으로 열리는 컨트롤러의 정상 값을 잔존값으로 보고,
 * 그 칸을 조건으로 쓰는 제약·보기 조건이 조용히 빠진다 — 2026-11-06 에 두 번(`8b8116b1`·`02c70511`) 리뷰가 잡았다.
 * 테스트는 단위 판정만 보느라 인자를 줄여 부르므로 매개변수를 필수로 바꾸지 않고, 운영 코드의 호출만 여기서 본다.
 * 보기 선택이 정말 없는 자리는 `undefined` 를 **적어서** 넘긴다 — 리뷰에서 보이게.
 */

const GATE_FUNCTIONS = new Set(['isCellEnabled', 'isGateConditionMet', 'hiddenSelectOptionValues']);
const REQUIRED_ARGS = 4;
const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (
      !/\.tsx?$/.test(entry.name) ||
      /\.test\.tsx?$/.test(entry.name) ||
      entry.name.endsWith('.d.ts')
    )
      return [];
    return [full];
  });
}

function shortCalls(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  if (![...GATE_FUNCTIONS].some((name) => text.includes(`${name}(`))) return [];
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name && GATE_FUNCTIONS.has(name) && node.arguments.length < REQUIRED_ARGS) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push(
          `${relative(process.cwd(), file)}:${line + 1} ${name}(인자 ${node.arguments.length}개)`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('칸 게이팅 판정 호출 — 운영 코드는 표 전체 칸과 보기 선택 집합을 넘긴다', () => {
  const files = sourceFiles(SRC);

  it('열거가 죽지 않았다 — 호출하는 파일을 실제로 찾는다', () => {
    const callers = files.filter((f) => readFileSync(f, 'utf8').includes('isCellEnabled('));
    expect(callers.length).toBeGreaterThan(5);
  });

  it('인자를 줄여 부르는 운영 코드가 없다', () => {
    const offenders = files.flatMap(shortCalls);
    expect(
      offenders,
      '셋째(표 전체 칸)·넷째(보기 선택 집합 — collectTableChoiceSelection·collectSelectedChoiceCellIds) 인자를 넘길 것. 정말 없으면 undefined 를 적는다',
    ).toEqual([]);
  });
});
