import { describe, expect, it } from 'vitest';

import {
  anchorQuestionLabel,
  buildAnchorOutline,
  resolveAnchorFocus,
  resolveAnchorOwnerId,
  resolveQuestionForOwner,
} from './anchor-outline';

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
    expect(outline).toEqual([
      { groupId: 'g0', label: '표지', depth: 0, isFirstRun: true, questions: [] },
    ]);
  });

  describe('하위그룹', () => {
    // order 는 부모 안에서만 매겨진다. 평평하게 정렬하면 뒤쪽 루트 그룹의
    // 하위그룹(order 0)이 앞쪽 루트 그룹들보다 위로 올라온다 — 실제로 89번째
    // 문항을 담은 하위그룹이 목록 네 번째로 나왔다.
    const nested = [
      { id: 'a', name: 'A. 일반', order: 0 },
      { id: 'b', name: 'B. 경영', order: 1 },
      { id: 'z', name: 'H. 정책 인식', order: 7 },
      { id: 'z1', name: '지원정책별 이용 현황', order: 0, parentGroupId: 'z' },
    ];
    const nestedQuestions = [
      { id: 'qa', groupId: 'a', order: 0, questionCode: 'A1', title: '업종' },
      { id: 'qb', groupId: 'b', order: 0, questionCode: 'B1', title: '매출' },
      { id: 'qz', groupId: 'z', order: 0, questionCode: 'H1', title: '인지도' },
      { id: 'qz1', groupId: 'z1', order: 0, questionCode: 'H9', title: '자금지원 제도' },
    ];

    it('하위그룹은 부모 안에 온다 — 자기 order 로 목록 앞으로 튀지 않는다', () => {
      // z1 의 order 는 0 이지만 그것은 z 안에서의 순서다. 평평하게 정렬하면
      // a·b 보다 앞으로 올라온다.
      const outline = buildAnchorOutline(nested, nestedQuestions);
      // z 는 하위그룹 앞뒤로 쪼개진다(qz 가 z1 뒤에 온다) — 머리는 첫 구간에만.
      expect(outline.map((s) => s.groupId)).toEqual(['a', 'b', 'z', 'z1', 'z']);
      expect(outline.map((s) => s.isFirstRun)).toEqual([true, true, true, true, false]);
    });

    it('하위그룹은 깊이를 갖는다', () => {
      const outline = buildAnchorOutline(nested, nestedQuestions);
      expect(outline.map((s) => s.depth)).toEqual([0, 0, 0, 1, 0]);
    });

    it('문항은 자기가 실제로 속한 구역에 담긴다', () => {
      const outline = buildAnchorOutline(nested, nestedQuestions);
      const byId = new Map(outline.map((s) => [s.groupId, s.questions.map((q) => q.id)]));
      expect(byId.get('z')).toEqual(['qz']);
      expect(byId.get('z1')).toEqual(['qz1']);
    });

    describe('하위그룹이 그룹의 문항 앞에 올 때', () => {
      // 실제 조사표가 이 모양이다 — 하위그룹이 89~96 번을 담고 그 뒤에 97·98 이 온다.
      // 한 구역에 몰아 담으면 하위그룹이 늘 뒤로 밀린다.
      const groupsWithSub = [
        { id: 'h', name: 'H. 정책 인식', order: 0 },
        { id: 'h1', name: '지원정책별 이용 현황', order: 0, parentGroupId: 'h' },
      ];
      const withSub = [
        { id: 'sub1', groupId: 'h1', order: 0, questionCode: 'F_1_1', title: '자금지원' },
        { id: 'sub2', groupId: 'h1', order: 1, questionCode: 'F_1_2', title: '인력지원' },
        { id: 'own1', groupId: 'h', order: 1, questionCode: 'F_2', title: '가장 확충이 필요한' },
        { id: 'own2', groupId: 'h', order: 2, questionCode: 'F_3', title: '가장 어려운 점' },
      ];

      it('하위그룹이 먼저 나오고 그룹의 문항이 뒤따른다', () => {
        const outline = buildAnchorOutline(groupsWithSub, withSub);
        expect(
          outline.map((s) => [s.groupId, s.questions.map((q) => q.label)]),
        ).toEqual([
          ['h', []],
          ['h1', ['F_1_1', 'F_1_2']],
          ['h', ['F_2', 'F_3']],
        ]);
      });

      it('그룹 머리는 첫 구간에만 그린다', () => {
        const outline = buildAnchorOutline(groupsWithSub, withSub);
        expect(outline.map((s) => s.isFirstRun)).toEqual([true, true, false]);
      });

      it('하위그룹 뒤에 문항이 없으면 빈 구간을 남기지 않는다', () => {
        const onlySub = withSub.filter((q) => q.groupId === 'h1');
        const outline = buildAnchorOutline(groupsWithSub, onlySub);
        expect(outline.map((s) => s.groupId)).toEqual(['h', 'h1']);
      });
    });
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

describe('resolveAnchorFocus', () => {
  const pages = (map: Record<string, number[]>) => (id: string) => map[id] ?? [];

  it('자기 영역이 있으면 자기를 켜고 소속 그룹을 맥락으로 함께 그린다', () => {
    const focus = resolveAnchorFocus(
      { id: 'q1', groupId: 'g1' },
      pages({ q1: [5], g1: [4, 5] }),
    );
    expect(focus).toEqual({ ownerId: 'q1', contextId: 'g1', pages: [4, 5] });
  });

  it('자기 영역이 없으면 소속 그룹으로 떨어진다 — 맥락도 그 그룹이다', () => {
    const focus = resolveAnchorFocus({ id: 'q1', groupId: 'g1' }, pages({ g1: [4, 5] }));
    expect(focus).toEqual({ ownerId: 'g1', contextId: 'g1', pages: [4, 5] });
  });

  it('한 대상에 사각형이 여러 쪽이면 가장 앞선 쪽이 먼저다', () => {
    // 블록이 3쪽·4쪽에 걸쳐 있으면 3쪽부터 순서대로 훑게 된다
    const focus = resolveAnchorFocus({ id: 'q1', groupId: null }, pages({ q1: [7, 3, 4] }));
    expect(focus?.pages).toEqual([3, 4, 7]);
  });

  it('맥락의 쪽 범위는 그룹과 그 안 문항들의 사각형을 합쳐서 잰다', () => {
    // 이어보기가 이 범위를 보고 쪽을 몇 장 붙일지 정한다
    const focus = resolveAnchorFocus(
      { id: 'q1', groupId: 'g1' },
      pages({ g1: [3], q1: [3], q2: [4] }),
      ['q1', 'q2'],
    );
    expect(focus?.pages).toEqual([3, 4]);
  });

  it('그룹에 영역이 없으면 맥락을 그리지 않는다', () => {
    const focus = resolveAnchorFocus({ id: 'q1', groupId: 'g1' }, pages({ q1: [2] }));
    expect(focus).toEqual({ ownerId: 'q1', contextId: null, pages: [2] });
  });

  it('자기에게도 그룹에도 영역이 없으면 켤 것이 없다', () => {
    expect(resolveAnchorFocus({ id: 'q1', groupId: 'g1' }, pages({}))).toBeNull();
  });
});

describe('resolveQuestionForOwner', () => {
  const visible = [
    { id: 'q1', groupId: 'g1' },
    { id: 'q2', groupId: 'g1' },
    { id: 'q3', groupId: 'g2' },
  ];

  it('문항 사각형이면 그 문항을 고른다', () => {
    expect(resolveQuestionForOwner('q2', visible)).toBe('q2');
  });

  it('그룹 사각형이면 그 그룹의 표시되는 첫 문항을 고른다', () => {
    expect(resolveQuestionForOwner('g1', visible)).toBe('q1');
  });

  it('그 그룹의 문항이 조건부로 전부 숨었으면 고를 것이 없다', () => {
    expect(resolveQuestionForOwner('g2', [{ id: 'q1', groupId: 'g1' }])).toBeNull();
  });
});

describe('조상 그룹 앵커 폴백', () => {
  // 분할 시작 판정(resolveSplitStartIndex)은 조상 사슬 전체를 본다. 폴백이 직속
  // 그룹만 보면 "분할은 시작됐는데 켤 것이 없는" 화면이 나온다.
  const parentOf = (id: string) => (id === 'sub' ? 'root' : null);

  it('하위그룹에 앵커가 없으면 상위 그룹까지 올라간다', () => {
    expect(
      resolveAnchorOwnerId(
        { kind: 'question', id: 'q1', groupId: 'sub' },
        (id) => id === 'root',
        parentOf,
      ),
    ).toBe('root');
  });

  it('가장 가까운 조상이 이긴다', () => {
    expect(
      resolveAnchorOwnerId(
        { kind: 'question', id: 'q1', groupId: 'sub' },
        (id) => id === 'root' || id === 'sub',
        parentOf,
      ),
    ).toBe('sub');
  });

  it('사슬 어디에도 없으면 켤 것이 없다', () => {
    expect(
      resolveAnchorOwnerId({ kind: 'question', id: 'q1', groupId: 'sub' }, () => false, parentOf),
    ).toBeNull();
  });

  it('그룹 사슬이 순환해도 멈춘다', () => {
    expect(
      resolveAnchorOwnerId(
        { kind: 'question', id: 'q1', groupId: 'a' },
        () => false,
        (id) => (id === 'a' ? 'b' : 'a'),
      ),
    ).toBeNull();
  });

  it('초점도 조상 앵커로 떨어지고 맥락이 그 그룹이 된다', () => {
    const focus = resolveAnchorFocus(
      { id: 'q1', groupId: 'sub' },
      (id) => (id === 'root' ? [7] : []),
      [],
      parentOf,
    );
    expect(focus).toEqual({ ownerId: 'root', contextId: 'root', pages: [7] });
  });
});
