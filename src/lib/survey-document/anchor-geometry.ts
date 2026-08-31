/**
 * 조사표 위 영역(앵커)의 좌표 변환 — 순수 모듈. DB·React·pdf.js 를 모른다.
 *
 * 저장하는 좌표는 언제나 **쪽 번호 + 쪽 크기 대비 0~1 비율**이다. 화면 픽셀을
 * 저장하는 경로는 없다. 확대율·devicePixelRatio·창 크기가 바뀌어도 같은 영역이
 * 같은 값으로 남고, 빌더에서 잡은 사각형이 폭이 다른 응답 화면에서 같은 자리에 놓인다.
 *
 * 이 변환을 한 곳에 가둔 이유는 하나다 — 데모에서 **좌표 계산이 버그의 원천**이었고,
 * 거기서 얻은 교훈이 "화면 좌표는 계산하지 말고 실측하라"였다. 그래서 PageBox 는
 * 전부 렌더된 DOM 에서 잰 값이고, 이 모듈은 그 실측값과 비율 사이만 오간다.
 */

/** 저장되는 좌표. page 는 1-base. */
export type NormRect = { page: number; x: number; y: number; w: number; h: number };

/**
 * 렌더된 쪽 하나가 화면에서 차지하는 자리. **전부 실측값이다.**
 * 가로 위치를 (컨테이너폭 − 쪽폭)/2 로 계산하던 것이 세로 스크롤바가 생기는
 * 시점과 어긋나 몇 px 씩 밀렸다. 폭이 다른 화면에서 다르게 밀리므로 재서 받는다.
 */
export type PageBox = { page: number; top: number; left: number; height: number; width: number };

/** 이보다 작은 드래그는 클릭 실수로 보고 버린다. */
export const MIN_ANCHOR_W = 0.02;
export const MIN_ANCHOR_H = 0.005;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 컨테이너 좌표계의 한 점이 어느 쪽의 어디인지.
 * 어느 쪽에도 걸치지 않으면 null. x/y 는 클램프하지 않은 원값이라 쪽 밖을
 * 가리키면 0 미만이거나 1 초과일 수 있다 — 자르는 것은 normalizeDrag 몫이다.
 */
export function locate(
  boxes: readonly PageBox[],
  localX: number,
  localY: number,
): { page: number; x: number; y: number } | null {
  const box = boxes.find((b) => localY >= b.top && localY <= b.top + b.height);
  if (!box || box.height <= 0 || box.width <= 0) return null;
  return {
    page: box.page,
    x: (localX - box.left) / box.width,
    y: (localY - box.top) / box.height,
  };
}

/**
 * 드래그 시작점과 끝점을 정규화 사각형으로.
 *
 * - 시작 쪽을 벗어난 끝점은 받지 않는다(null). 좌표 모델이 쪽 단위라는 전제를
 *   지키기 위함이다. 쪽에 걸친 구간은 영역 두 개로 나눠 잡는다 — 한 대상에
 *   사각형 여럿을 허용하는 이유가 이것이다.
 * - 쪽 밖으로 나간 좌표는 0~1 안으로 자른다.
 * - 자르고 난 결과가 최소 크기에 못 미치면 버린다(null).
 */
export function normalizeDrag(
  start: { page: number; x: number; y: number },
  end: { page: number; x: number; y: number },
): NormRect | null {
  if (start.page !== end.page) return null;

  const x0 = clamp01(start.x);
  const y0 = clamp01(start.y);
  const x1 = clamp01(end.x);
  const y1 = clamp01(end.y);

  const rect: NormRect = {
    page: start.page,
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
  return rect.w >= MIN_ANCHOR_W && rect.h >= MIN_ANCHOR_H ? rect : null;
}

/**
 * 정규화 사각형을 화면 배치(px)로. `pad` 는 쪽을 감싼 스크롤 영역의 안쪽 여백.
 * 그 쪽이 지금 그려져 있지 않으면 null — 호출자는 그리지 않는다.
 */
export function place(
  rect: NormRect,
  boxes: readonly PageBox[],
  pad = 0,
): { left: number; top: number; width: number; height: number } | null {
  const box = boxes.find((b) => b.page === rect.page);
  if (!box) return null;
  return {
    left: pad + box.left + rect.x * box.width,
    top: pad + box.top + rect.y * box.height,
    width: rect.w * box.width,
    height: rect.h * box.height,
  };
}

/**
 * 쪽 안에서 어디로 스크롤할지 정한다. `null` 이면 그대로 둔다.
 *
 * 맥락(그룹) 전체가 화면에 들어오면 맥락 상단에 맞춰 최대한 보여주고,
 * 들어오지 않으면 **선택한 것이 화면 밖일 때만** 최소한으로 움직인다.
 * 이미 보이는데도 매번 맞추면 훑는 동안 화면이 계속 튄다.
 */
export function scrollTarget(input: {
  /** 맥락(그룹) 영역 전체의 위·아래 */
  contextTop: number;
  contextBottom: number;
  /** 선택한 것의 위·아래. 자기 영역이 없으면 맥락과 같게 준다 */
  focusTop: number;
  focusBottom: number;
  /** 현재 스크롤 위치와 보이는 높이 */
  viewTop: number;
  viewHeight: number;
  pad: number;
}): number | null {
  const { contextTop, contextBottom, focusTop, focusBottom, viewTop, viewHeight, pad } = input;

  if (contextBottom - contextTop + pad * 2 <= viewHeight) {
    const want = Math.max(0, contextTop - pad);
    return want === viewTop ? null : want;
  }

  if (focusTop < viewTop + pad) return Math.max(0, focusTop - pad);
  if (focusBottom > viewTop + viewHeight - pad) {
    return Math.max(0, focusBottom - viewHeight + pad);
  }
  return null;
}
