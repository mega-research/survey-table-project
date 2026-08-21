// 설문 구조 JSONB 계약 — surveys.response_header·group_name_design, survey_versions.snapshot, 보관함 질문 문서.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수 제외).
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import type {
  HeaderCell,
  NumberFormat,
  QuestionConditionGroup,
  QuestionOption,
  RankingConfig,
  SelectLevel,
  SumConstraint,
  TableColumn,
  TableRow,
  TableValidationRule,
} from '@/types/survey';

// 버전 스냅샷 타입
export interface SurveyVersionSnapshot {
  title: string;
  description?: string;
  questions: QuestionData[];
  groups: QuestionGroupData[];
  settings: {
    isPublic: boolean;
    allowMultipleResponses: boolean;
    showProgressBar: boolean;
    shuffleQuestions: boolean;
    requireLogin: boolean;
    endDate?: string;
    maxResponses?: number;
    thankYouMessage: string;
    requireInviteToken?: boolean;
    forceWideLayout?: boolean;
    responseHeader?: SurveyResponseHeaderConfig;
  };
}

/**
 * 루트 질문 그룹 이름 배지 디자인 설정 (응답 페이지). 미설정/누락 시 기본 라이트 블루 배지로 폴백.
 * 복합 디자인 설정은 단일 JSONB 로 묶는다(responseHeader 선례).
 */
export interface GroupNameDesign {
  fullWidth?: boolean; // true 면 카드 콘텐츠 영역 전체 너비(w-full), 기본 false = 컨텐츠 크기(w-fit)
  bgColor?: string; // 배경색 hex (미설정 시 bg-blue-50)
  textColor?: string; // 폰트색 hex (미설정 시 text-blue-700)
}

export type ResponseHeaderStyle = 'plain' | 'logo-title' | 'official-band' | 'composed';

export type ResponseHeaderLogoSize = 'sm' | 'md' | 'lg';

export type ResponseHeaderTitleSize = 'auto' | 'md' | 'lg';

export type ResponseHeaderNoticeWidth = 'sm' | 'md' | 'lg';

export type ResponseHeaderTitleAlign = 'left' | 'center' | 'right';

export type ResponseHeaderLogoAlign = 'top' | 'center' | 'bottom';

// ── composed(v2) 응답 헤더 — 블록 조합형 ────────────────────────────────────
// plain/logo-title/official-band 는 레거시 저장 형태로 유지되고, 읽기 시
// normalizeResponseHeaderConfig 가 composed 로 마이그레이션한다.
export type ResponseHeaderBlockSize = 'sm' | 'md' | 'lg';

/** left/center/right = 블록 행(stacked)·inline 셀, title-left/right = 제목 밴드 안, above/below = 한줄형 문구 전용 */
export type ResponseHeaderBlockPos =
  'left' | 'center' | 'right' | 'title-left' | 'title-right' | 'above' | 'below';

/** 이미지 선: none = 없음, line = 이미지 테두리, wrap = 컨테이너 박스 */
export type ResponseHeaderImageFrame = 'none' | 'line' | 'wrap';

export type ResponseHeaderNoticeFormat = 'box' | 'line';

export type ResponseHeaderVAlign = 'top' | 'center' | 'bottom';

export type ResponseHeaderBandStyle = 'band' | 'boxed' | 'rule' | 'plain';

/** 모바일 렌더 모드 — 마지막 적용 프리셋이 겸한다 */
export type ResponseHeaderMobileStyle = 'gov' | 'band' | 'title';

export type ResponseHeaderLayout = 'stacked' | 'inline';

// interface 는 암묵 인덱스 시그니처가 없어 JSONB 패스스루 타입({ [key: string]: unknown })에
// 대입 불가하므로 type alias 로 선언한다 (promote 등 소비처 호환)
type ResponseHeaderBlockBase = {
  id: string; // generateId() — 질문·옵션 id 와 동일 관례. 마이그레이션 산출 블록만 결정적 id
  pos: ResponseHeaderBlockPos;
  size: ResponseHeaderBlockSize;
};

export type ResponseHeaderBlock =
  | (ResponseHeaderBlockBase & {
      type: 'mark'; // 국가통계 마크 — 업로드형 (번들 에셋 없음)
      imageUrl: string; // 미업로드 시 빈 문자열(자리표시자 렌더)
      altText?: string;

      frame?: ResponseHeaderImageFrame;
    })
  | (ResponseHeaderBlockBase & {
      type: 'logo';
      imageUrl: string;
      altText?: string;
      frame?: ResponseHeaderImageFrame;
    })
  | (ResponseHeaderBlockBase & {
      type: 'notice'; // OO법 문구
      format: ResponseHeaderNoticeFormat;
      title: string; // 박스형 상단 검정 바 제목
      boxBody: string; // 박스형 본문
      lineBody: string; // 한줄형 본문 (모바일 밴드 모드 전환 시에도 사용)
      alignBox?: ResponseHeaderTitleAlign;
      alignLine?: ResponseHeaderTitleAlign;
      fontSize?: number | null; // 직접 지정 px(9~28), null/미설정 = 자동
    });

export type SurveyResponseHeaderConfig =
  | {
      style: 'plain';

      titleSize: ResponseHeaderTitleSize;
      titleAlign?: ResponseHeaderTitleAlign;
    }
  | {
      style: 'logo-title';
      titleSize: ResponseHeaderTitleSize;
      titleAlign?: ResponseHeaderTitleAlign;
      logo: {
        imageUrl: string;
        altText?: string;
        size: ResponseHeaderLogoSize;
      };
      logoTitle: {
        logoPosition: 'left' | 'right';
      };
    }
  | {
      style: 'official-band';
      titleSize: ResponseHeaderTitleSize;
      titleAlign?: ResponseHeaderTitleAlign;
      logo: {
        imageUrl: string;
        altText?: string;
        size: ResponseHeaderLogoSize;
      };
      officialBand: {
        arrangement: 'stat-left-logo-right' | 'logo-left-stat-right';
        logoAlign?: ResponseHeaderLogoAlign;
        statisticNotice: {
          title: string;
          body: string;
          width: ResponseHeaderNoticeWidth;
        };
      };
    }
  | {
      style: 'composed';
      mobileStyle?: ResponseHeaderMobileStyle;
      layout?: ResponseHeaderLayout;
      blocks?: ResponseHeaderBlock[];
      subtitle?: string;
      titleAlign?: ResponseHeaderTitleAlign; // 밴드 내 제목 배치
      titleTextAlign?: ResponseHeaderTitleAlign; // 제목 텍스트 정렬
      titleVAlign?: ResponseHeaderVAlign; // 세로 위치(inline 배치에서 의미)
      titleScale?: ResponseHeaderBlockSize;
      titlePx?: number | null; // 직접 지정(14~72), 지정 시 자동 축소 미적용
      vAlignLogo?: ResponseHeaderVAlign; // stacked 블록 행 이미지 세로 정렬
      vAlignNotice?: ResponseHeaderVAlign; // stacked 블록 행 문구 세로 정렬
      bandStyle?: ResponseHeaderBandStyle;
      bandBg?: string; // 모든 밴드 스타일에서 배경으로 칠함, 기본 #ffffff
    };

export interface QuestionGroupData {
  id: string;
  surveyId: string;
  name: string;
  description?: string;
  order: number;
  parentGroupId?: string;
  color?: string;
  collapsed?: boolean;
  hideName?: boolean;
  nameDesign?: GroupNameDesign;
  displayCondition?: QuestionConditionGroup;
}

// 보관함용 질문 데이터
export interface QuestionData {
  id: string;
  type: string;
  title: string;
  description?: string;
  required: boolean;
  groupId?: string;
  options?: QuestionOption[];
  selectLevels?: SelectLevel[];
  tableTitle?: string;
  tableColumns?: TableColumn[];
  tableRowsData?: TableRow[];
  tableHeaderGrid?: HeaderCell[][];
  order: number;
  allowOtherOption?: boolean;
  optionsColumns?: number;
  optionsAlign?: 'left' | 'center' | 'right';
  mobileOptionsColumns?: number | null;
  minSelections?: number;
  maxSelections?: number;
  noticeContent?: string;
  requiresAcknowledgment?: boolean;
  placeholder?: string;
  tableValidationRules?: TableValidationRule[];
  hideColumnLabels?: boolean;
  mobileOriginalTable?: boolean;
  mobileTableDisplayMode?: MobileTableDisplayMode;
  mobileDrilldownOmitLeadingColumns?: number;
  mobileDrilldownRepeatHeaderStartRow?: number | null;
  mobileDrilldownRepeatHeaderEndRow?: number | null;
  hideTitle?: boolean;
  pageBreakBefore?: boolean;
  displayCondition?: QuestionConditionGroup;
  rankingConfig?: RankingConfig;
  defaultValueTemplate?: string | null;
  inputType?: 'text' | 'number';
  emptyDefault?: number;
  piiEncrypted?: boolean;
  numberFormat?: NumberFormat | null;
  sumConstraints?: SumConstraint[] | null;
}
