'use client';

/**
 * 응답 화면의 레이아웃 골격 — 밴드 넷(헤더 · 진행 현황 · 본문 · 하단 내비)만 안다.
 *
 * 이 셸을 떼어낸 이유는 뒤에 오는 분할 레이아웃을 **셸 교체**로 끝내기 위해서다.
 * 골격이 응답 플로우(1300줄) 안에 평평한 JSX 로 박혀 있고 밴드마다 컨테이너 폭
 * 값을 각자 물고 있어서, 분할을 그냥 집어넣으면 그 파일 안에서 수술하게 된다.
 *
 * 폭 전환 애니메이션(`transition-all duration-300`)은 max-width 를 애니메이션하므로
 * 매 프레임 clientWidth 가 바뀐다. 표의 폭 측정 훅이 이를 코얼레싱하고 있으니
 * 전환 시간을 건드릴 때 그쪽(use-element-width.ts)도 함께 볼 것.
 *
 * 이 셸은 아직 분할을 모른다.
 */
interface Props {
  /** 컨테이너 폭 클래스 — 밴드 셋이 같은 값을 공유해야 전환이 어긋나지 않는다. */
  containerMaxWidth: string;
  /** 화면에 보이지 않는 부속(허니팟 등). 밴드 밖 최상단에 놓인다. */
  chrome?: React.ReactNode;
  header: React.ReactNode;
  progress: React.ReactNode;
  children: React.ReactNode;
  /** 하단 고정 내비 — 모바일에서만 넘어온다. */
  bottomNav?: React.ReactNode;
  /** 하단 고정 내비가 본문을 가리지 않도록 본문 아래 여백을 키운다. */
  reserveBottomNavSpace: boolean;
}

export function SurveyResponseLayout({
  containerMaxWidth,
  chrome,
  header,
  progress,
  children,
  bottomNav,
  reserveBottomNavSpace,
}: Props) {
  return (
    <div className="min-h-dvh bg-gray-50">
      {chrome}
      {/* 헤더 — 제목/로고/통계법만 (진행바·카운트는 아래 회색 영역으로 분리) */}
      <div className="border-b border-gray-200 bg-white">
        <div
          className={`${containerMaxWidth} mx-auto px-4 pt-2 pb-2 transition-all duration-300 md:px-6 md:pb-0`}
        >
          {header}
        </div>
      </div>

      {/* 진행 현황 — 헤더 밖 회색 영역(콘텐츠 컨테이너 위) */}
      <div className={`${containerMaxWidth} mx-auto px-4 pt-1 transition-all duration-300 md:px-6`}>
        {progress}
      </div>

      {/* 메인 콘텐츠 */}
      <div
        className={`${containerMaxWidth} mx-auto px-4 pt-2 transition-all duration-300 md:px-6 md:pt-2 ${
          reserveBottomNavSpace ? 'pb-28' : 'pb-16 md:pb-24'
        }`}
      >
        {children}
      </div>

      {bottomNav}
    </div>
  );
}
