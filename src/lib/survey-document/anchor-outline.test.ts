import { describe, expect, it } from 'vitest';

import { anchorQuestionLabel, buildAnchorOutline, resolveAnchorOwnerId } from './anchor-outline';

describe('buildAnchorOutline', () => {
  const groups = [
    { id: 'g2', name: 'B. 경영', order: 1 },
    { id: 'g1', name: 'A. 일반', order: 0 },
  ];
  const questions = [
    { id: 'q3', groupId: 'g2', order: 0, questionCode: 'B1', title: '매출' },
    { id: 'q2', groupId: 'g1', order: 1, questionCode: 'A2', title: '설립연도' },
    { id: 'q1', groupId: 'g1', order: 0, questionCode: 'A1', title: '업종' },
  ];

  it('그룹 순서를 먼저 태우고 그 안에서 문항 순서로 늘어놓는다', () => {
    // 문항 order 는 그룹 안에서만 매겨진다 — 그룹 순서를 안 태우면 조사표 순서와 어긋난다
    const outline = buildAnchorOutline(groups, questions);
    expect(outline.map((s) => s.label)).toEqual(['A. 일반', 'B. 경영']);
    expect(outline[0]!.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(outline[1]!.questions.map((q) => q.id)).toEqual(['q3']);
  });

  it('그룹 없는 문항은 마지막 구역으로 모은다', () => {
    const outline = buildAnchorOutline(groups, [
      ...questions,
      { id: 'q9', groupId: null, order: 0, questionCode: null, title: '종합 의견' },
    ]);
    const last = outline[outline.length - 1]!;
    expect(last.groupId).toBeNull();
    expect(last.questions.map((q) => q.id)).toEqual(['q9']);
  });

  it('문항이 없는 그룹도 구역으로 남는다 — 그룹에 영역을 붙일 수 있어야 한다', () => {
    const outline = buildAnchorOutline([{ id: 'g0', name: '표지', order: -1 }], []);
    expect(outline).toEqual([{ groupId: 'g0', label: '표지', questions: [] }]);
  });
});

describe('anchorQuestionLabel', () => {
  it('문항코드가 있으면 코드를 쓴다', () => {
    expect(anchorQuestionLabel({ id: 'q', order: 0, questionCode: 'A7', title: '학력' })).toBe('A7');
  });

  it('코드가 없으면 문장을 줄여 쓴다', () => {
    expect(
      anchorQuestionLabel({ id: 'q', order: 0, questionCode: null, title: '가'.repeat(40) }),
    ).toBe(`${'가'.repeat(24)}…`);
  });

  it('코드도 문장도 없으면 자리를 비우지 않는다', () => {
    expect(anchorQuestionLabel({ id: 'q', order: 0, questionCode: '  ', title: '  ' })).toBe(
      '(제목 없음)',
    );
  });
});

describe('resolveAnchorOwnerId', () => {
  const has = (ids: string[]) => (id: string) => ids.includes(id);

  it('문항에 자기 영역이 있으면 그것을 켠다', () => {
    expect(resolveAnchorOwnerId({ kind: 'question', id: 'q1', groupId: 'g1' }, has(['q1', 'g1']))).toBe(
      'q1',
    );
  });

  it('문항에 자기 영역이 없으면 소속 그룹의 영역으로 떨어진다', () => {
    // 83개 문항 전부에 사각형을 그리게 하지 않기 위한 규칙
    expect(resolveAnchorOwnerId({ kind: 'question', id: 'q1', groupId: 'g1' }, has(['g1']))).toBe('g1');
  });

  it('그룹에도 영역이 없으면 켤 것이 없다', () => {
    expect(resolveAnchorOwnerId({ kind: 'question', id: 'q1', groupId: 'g1' }, has([]))).toBeNull();
  });

  it('그룹 없는 문항은 폴백 대상이 없다', () => {
    expect(resolveAnchorOwnerId({ kind: 'question', id: 'q1', groupId: null }, has(['g1']))).toBeNull();
  });

  it('그룹은 폴백하지 않는다 — 자기 영역이 전부다', () => {
    expect(resolveAnchorOwnerId({ kind: 'group', id: 'g1' }, has(['q1']))).toBeNull();
  });
});
