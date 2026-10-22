/**
 * 「이미지 크게 보기」(CONTEXT.md) 판정 — 원본 전체가 화면에 다 보이지 않는(줄었거나 잘린) 이미지에만
 * 크게 보기를 붙인다. 원래 크기로 다 보이는 이미지는 같은 그림을 검은 배경 위에 다시 띄울 뿐이라
 * 반응하지 않는다.
 *
 * 같은 이미지라도 데스크톱에서는 원래 크기, 모바일에서는 줄어 있을 수 있어 그려진 크기는 화면마다
 * 다시 잰다. 이 함수는 잰 값만 받는다.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** 이미지를 상자에 맞추는 방식 — 줄여 넣기(전체 보임) / 잘라 채우기(넘치는 쪽이 잘림) */
export type ImageFit = 'contain' | 'cover';

/** 크게 보기를 여는 버튼의 이름 — 버튼 이름이 대체 텍스트를 덮으므로 원래 설명을 앞에 남긴다 */
export function enlargeTriggerLabel(alt: string): string {
  return `${alt.trim() || '이미지'} 크게 보기`;
}

/** 반 픽셀 미만의 차이는 반올림 오차로 본다 — 1px 줄어든 이미지는 잡고 소수점 측정값은 흘린다 */
const PIXEL_TOLERANCE = 0.5;

export function canEnlargeImage(input: {
  /** 원본 크기(로드 뒤 naturalWidth·naturalHeight) */
  natural: ImageSize;
  /** 그려진 상자 크기 */
  rendered: ImageSize;
  fit: ImageFit;
}): boolean {
  const { natural, rendered, fit } = input;
  if (natural.width <= 0 || natural.height <= 0) return false;
  if (rendered.width <= 0 || rendered.height <= 0) return false;

  const scaleX = rendered.width / natural.width;
  const scaleY = rendered.height / natural.height;
  const scale = fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);

  const shrunk = Math.max(natural.width, natural.height) * (1 - scale) >= PIXEL_TOLERANCE;
  const cropped =
    natural.width * scale - rendered.width >= PIXEL_TOLERANCE ||
    natural.height * scale - rendered.height >= PIXEL_TOLERANCE;
  return shrunk || cropped;
}

/** 화면 위 사각형 — 같은 좌표계(getBoundingClientRect)로 잰 값 */
export interface ImageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 본문 이미지 돋보기 지름 — 표 이미지 배지(size-7)와 같다 */
export const ENLARGE_BADGE_SIZE = 28;
/** 사진 바깥에 둘 때 사진과의 틈 */
const BADGE_GAP = 4;
/** 사진 안에 둘 때 모서리에서 띄우는 거리 — 순위형 보기 돋보기(top-1.5 right-1.5)와 같다 */
const BADGE_INSET = 6;

/**
 * 본문(안내문·설명) 이미지의 돋보기 자리 — 늘 사진의 오른쪽 위다. 사진 오른쪽에 돋보기가 들어갈 자리가
 * 남으면 사진 바깥 오른쪽, 위 끝에 맞춰 둔다 — 작게 가운데 놓인 로고 같은 자극물을 가리지 않는다. 자리가
 * 없으면(폭을 꽉 채운 사진) 순위형 보기 돋보기처럼 사진 안 우상단에 둔다. 아래쪽을 쓰지 않는 것은 본문
 * 이미지 바로 밑에 글이 붙는 경우가 많고, 가로로 긴 띠 그림은 설명 글자가 아래쪽에 몰려서다.
 *
 * `bounds` 는 돋보기가 바깥에 나가도 되는 영역이다 — 부르는 쪽이 사진이 혼자 놓인 블록(문단·표 칸)을
 * 넘기고, 옆에 다른 내용이 있으면 사진 자신을 넘겨 안에 두게 한다. 입력과 결과는 같은 좌표계다.
 */
export function placeEnlargeBadge(
  image: ImageBox,
  bounds: ImageBox,
): { left: number; top: number; outside: boolean } {
  if (bounds.right - image.right >= ENLARGE_BADGE_SIZE + BADGE_GAP) {
    return {
      left: image.right + BADGE_GAP,
      top: image.top,
      outside: true,
    };
  }
  return {
    left: image.right - ENLARGE_BADGE_SIZE - BADGE_INSET,
    top: image.top + BADGE_INSET,
    outside: false,
  };
}
