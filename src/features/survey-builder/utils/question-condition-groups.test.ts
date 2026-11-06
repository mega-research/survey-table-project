import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { Question, QuestionConditionGroup } from '@/types/survey';

import { remapQuestionConditionGroups } from './question-condition-groups';

/**
 * `Question` 타입 어디에 조건 묶음(`QuestionConditionGroup`)이 있든 리매핑이 돈다 — 자리를 손으로 나열하면
 * 새 필드가 빠진다(2026-11-06 리뷰 지적 + 이 테스트가 처음 찾은 두 자리: 이월값 불러오기 조건·동적 행 그룹 표시 조건).
 *
 * 컴파일러로 `Question` 타입의 속성을 따라 내려가 조건 묶음 자리의 경로를 모두 모은 뒤, 그 경로마다 표식 묶음을
 * 넣은 문항을 만들어 `remapQuestionConditionGroups` 가 전부 바꾸는지 본다. 새 필드를 타입에 넣고 함수에 안 넣으면
 * 여기서 그 경로 이름으로 실패한다.
 */

const ROOT = process.cwd();
const TYPES_FILE = path.join(ROOT, 'src/types/survey.ts');
const TARGET_TYPE = 'QuestionConditionGroup';

/** 경로 조각 — 배열이면 `[]` 가 붙는다(`tableRowsData[]`). */
type Path = readonly string[];

function collectConditionGroupPaths(): Path[] {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json')!;
  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    ROOT,
  );
  const program = ts.createProgram([TYPES_FILE], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(TYPES_FILE)!;
  let questionDecl: ts.InterfaceDeclaration | undefined;
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Question') questionDecl = node;
  });
  if (!questionDecl) throw new Error('src/types/survey.ts 에서 interface Question 을 찾지 못했다');

  const found: Path[] = [];
  const isTarget = (t: ts.Type) => (t.aliasSymbol ?? t.getSymbol())?.getName() === TARGET_TYPE;

  const walk = (type: ts.Type, at: Path, seen: ReadonlySet<ts.Type>) => {
    if (at.length > 6) return;
    for (const prop of checker.getPropertiesOfType(type)) {
      const propType = checker.getNonNullableType(
        checker.getTypeOfSymbolAtLocation(prop, questionDecl!),
      );
      const parts = propType.isUnion() ? propType.types : [propType];
      for (const part of parts) {
        if (isTarget(part)) {
          found.push([...at, prop.getName()]);
          continue;
        }
        if (checker.isArrayType(part)) {
          const element = checker.getTypeArguments(part as ts.TypeReference)[0];
          if (element && !seen.has(element)) {
            if (isTarget(element)) found.push([...at, `${prop.getName()}[]`]);
            else walkObject(element, [...at, `${prop.getName()}[]`], seen);
          }
          continue;
        }
        if (!seen.has(part)) walkObject(part, [...at, prop.getName()], seen);
      }
    }
  };
  const walkObject = (type: ts.Type, at: Path, seen: ReadonlySet<ts.Type>) => {
    if (!(type.flags & ts.TypeFlags.Object)) return;
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return;
    if (type.getSymbol()?.getName() === 'Date') return;
    walk(type, at, new Set([...seen, type]));
  };

  const questionType = checker.getTypeAtLocation(questionDecl.name);
  walk(questionType, [], new Set([questionType]));
  // 같은 경로가 유니온 구성원마다 한 번씩 나올 수 있다
  return [...new Map(found.map((p) => [p.join('.'), p])).values()];
}

/** 경로마다 표식 묶음을 꽂은 문항 — 배열 자리는 원소 하나짜리 배열을 만든다. */
function buildQuestion(paths: readonly Path[]): {
  question: Question;
  markers: Map<string, QuestionConditionGroup>;
} {
  const question: Record<string, unknown> = {
    id: 'q1',
    type: 'table',
    title: 't',
    required: false,
    order: 0,
  };
  const markers = new Map<string, QuestionConditionGroup>();
  for (const p of paths) {
    let holder: Record<string, unknown> = question;
    p.forEach((segment, i) => {
      const isLast = i === p.length - 1;
      const isArray = segment.endsWith('[]');
      const key = isArray ? segment.slice(0, -2) : segment;
      if (isLast) {
        const marker = {
          logicType: 'AND',
          conditions: [],
          marker: p.join('.'),
        } as unknown as QuestionConditionGroup;
        markers.set(p.join('.'), marker);
        holder[key] = isArray ? [marker] : marker;
        return;
      }
      if (isArray) {
        const list = (holder[key] ??= [{}]) as Record<string, unknown>[];
        holder = list[0]!;
      } else {
        holder = (holder[key] ??= {}) as Record<string, unknown>;
      }
    });
  }
  return { question: question as unknown as Question, markers };
}

function readPath(question: Question, p: Path): unknown {
  let cur: unknown = question;
  for (const segment of p) {
    const isArray = segment.endsWith('[]');
    const key = isArray ? segment.slice(0, -2) : segment;
    cur = (cur as Record<string, unknown> | undefined)?.[key];
    if (isArray) cur = (cur as unknown[] | undefined)?.[0];
  }
  return cur;
}

describe('remapQuestionConditionGroups — Question 타입의 조건 묶음 자리 전부', () => {
  const paths = collectConditionGroupPaths();

  it('컴파일러가 조건 묶음 자리를 찾는다 — 열거가 죽지 않았다', () => {
    expect(paths.map((p) => p.join('.'))).toEqual(
      expect.arrayContaining([
        'displayCondition',
        'tableRowsData[].displayCondition',
        'sumConstraints[].whenQuestion',
      ]),
    );
  });

  it('찾은 자리 전부를 리매핑한다', () => {
    const { question, markers } = buildQuestion(paths);
    const replaced = new Map<string, QuestionConditionGroup>();
    const changed = remapQuestionConditionGroups(question, (group) => {
      const marker = (group as unknown as { marker?: string }).marker;
      if (!marker) return group;
      const next = { ...group, marker: `${marker}:remapped` } as unknown as QuestionConditionGroup;
      replaced.set(marker, next);
      return next;
    });
    expect(changed).toBe(true);
    const missed = paths
      .map((p) => p.join('.'))
      .filter((key) => readPath(question, key.split('.')) !== replaced.get(key));
    expect(
      missed,
      `remapQuestionConditionGroups 가 돌지 않는 조건 자리 — question-condition-groups.ts 에 더할 것`,
    ).toEqual([]);
    expect(replaced.size).toBe(markers.size);
  });

  it('바꾼 것이 없으면 false 이고 원래 묶음을 그대로 둔다', () => {
    const { question } = buildQuestion(paths);
    const before = question.displayCondition;
    expect(remapQuestionConditionGroups(question, (group) => group)).toBe(false);
    expect(question.displayCondition).toBe(before);
  });
});
