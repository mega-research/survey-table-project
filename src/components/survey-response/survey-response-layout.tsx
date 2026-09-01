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
 * **분할 레이아웃**: `documentPane` 이 오면 페이지가 좌(조사표) / 우(질문) 50:50 으로
 * 갈라진다. 갈라진 상태에서는 페이지 전체가 뷰포트 높이에 갇히고 두 판이 각자 스크롤한다 —
 * 조사표를 보면서 답하려면 왼쪽이 화면에 남아 있어야 한다. 밴드 폭 제한도 이때는 풀린다.
 *
 * 분할은 **페이지마다** 파생된다. 조사표에 등록되지 않은 페이지는 일반 문항 페이지로
 * 돌아오므로 조사표 판이 언마운트된다 — 다시 열리는 비용은 뷰어의 문서 캐시가 받는다
 * (pdf-page-view.tsx 의 openedDocs).
 */
interface Props {
  /** 컨테이너 폭 클래스 — 밴드 셋이 같은 값을 공유해야 전환이 어긋나지 않는다. */
  containerMaxWidth: string;
  /** 화면에 보이지 않는 부속(허니팟 등). 밴드 밖 최상단에 놓인다. */
  chrome?: React.ReactNode;
  header: React.ReactNode;
  /**
   * 진행 현황 밴드. 없으면 밴드 자체를 그리지 않는다 — 분할 레이아웃은 위치를
   * 헤더 설명 줄에 접어 넣고 진행바를 두지 않는다.
   */
  progress?: React.ReactNode;
  children: React.ReactNode;
  /** 하단 고정 내비 — 모바일에서만 넘어온다. */
  bottomNav?: React.ReactNode;
  /** 하단 고정 내비가 본문을 가리지 않도록 본문 아래 여백을 키운다. */
  reserveBottomNavSpace: boolean;
  /**
   * 왼쪽 조사표 판. 있으면 분할 레이아웃이다.
   * 모드는 앵커에서 파생되므로 이 셸에는 토글이 없다 — 넘어오면 분할, 아니면 아니다.
   */
  documentPane?: React.ReactNode;
}

export function SurveyResponseLayout({
  containerMaxWidth,
  chrome,
  header,
  progress,
  children,
  bottomNav,
  reserveBottomNavSpace,
  documentPane,
}: Props) {
  const isSplit = Boolean(documentPane);
  // 분할에서는 밴드 폭 제한을 푼다 — 전폭 두 판 위에 좁은 헤더만 떠 있으면 어긋나 보인다.
  const bandWidth = isSplit ? 'max-w-none' : containerMaxWidth;

  return (
    <div
      className={
        isSplit ? 'flex h-dvh flex-col overflow-hidden bg-gray-50' : 'min-h-dvh bg-gray-50'
      }
    >
      {chrome}
      {/* 헤더 — 제목/로고/통계법만 (진행바·카운트는 아래 회색 영역으로 분리) */}
      <div className="shrink-0 border-b border-gray-200 bg-white">
        <div
          className={`${bandWidth} mx-auto px-4 pt-2 pb-2 transition-all duration-300 md:px-6 md:pb-0`}
        >
          {header}
        </div>
      </div>

      {/* 진행 현황 — 헤더 밖 회색 영역(콘텐츠 컨테이너 위) */}
      {progress && (
        <div
          className={`${bandWidth} mx-auto shrink-0 px-4 pt-1 transition-all duration-300 md:px-6`}
        >
          {progress}
        </div>
      )}

      {/* 메인 콘텐츠 — 분할이면 좌 조사표 / 우 질문 50:50 */}
      {isSplit ? (
        // 좌 조사표 / 우 문항 50:50 고정. 두 판 모두 min-w-0 이라야 안쪽 내용이
        // 컨테이너를 밀어내지 않는다 — flex 기본값(min-width:auto)이면 긴 줄 하나가
        // 판을 넓혀 바깥에 가로 스크롤이 생긴다.
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 border-r border-gray-200">{documentPane}</div>
          <div className="min-w-0 flex-1 overflow-y-auto bg-gray-50/60 p-5">{children}</div>
        </div>
      ) : (
        <div
          className={`${containerMaxWidth} mx-auto px-4 pt-2 transition-all duration-300 md:px-6 md:pt-2 ${
            reserveBottomNavSpace ? 'pb-28' : 'pb-16 md:pb-24'
          }`}
        >
          {children}
        </div>
      )}

      {bottomNav}
    </div>
  );
}
