/**
 * 「이미지 크게 보기」(CONTEXT.md) 판정 — 원본 전체가 화면에 다 보이지 않는(줄었거나 잘린) 이미지에만
 * 크게 보기를 붙인다. 원래 크기로 다 보이는 이미지는 같은 그림을 검은 배경 위에 다시 띄울 뿐이라
 * 반응하지 않는다.
 *
 * 같은 이미지라도 데스크톱에서는 원래 크기, 모바일에서는 줄어 있을 수 있어 그려진 크기는 화면마다
 * 다시 잰다. 이 함수는 잰 값만 받는다.
 *
 * ── 배선과 규칙 ──
 * - **이미지 크게 보기** (2026-10-21): 응답 화면에서 원본 전체가 다 보이지 않는(줄었거나 잘린) 이미지를 누르면
 *   원본 한 장을 띄운다.
 * - 설정 없는 기본 기능이고 마이그레이션·저장 변경이 없다.
 * - 범위는 셋이다 — ① 표 이미지 셀(데스크톱 격자 · 모바일 표시 셀) ② 순위형 보기
 *   이미지(`ranking-option-image.tsx` 의 `RankingOptionImage`, `EnlargeableImage` 의 `trigger="button"` —
 *   이미지 누르기는 클릭 방식의 순위 지정이라 입력 방식과 무관하게 돋보기 버튼으로만 열고, 버튼 click 은 바깥
 *   보기로 번지지 않게 끊는다) ③ 안내문·설명 본문 이미지(`rich-text-image-enlarge.tsx` 의
 *   `useRichTextImageEnlarge` — HTML 을 그대로 넣어 그리므로 본문 상자 한 곳에서 재고 누르기를 받는다. 줄어
 *   보이는 이미지에 `data-enlargeable`·`role`·`tabindex` 를 붙이고 `<a>` 안의 이미지는 건너뛴다. 에디터가
 *   이미지 크기를 % 로 적어 감싸는 요소를 끼우면 크기가 바뀌므로 이미지를 감싸지 않는다. 터치 기기용 돋보기는
 *   본문 상자의 형제로 띄우고 부르는 쪽이 둘을 `relative` 상자로 감싼다 — 자리는 `placeEnlargeBadge`, 늘 사진의
 *   오른쪽 위로 사진이 혼자 놓인 문단·표 칸의 오른쪽에 자리가 있으면 바깥, 옆에 글·다른 이미지가 있거나 자리가
 *   없으면 안이다(2026-10-22). 돋보기는 본문 상자의 보이는 영역으로 잘리는 층 안에 뜬다 — 모바일 본문은 넓은
 *   표를 가로 스크롤한다. 본문 상자의 `dangerouslySetInnerHTML` 객체는 `useMemo` 로 고정한다 — 새 객체면 React
 *   19 가 다시 그릴 때마다 본문을 통째로 다시 넣어 표식 붙은 이미지가 새 이미지로 바뀐다).
 * - 창은 포털이지만 React 이벤트가 거슬러 오르므로 `ImageEnlargeOverlay` 가 창 안의 누르기·키 입력을 끊는다.
 * - 판정은 `features/question-renderer/utils/image-enlarge.ts` 의 `canEnlargeImage`(원본 크기 ↔ 그려진 크기,
 *   `contain`/`cover`), 이미지는 `enlargeable-image.tsx` 의 `EnlargeableImage`, 창은
 *   `image-enlarge-viewer.tsx`(`yet-another-react-lightbox` + Zoom, lazy) 하나다 — 맞춤 보기는 원본보다 키우지
 *   않고 확대(더블클릭·휠·`+`·두 손가락)는 원본 픽셀 2배까지, 넘기기·쓸어내려 닫기 없음, 배경 클릭 닫기는
 *   마우스 있는 기기만.
 * - **휴대폰·브라우저 뒤로 가기로 닫힌다** — 창이 열릴 때 지금 방문 기록 칸을 이어(응답 흐름의 `stepIndex`
 *   포함) 표식 `imageEnlarge` 칸을 하나 쌓고, X·Esc·배경 클릭도 그 칸을 `history.back` 으로 걷어 같은 길로
 *   닫는다.
 * - 응답 흐름의 뒤로 가기 처리(`survey-response-flow` 의 popstate)는 **돌아온 칸의 `stepIndex` 가 지금 페이지와
 *   같으면 페이지를 넘기지 않는다** — 페이지 위에 쌓인 칸을 걷은 것이기 때문이다.
 * - 페이지 위에 칸을 쌓는 기능을 새로 만들면 같은 방식(지금 칸을 이어 쌓기)을 따를 것.
 * - **표 이미지(①②)가 켜지는 곳은 `TableImageEnlargeProvider`(`table-image-enlarge.tsx`) 안뿐이다** — 응답
 *   화면의 표(`InteractiveTableResponse`·`ChoiceTableResponse`·`RankingQuestion`)가 감싸고, 빌더 편집 화면의
 *   표(질문 편집 미리보기 · 합계 제약 · 수식 항 셀 선택)는 밖이라 이미지 칸을 눌러도 셀 선택이 그대로다.
 * - 같은 공급자가 머리 줄 「행 제목 · 열 제목」(축 단위 카드의 `buildCellPositionLabels`)을 내려 준다.
 * - 표시는 화면 폭이 아니라 `@media (hover: hover)` 로 가른다(마우스 기기는 올렸을 때만 배지, 터치 기기는
 *   상시).
 * - 헤더 로고는 대상이 아니다.
 * - 테스트에서 이미지 크기는 `tests/helpers/image-size.ts` 로 정한다(jsdom 은 배치를 계산하지 않는다).
 * - vitest 설정은 라이브러리 CSS import 때문에 빈 PostCSS 설정을 직접 준다.
 */
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import { systemText } from '@/utils/system-strings';

export interface ImageSize {
  width: number;
  height: number;
}

/** 이미지를 상자에 맞추는 방식 — 줄여 넣기(전체 보임) / 잘라 채우기(넘치는 쪽이 잘림) */
export type ImageFit = 'contain' | 'cover';

/**
 * 크게 보기를 여는 버튼의 이름 — 버튼 이름이 대체 텍스트를 덮으므로 원래 설명을 남긴다.
 * 대체 텍스트는 저작자 글자라 번역하지 않고, 둘러싼 말만 현재 언어다.
 */
export function enlargeTriggerLabel(
  alt: string,
  locale: SurveyLocale = DEFAULT_SURVEY_LOCALE,
): string {
  return systemText('media.enlarge', locale, {
    alt: alt.trim() || systemText('media.imageFallbackAlt', locale),
  });
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
