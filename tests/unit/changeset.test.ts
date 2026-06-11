import { describe, it, expect } from 'vitest';

import {
  changesetHasChanges,
  computeSpssChangedQuestions,
  emptyChangeset,
  mergeChangesets,
  type QuestionChangeset,
} from '@/lib/survey-builder/changeset';

/** 테스트용 changeset 빌더 (emptyChangeset 위에 부분 override) */
function makeChangeset(partial: Partial<QuestionChangeset> = {}): QuestionChangeset {
  return { ...emptyChangeset(), ...partial };
}

/** snapshot 래퍼 빌더 */
function makeSnapshot(
  questionChanges: QuestionChangeset,
  isMetadataDirty = false,
): { questionChanges: QuestionChangeset; isMetadataDirty: boolean } {
  return { questionChanges, isMetadataDirty };
}

describe('emptyChangeset', () => {
  it('returns a fresh empty changeset each call', () => {
    const a = emptyChangeset();
    const b = emptyChangeset();
    expect(a).toEqual({ updated: {}, added: {}, deleted: {}, reordered: false });
    // 매번 새 객체여야 한다 (record 공유 금지)
    expect(a).not.toBe(b);
    expect(a.updated).not.toBe(b.updated);
  });
});

describe('changesetHasChanges', () => {
  it('빈 changeset 은 false', () => {
    expect(changesetHasChanges(emptyChangeset())).toBe(false);
  });

  it('added/updated/deleted 중 하나라도 있으면 true', () => {
    expect(changesetHasChanges(makeChangeset({ added: { q1: true } }))).toBe(true);
    expect(changesetHasChanges(makeChangeset({ updated: { q1: true } }))).toBe(true);
    expect(changesetHasChanges(makeChangeset({ deleted: { q1: true } }))).toBe(true);
  });

  it('reordered 만 true 여도 변경으로 본다', () => {
    expect(changesetHasChanges(makeChangeset({ reordered: true }))).toBe(true);
  });

  it('저장 성공 후 in-flight 편집 보존 시나리오: 저장 대상 델타는 비워지고 in-flight 편집만 남으면 여전히 dirty', () => {
    // snapshotChanges 가 저장 대상을 비운 뒤, 저장 중 q9 를 새로 수정한 상태를 모사
    const inFlight = makeChangeset({ updated: { q9: true } });
    // markSavedSnapshotClean 의 isDirty 재계산 로직(= isMetadataDirty || changesetHasChanges)과 동일
    expect(changesetHasChanges(inFlight)).toBe(true);
  });
});

describe('mergeChangesets', () => {
  it('pending.added 를 current 에 합친다', () => {
    const current = makeChangeset();
    const snapshot = makeSnapshot(makeChangeset({ added: { q1: true } }));
    const merged = mergeChangesets(current, snapshot);
    expect(merged.added).toEqual({ q1: true });
  });

  it('current 에서 삭제된 id 는 pending.added 로 부활하지 않는다 (상쇄)', () => {
    // 저장 스냅샷에서는 added 였지만, 저장 중 사용자가 그 질문을 삭제 → current.deleted
    const current = makeChangeset({ deleted: { q1: true } });
    const snapshot = makeSnapshot(makeChangeset({ added: { q1: true } }));
    const merged = mergeChangesets(current, snapshot);
    expect(merged.added['q1']).toBeUndefined();
    expect(merged.deleted).toEqual({ q1: true });
  });

  it('pending.updated + current.updated 는 병합된다', () => {
    const current = makeChangeset({ updated: { q1: true } });
    const snapshot = makeSnapshot(makeChangeset({ updated: { q1: true, q2: true } }));
    const merged = mergeChangesets(current, snapshot);
    expect(merged.updated).toEqual({ q1: true, q2: true });
  });

  it('current 에서 추가/삭제된 id 의 pending.updated 는 무시된다', () => {
    const current = makeChangeset({ added: { q1: true }, deleted: { q2: true } });
    const snapshot = makeSnapshot(makeChangeset({ updated: { q1: true, q2: true, q3: true } }));
    const merged = mergeChangesets(current, snapshot);
    // q1 은 current.added 이므로 updated 에 안 들어감, q2 는 current.deleted, q3 만 들어감
    expect(merged.updated).toEqual({ q3: true });
    expect(merged.added).toEqual({ q1: true });
    expect(merged.deleted).toEqual({ q2: true });
  });

  it('pending.deleted 는 current 에 deleted 로 들어가고 updated 를 제거한다 (deleted 우선)', () => {
    const current = makeChangeset({ updated: { q1: true } });
    const snapshot = makeSnapshot(makeChangeset({ deleted: { q1: true } }));
    const merged = mergeChangesets(current, snapshot);
    expect(merged.deleted).toEqual({ q1: true });
    expect(merged.updated['q1']).toBeUndefined();
  });

  it('저장 중 다시 추가된 질문(pending.deleted vs current.added)은 상쇄된다', () => {
    // pending 에서는 삭제됐지만 저장 중 같은 id 를 다시 added → 둘 다 제거
    const current = makeChangeset({ added: { q1: true } });
    const snapshot = makeSnapshot(makeChangeset({ deleted: { q1: true } }));
    const merged = mergeChangesets(current, snapshot);
    expect(merged.added['q1']).toBeUndefined();
    expect(merged.deleted['q1']).toBeUndefined();
  });

  it('added → deleted 순차 처리 시 pending.deleted 가 우선해 added 를 상쇄한다', () => {
    // pending 자체가 add 후 delete 인 경우: added 루프가 q1 을 넣고, deleted 루프가 다시 제거
    const current = makeChangeset();
    const snapshot = makeSnapshot(
      makeChangeset({ added: { q1: true }, deleted: { q1: true } }),
    );
    const merged = mergeChangesets(current, snapshot);
    // added 루프에서 q1 추가 → deleted 루프에서 current.added[q1] 발견해 상쇄
    expect(merged.added['q1']).toBeUndefined();
    expect(merged.deleted['q1']).toBeUndefined();
  });

  it('pending.reordered 면 reordered 를 true 로 유지한다', () => {
    const current = makeChangeset({ reordered: false });
    const snapshot = makeSnapshot(makeChangeset({ reordered: true }));
    expect(mergeChangesets(current, snapshot).reordered).toBe(true);
  });

  it('current.reordered 가 true 면 pending 이 false 라도 유지된다', () => {
    const current = makeChangeset({ reordered: true });
    const snapshot = makeSnapshot(makeChangeset({ reordered: false }));
    expect(mergeChangesets(current, snapshot).reordered).toBe(true);
  });

  it('입력 객체를 변형하지 않는다 (순수 함수)', () => {
    const current = makeChangeset({ updated: { q1: true } });
    const pending = makeChangeset({ added: { q2: true }, deleted: { q1: true } });
    const snapshot = makeSnapshot(pending);

    const currentSnapshotBefore = JSON.parse(JSON.stringify(current));
    const pendingSnapshotBefore = JSON.parse(JSON.stringify(pending));

    mergeChangesets(current, snapshot);

    expect(current).toEqual(currentSnapshotBefore);
    expect(pending).toEqual(pendingSnapshotBefore);
  });

  it('store 인라인 구현과 동일 결과 (참조 구현 대조)', () => {
    // 추출 전 store 인라인 로직을 복제한 참조 구현으로 동일성 검증
    function inlineMerge(
      current: QuestionChangeset,
      snapshot: { questionChanges: QuestionChangeset; isMetadataDirty: boolean },
    ): QuestionChangeset {
      const cur: QuestionChangeset = {
        updated: { ...current.updated },
        added: { ...current.added },
        deleted: { ...current.deleted },
        reordered: current.reordered,
      };
      const pending = snapshot.questionChanges;
      for (const id in pending.added) {
        if (!cur.deleted[id]) cur.added[id] = true;
      }
      for (const id in pending.updated) {
        if (!cur.deleted[id] && !cur.added[id]) cur.updated[id] = true;
      }
      for (const id in pending.deleted) {
        if (cur.added[id]) {
          delete cur.added[id];
        } else {
          cur.deleted[id] = true;
        }
        delete cur.updated[id];
      }
      if (pending.reordered) cur.reordered = true;
      return cur;
    }

    const scenarios: Array<{
      current: QuestionChangeset;
      pending: QuestionChangeset;
    }> = [
      { current: makeChangeset({ added: { a: true }, updated: { b: true } }), pending: makeChangeset({ added: { c: true }, deleted: { a: true } }) },
      { current: makeChangeset({ deleted: { x: true } }), pending: makeChangeset({ added: { x: true }, updated: { x: true } }) },
      { current: makeChangeset({ updated: { y: true }, reordered: true }), pending: makeChangeset({ deleted: { y: true }, reordered: false }) },
      { current: makeChangeset(), pending: makeChangeset({ added: { z: true }, deleted: { z: true } }) },
      { current: makeChangeset({ added: { p: true } }), pending: makeChangeset({ deleted: { p: true }, updated: { p: true } }) },
    ];

    for (const { current, pending } of scenarios) {
      const snapshot = makeSnapshot(pending);
      expect(mergeChangesets(current, snapshot)).toEqual(inlineMerge(current, snapshot));
    }
  });
});

describe('computeSpssChangedQuestions', () => {
  it('questionCode 가 바뀐 질문 id 만 반환한다', () => {
    const questions = [
      { id: 'q1', questionCode: 'Q1' },
      { id: 'q2', questionCode: 'Q3' }, // 변경됨 (이전 Q2)
      { id: 'q3', questionCode: 'Q4' },
    ];
    const oldCodes = new Map<string, string | undefined>([
      ['q1', 'Q1'],
      ['q2', 'Q2'],
      ['q3', 'Q4'],
    ]);
    expect(computeSpssChangedQuestions(questions, oldCodes, {})).toEqual(['q2']);
  });

  it('added 상태 질문은 제외한다 (이미 전체 전송 대상)', () => {
    const questions = [
      { id: 'q1', questionCode: 'Q2' }, // 코드 변경됐지만 added
      { id: 'q2', questionCode: 'Q3' }, // 코드 변경됨, 기존 질문
    ];
    const oldCodes = new Map<string, string | undefined>([
      ['q1', 'Q1'],
      ['q2', 'Q2'],
    ]);
    expect(computeSpssChangedQuestions(questions, oldCodes, { q1: true })).toEqual(['q2']);
  });

  it('undefined ↔ 값 전환도 변경으로 감지한다', () => {
    // exactOptionalPropertyTypes 환경: undefined 는 키 생략으로 표현 (런타임 q.questionCode === undefined)
    const questions: { id: string; questionCode?: string }[] = [
      { id: 'q1', questionCode: 'Q1' }, // undefined → Q1
      { id: 'q2' }, // Q2 → undefined (키 생략)
      { id: 'q3' }, // undefined → undefined (변경 없음)
    ];
    const oldCodes = new Map<string, string | undefined>([
      ['q1', undefined],
      ['q2', 'Q2'],
      ['q3', undefined],
    ]);
    expect(computeSpssChangedQuestions(questions, oldCodes, {})).toEqual(['q1', 'q2']);
  });

  it('oldCodes 에 없는 질문(신규 등장)은 undefined 와 비교된다', () => {
    const questions = [{ id: 'qNew', questionCode: 'Q5' }];
    const oldCodes = new Map<string, string | undefined>();
    // get 이 undefined 반환 → 'Q5' 와 다르므로 변경으로 감지
    expect(computeSpssChangedQuestions(questions, oldCodes, {})).toEqual(['qNew']);
  });

  it('변경이 없으면 빈 배열을 반환한다', () => {
    const questions = [
      { id: 'q1', questionCode: 'Q1' },
      { id: 'q2', questionCode: 'Q2' },
    ];
    const oldCodes = new Map<string, string | undefined>([
      ['q1', 'Q1'],
      ['q2', 'Q2'],
    ]);
    expect(computeSpssChangedQuestions(questions, oldCodes, {})).toEqual([]);
  });

  it('questions 배열 순서를 보존해 반환한다', () => {
    const questions = [
      { id: 'q3', questionCode: 'Q3b' },
      { id: 'q1', questionCode: 'Q1b' },
      { id: 'q2', questionCode: 'Q2b' },
    ];
    const oldCodes = new Map<string, string | undefined>([
      ['q1', 'Q1'],
      ['q2', 'Q2'],
      ['q3', 'Q3'],
    ]);
    expect(computeSpssChangedQuestions(questions, oldCodes, {})).toEqual(['q3', 'q1', 'q2']);
  });
});
