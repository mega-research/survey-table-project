import { describe, expect, it } from 'vitest';

import {
  buildStructureFingerprints,
  changedQuestionIds,
} from './test-version-fingerprint';

/**
 * 테스트 버전 지문 — 저장본이 바뀌었는지(리비전)와, 테스트 응답을 옮길 때 데려갈 「바뀐 문항」을 가른다.
 * 문항 지문은 순서를 보지 않는다(순서만 바꾸면 줄줄이 바뀐 것으로 잡혀 매번 앞으로 끌려간다).
 */

const q = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  title: id,
  order: 0,
  ...extra,
});

const snapshot = (
  questions: Array<Record<string, unknown>>,
  groups: Array<Record<string, unknown>> = [],
  rest: Record<string, unknown> = {},
) => ({ title: '설문', questions, groups, settings: {}, ...rest });

describe('buildStructureFingerprints', () => {
  it('같은 구조면 키 순서가 달라도 같은 지문이다', () => {
    const a = buildStructureFingerprints(snapshot([{ id: 'q1', title: 'A', type: 'text', order: 0 }]));
    const b = buildStructureFingerprints(snapshot([{ order: 0, type: 'text', title: 'A', id: 'q1' }]));
    expect(a).toEqual(b);
  });

  it('리비전은 문항 밖(제목·설정·순서)이 바뀌어도 달라진다', () => {
    const base = buildStructureFingerprints(snapshot([q('q1'), q('q2', { order: 1 })]));
    expect(buildStructureFingerprints(snapshot([q('q1'), q('q2', { order: 1 })], [], { title: '바뀜' })).revision).not.toBe(
      base.revision,
    );
    expect(buildStructureFingerprints(snapshot([q('q1', { order: 1 }), q('q2')])).revision).not.toBe(base.revision);
  });

  it('문항·그룹 지문은 순서를 보지 않는다', () => {
    const base = buildStructureFingerprints(
      snapshot([q('q1', { groupId: 'g1' })], [{ id: 'g1', name: '그룹', order: 0 }]),
    );
    const moved = buildStructureFingerprints(
      snapshot([q('q1', { groupId: 'g1', order: 5 })], [{ id: 'g1', name: '그룹', order: 3 }]),
    );
    expect(moved.questions).toEqual(base.questions);
    expect(moved.groups).toEqual(base.groups);
  });

  it('문항이 배열이 아니면 문항 지문은 비고 리비전은 있다', () => {
    const fp = buildStructureFingerprints({ title: '깨짐', questions: 'broken' } as never);
    expect(fp.questions).toEqual({});
    expect(fp.revision).toMatch(/^[0-9a-f]+$/);
  });
});

describe('changedQuestionIds', () => {
  it('정의가 바뀐 문항과 새로 생긴 문항을 문항 순서대로 낸다 — 순서만 바뀐 문항은 빼고', () => {
    const prev = buildStructureFingerprints(snapshot([q('q1'), q('q2', { order: 1 }), q('q3', { order: 2 })]));
    const nextSnapshot = snapshot([
      q('q3', { order: 0 }),
      q('q1', { order: 1, title: '문구 수정' }),
      q('q2', { order: 2 }),
      q('q-new', { order: 3 }),
    ]);

    expect(changedQuestionIds(prev, nextSnapshot)).toEqual(['q1', 'q-new']);
  });

  it('그룹 설정이 바뀌면 그 그룹과 하위 그룹의 문항이 바뀐 것이다', () => {
    const top = { id: 'g-top', name: '상위', order: 0 };
    const sub = { id: 'g-sub', name: '하위', parentGroupId: 'g-top', order: 0 };
    const other = { id: 'g-other', name: '다른', order: 1 };
    const groups = [top, sub, other];
    const questions = [
      q('q-top', { groupId: 'g-top' }),
      q('q-sub', { groupId: 'g-sub', order: 1 }),
      q('q-other', { groupId: 'g-other', order: 2 }),
    ];
    const prev = buildStructureFingerprints(snapshot(questions, groups));
    const next = snapshot(questions, [
      { ...top, displayCondition: { logicType: 'AND', conditions: [] } },
      sub,
      other,
    ]);

    expect(changedQuestionIds(prev, next)).toEqual(['q-top', 'q-sub']);
  });

  it('지문이 없으면(이 기능 이전 응답) 바뀐 문항이 없다', () => {
    expect(changedQuestionIds(null, snapshot([q('q1')]))).toEqual([]);
  });
});
