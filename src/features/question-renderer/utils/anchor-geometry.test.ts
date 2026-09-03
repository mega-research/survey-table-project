import { describe, expect, it } from 'vitest';

import {
  locate,
  locateOnPage,
  normalizeDrag,
  place,
  scrollTarget,
  type PageBox,
} from './anchor-geometry';

/**
 * 데모의 좌표 테스트를 이식한 것 + 경계값 보강.
 *
 * 확대율 z 에서의 20쪽짜리 조사표. 쪽 사이 여백 16px.
 * left 는 실측값이라 화면 폭에 따라 제각각일 수 있으므로 인자로 받는다.
 */
function doc(z: number, pages = 20, left = 0): PageBox[] {
  const width = 600 * z;
  const height = 850 * z;
  return Array.from({ length: pages }, (_, i) => ({
    page: i + 1,
    top: i * (height + 16 * z),
    left,
    height,
    width,
  }));
}

/** 쪽의 좌상단에서 (x, y) 비율만큼 들어간 지점의 컨테이너 좌표 */
function pointOnPage(boxes: PageBox[], page: number, x: number, y: number) {
  const b = boxes.find((v) => v.page === page)!;
  return { localX: b.left + x * b.width, localY: b.top + y * b.height };
}

describe('locate', () => {
  it('확대율과 좌측 여백이 달라도 같은 지점이 같은 0~1 값으로 나온다', () => {
    const results = [
      [0.5, 0],
      [1, 37],
      [2.5, -120],
    ].map(([z, left]) => {
      const boxes = doc(z!, 20, left!);
      const p = pointOnPage(boxes, 3, 0.25, 0.4);
      return locate(boxes, p.localX, p.localY);
    });

    for (const r of results) {
      expect(r?.page).toBe(3);
      expect(r?.x).toBeCloseTo(0.25, 6);
      expect(r?.y).toBeCloseTo(0.4, 6);
    }
  });

  it('쪽 경계 위아래에서 올바른 쪽 번호가 나온다', () => {
    const boxes = doc(1);
    const p2 = boxes[1]!;

    expect(locate(boxes, 324, p2.top + 1)?.page).toBe(2);
    expect(locate(boxes, 324, p2.top + p2.height - 1)?.page).toBe(2);
    expect(locate(boxes, 324, p2.top - 8)).toBeNull(); // 쪽 사이 여백
  });

  it('문서 아래 빈 공간은 어느 쪽도 아니다', () => {
    const boxes = doc(1, 2);
    const last = boxes[1]!;
    expect(locate(boxes, 324, last.top + last.height + 100)).toBeNull();
  });

  it('크기 0 인 쪽은 나눗셈을 하지 않고 거부한다', () => {
    const zero: PageBox[] = [{ page: 1, top: 0, left: 0, width: 0, height: 0 }];
    expect(locate(zero, 0, 0)).toBeNull();
  });

  it('한 쪽만 그려져 있어도 그대로 동작한다 — 뷰어가 쪽 단위이기 때문', () => {
    const boxes = doc(1).filter((b) => b.page === 7);
    const p = pointOnPage(doc(1), 7, 0.1, 0.9);
    const hit = locate(boxes, p.localX, p.localY);
    expect(hit?.page).toBe(7);
    expect(hit?.x).toBeCloseTo(0.1, 6);
    expect(hit?.y).toBeCloseTo(0.9, 6);
  });
});

describe('normalizeDrag', () => {
  const on = (page: number, x: number, y: number) => ({ page, x, y });

  it('어느 방향으로 끌어도 같은 사각형이 나온다', () => {
    const a = normalizeDrag(on(3, 0.2, 0.3), on(3, 0.6, 0.5));
    const b = normalizeDrag(on(3, 0.6, 0.5), on(3, 0.2, 0.3));
    expect(a).toEqual(b);
    expect(a?.page).toBe(3);
    expect(a?.x).toBeCloseTo(0.2, 6);
    expect(a?.y).toBeCloseTo(0.3, 6);
    expect(a?.w).toBeCloseTo(0.4, 6);
    expect(a?.h).toBeCloseTo(0.2, 6);
  });

  it('시작 쪽을 벗어난 드래그는 무시한다', () => {
    // 쪽에 걸친 구간은 사각형 두 개로 나눠 잡는다 — 한 대상에 여럿을 허용하는 이유
    expect(normalizeDrag(on(3, 0.2, 0.9), on(4, 0.6, 0.1))).toBeNull();
  });

  it('쪽 밖으로 나간 좌표를 0~1 안으로 자른다', () => {
    expect(normalizeDrag(on(1, -0.4, -0.2), on(1, 1.7, 1.3))).toEqual({
      page: 1,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it('너무 작은 드래그는 버린다', () => {
    expect(normalizeDrag(on(1, 0.5, 0.5), on(1, 0.5, 0.5))).toBeNull();
    expect(normalizeDrag(on(1, 0.5, 0.5), on(1, 0.51, 0.6))).toBeNull(); // 폭 1%
    expect(normalizeDrag(on(1, 0.5, 0.5), on(1, 0.7, 0.502))).toBeNull(); // 높이 0.2%
  });

  it('최소 크기에 딱 맞으면 살린다', () => {
    expect(normalizeDrag(on(1, 0.5, 0.5), on(1, 0.52, 0.505))).not.toBeNull();
  });

  it('잘라낸 뒤 최소 크기에 못 미치면 버린다', () => {
    // 쪽 왼쪽 밖에서 시작해 x=0.01 에서 끝나면, 잘린 폭은 1%뿐이다
    expect(normalizeDrag(on(1, -0.5, 0.2), on(1, 0.01, 0.4))).toBeNull();
  });

  it('쪽 모서리에 딱 붙은 사각형도 그대로 살아난다', () => {
    expect(normalizeDrag(on(2, 0, 0), on(2, 0.3, 0.2))).toEqual({
      page: 2,
      x: 0,
      y: 0,
      w: 0.3,
      h: 0.2,
    });
    const bottomRight = normalizeDrag(on(2, 0.7, 0.8), on(2, 1, 1));
    expect(bottomRight).not.toBeNull();
    expect(bottomRight!.x).toBeCloseTo(0.7, 6);
    expect(bottomRight!.x + bottomRight!.w).toBeCloseTo(1, 6);
    expect(bottomRight!.y + bottomRight!.h).toBeCloseTo(1, 6);
  });
});

describe('place', () => {
  it('정규화 좌표를 화면 배치로 되돌린다', () => {
    const boxes = doc(1, 20, 37);
    const box = boxes[2]!;
    const got = place({ page: 3, x: 0.25, y: 0.4, w: 0.5, h: 0.1 }, boxes, 24);
    expect(got).toEqual({
      left: 24 + 37 + 0.25 * 600,
      top: 24 + box.top + 0.4 * 850,
      width: 300,
      height: 85,
    });
  });

  it('locate 로 얻은 값을 place 로 되돌리면 원래 지점으로 돌아온다', () => {
    for (const [z, left] of [
      [0.5, 0],
      [1, 37],
      [2.5, -120],
    ]) {
      const boxes = doc(z!, 20, left!);
      const p = pointOnPage(boxes, 5, 0.3, 0.6);
      const hit = locate(boxes, p.localX, p.localY)!;
      const placed = place({ ...hit, w: 0.1, h: 0.1 }, boxes, 0)!;
      expect(placed.left).toBeCloseTo(p.localX, 6);
      expect(placed.top).toBeCloseTo(p.localY, 6);
    }
  });

  it('빌더에서 잡은 좌표가 폭이 다른 응답 화면에서 같은 자리에 놓인다', () => {
    // 빌더: 쪽 폭 900, 좌측 여백 20 / 응답: 쪽 폭 620, 좌측 여백 0
    const editor = doc(1.5, 20, 20);
    const viewer = doc(1, 20, 0);

    const p = pointOnPage(editor, 4, 0.42, 0.31);
    const hit = locate(editor, p.localX, p.localY)!;

    const box = viewer.find((b) => b.page === 4)!;
    const placed = place({ ...hit, w: 0.2, h: 0.05 }, viewer, 0)!;
    expect(placed.left).toBeCloseTo(box.left + 0.42 * box.width, 6);
    expect(placed.top).toBeCloseTo(box.top + 0.31 * box.height, 6);
  });

  it('그려져 있지 않은 쪽은 배치하지 않는다', () => {
    expect(place({ page: 99, x: 0, y: 0, w: 1, h: 1 }, doc(1), 24)).toBeNull();
  });

  it('폭·높이 0 인 사각형도 위치는 낸다 — 판단은 호출자 몫', () => {
    const placed = place({ page: 1, x: 0.5, y: 0.5, w: 0, h: 0 }, doc(1), 0);
    expect(placed).toEqual({ left: 300, top: 425, width: 0, height: 0 });
  });
});

describe('scrollTarget', () => {
  const base = { viewTop: 0, viewHeight: 800, pad: 80 };

  it('맥락이 화면에 들어오면 맥락 상단에 맞춘다', () => {
    expect(
      scrollTarget({ ...base, contextTop: 500, contextBottom: 900, focusTop: 800, focusBottom: 880 }),
    ).toBe(420);
  });

  it('이미 맥락 상단에 맞춰져 있으면 움직이지 않는다', () => {
    expect(
      scrollTarget({
        ...base,
        viewTop: 420,
        contextTop: 500,
        contextBottom: 900,
        focusTop: 800,
        focusBottom: 880,
      }),
    ).toBeNull();
  });

  it('맥락이 화면보다 길면, 선택한 것이 보이는 동안은 움직이지 않는다', () => {
    expect(
      scrollTarget({
        ...base,
        viewTop: 1000,
        contextTop: 900,
        contextBottom: 3000,
        focusTop: 1300,
        focusBottom: 1400,
      }),
    ).toBeNull();
  });

  it('선택한 것이 위로 벗어나면 그만큼만 올라간다', () => {
    expect(
      scrollTarget({
        ...base,
        viewTop: 1000,
        contextTop: 900,
        contextBottom: 3000,
        focusTop: 1020,
        focusBottom: 1100,
      }),
    ).toBe(940);
  });

  it('선택한 것이 아래로 벗어나면 그만큼만 내려간다', () => {
    expect(
      scrollTarget({
        ...base,
        viewTop: 1000,
        contextTop: 900,
        contextBottom: 3000,
        focusTop: 1700,
        focusBottom: 1780,
      }),
    ).toBe(1060);
  });

  it('문서 위로는 넘어가지 않는다', () => {
    expect(
      scrollTarget({
        ...base,
        viewTop: 300,
        contextTop: 10,
        contextBottom: 200,
        focusTop: 10,
        focusBottom: 90,
      }),
    ).toBe(0);
  });

  it('이미 맨 위에 있으면 움직이지 않는다', () => {
    expect(
      scrollTarget({ ...base, contextTop: 10, contextBottom: 200, focusTop: 10, focusBottom: 90 }),
    ).toBeNull();
  });
});

describe('locateOnPage', () => {
  it('커서가 다음 쪽으로 내려가도 시작 쪽 좌표로 읽는다', () => {
    // 드래그 도중 locate 를 쓰면 쪽이 바뀌어 normalizeDrag 가 null 을 내고
    // 만들던 사각형이 사라진다 — 그래서 시작 쪽에 고정해 읽는다.
    const boxes = doc(1);
    const onPage2 = pointOnPage(boxes, 2, 0.5, 0.5);
    const hit = locateOnPage(boxes, 1, onPage2.localX, onPage2.localY);
    expect(hit?.page).toBe(1);
    expect(hit?.y).toBeGreaterThan(1); // 1쪽 기준으로는 아래로 벗어난 값
  });

  it('쪽 사이 여백에서도 값을 낸다 — locate 는 null 을 내는 자리다', () => {
    const boxes = doc(1);
    const gapY = boxes[0]!.top + boxes[0]!.height + 8;
    expect(locate(boxes, 300, gapY)).toBeNull();
    expect(locateOnPage(boxes, 1, 300, gapY)?.y).toBeGreaterThan(1);
  });

  it('그려지지 않은 쪽은 읽을 수 없다', () => {
    expect(locateOnPage(doc(1, 2), 5, 0, 0)).toBeNull();
  });

  it('같은 쪽 안에서는 locate 와 같은 값을 낸다', () => {
    const boxes = doc(1, 20, 37);
    const p = pointOnPage(boxes, 3, 0.25, 0.4);
    expect(locateOnPage(boxes, 3, p.localX, p.localY)).toEqual(
      locate(boxes, p.localX, p.localY),
    );
  });
});
