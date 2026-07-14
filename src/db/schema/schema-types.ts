// JSONB 컬럼에 사용되는 내부 타입 정의
// 테이블 정의의 $type<>() 제네릭에서 참조됨

/**
 * response_edit_logs.changed_questions 항목.
 * 바뀐 질문의 버전 스냅샷 기준 식별 정보. 기록 시점에 스냅샷 저장돼
 * 이후 빌더에서 질문 제목이 바뀌어도 당시 값이 보존된다.
 */
export interface ResponseEditChange {
  questionId: string;
  /** SPSS 변수명/문항코드. 스냅샷에 없으면 null. */
  code: string | null;
  /** 문항 제목. 스냅샷에 없으면 questionId 로 폴백. */
  title: string;
}

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
  | 'left'
  | 'center'
  | 'right'
  | 'title-left'
  | 'title-right'
  | 'above'
  | 'below';
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

// 설문 질문 관련 공용 타입은 @/types/survey 가 단일 출처(SoT).
// 과거에는 schema-types 가 좁은 사본을 별도 선언해 $inferSelect 행에서
// optionCode·spssNumericCode·exportLabel·cellCode·rankSuffixPattern 등 필드가
// 누락되고, 읽기 경로마다 `as NonNullable<QuestionType[...]>` 캐스팅으로
// 복구해야 했다. 이제 survey.ts 정의를 그대로 가져와 re-export 해 두 곳의
// 수동 동기화를 제거한다 (런타임 영향 없음 — 모두 type-only import).
// import 으로 로컬 스코프에 두어 아래 QuestionData/SurveyVersionSnapshot 등이
// 참조할 수 있게 하고, 동시에 동일 이름을 re-export 한다.
import type {
  BranchRule,
  CheckboxOption,
  DynamicRowGroupConfig,
  ExpressionClause,
  ExpressionComparison,
  ExpressionConditionConfig,
  ExpressionOperand,
  HeaderCell,
  QuestionCondition,
  QuestionConditionGroup,
  QuestionOption,
  RadioOption,
  RankingConfig,
  SelectLevel,
  TableCell,
  TableColumn,
  TableRow,
  TableValidationRule,
} from '@/types/survey';

export type {
  BranchRule,
  CheckboxOption,
  DynamicRowGroupConfig,
  ExpressionClause,
  ExpressionComparison,
  ExpressionConditionConfig,
  ExpressionOperand,
  HeaderCell,
  QuestionCondition,
  QuestionConditionGroup,
  QuestionOption,
  RadioOption,
  RankingConfig,
  SelectLevel,
  TableCell,
  TableColumn,
  TableRow,
  TableValidationRule,
};

// 운영 현황 콘솔 — 응답 페이지 방문 기록
export interface PageVisit {
  stepId: string;
  enteredAt: string;
  leftAt?: string;
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
  minSelections?: number;
  maxSelections?: number;
  noticeContent?: string;
  requiresAcknowledgment?: boolean;
  placeholder?: string;
  tableValidationRules?: TableValidationRule[];
  hideColumnLabels?: boolean;
  hideTitle?: boolean;
  pageBreakBefore?: boolean;
  displayCondition?: QuestionConditionGroup;
  rankingConfig?: RankingConfig;
  defaultValueTemplate?: string | null;
  inputType?: 'text' | 'number';
  emptyDefault?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 (contact_targets·contact_uploads) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/** surveys.contact_columns — 컨택리스트 표시 컬럼 스킴 (메타데이터) */
export interface ContactColumnScheme {
  version: number;
  /** 엑셀 헤더 행 (1-based, 디폴트 1) */
  headerRow: number;
  columns: ContactColumnDef[];
}

export interface ContactColumnDef {
  /** attrs 의 키 또는 system 식별자 */
  key: string;
  /** 표 헤더 라벨 (사용자 편집 가능) */
  label: string;
  source:
  | `attrs.${string}`
  | 'system.resid'
  | 'system.contact_result'
  | 'system.email_count'
  | 'system.web'
  | 'system.contact_owner'
  | `pii.${string}`;
  order: number;
  /** 숨김 (운영 컬럼 일부는 hide 불가 — UI 가드) */
  hidden?: boolean;
  /**
   * PII 매핑 타입. 지정되면 해당 엑셀 컬럼 값이 contact_pii 사이드 테이블에
   * 암호화 저장되고, attrs 에는 저장되지 않는다. 사후 변경 불가 — 재업로드 필요.
   */
  piiType?: import('@/lib/crypto/pii-fields').PiiFieldType;
}

/** surveys.progress_columns — 진척률 표 (Report 탭) 그룹 메타 컬럼 픽커 */
export interface ProgressColumnScheme {
  version: number;
  columns: ProgressColumnDef[];
}

export interface ProgressColumnDef {
  /** attrs 키 (예: '개최 월', '개최기간'). source 는 항상 attrs.<key> — system.* 제외. */
  key: string;
  /** 표 헤더 라벨 (사용자 편집 가능). 컨택리스트 라벨과 별도. */
  label: string;
  order: number;
  hidden?: boolean;
}

/** contact_uploads.mapping — 엑셀 업로드 매핑 결과 (시나리오 B 단순화) */
export interface ContactUploadMapping {
  /** 시스템 필드 → 엑셀 0-based 컬럼 인덱스. group 만 사용 (미지정 시 단일 명단 취급). */
  systemFields: {
    group?: number;
  };
  /**
   * 엑셀 헤더 → PII 타입 매핑. 키는 엑셀 헤더(원본 컬럼명), 값은 PII 타입.
   * 매핑된 컬럼은 contact_pii 사이드 테이블에 암호화 저장, attrs 에는 저장 안 함.
   */
  piiMapping?: Record<string, import('@/lib/crypto/pii-fields').PiiFieldType>;
  /** 사용자가 컨택리스트에 표시하기로 토글한 attrs 키 (헤더명) 목록. 나머지는 hidden 으로 자동 등록. */
  selectedAttrsKeys: string[];
  /** 사용자가 편집한 표시 라벨 (헤더명 → 라벨). 미지정 헤더는 헤더명 그대로. */
  labelOverrides?: Record<string, string>;
  /** 1-based, 디폴트 1 */
  headerRow: number;
  /** 사용자가 선택한 시트 이름 (디폴트 첫 시트) */
  sheetName: string;
  /**
   * @deprecated 시나리오 B 에서 머지 제거 — backward compat 용 optional.
   * 본 슬라이스 후속에서는 무시됨.
   */
  mergeKey?: 'email+biz' | 'email' | 'biz';
  /**
   * @deprecated 시나리오 B 에서 머지 제거 — backward compat 용 optional.
   */
  mergeKeyPolicy?: 'either' | 'both';
}

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 단건 편집 (slice 3 detail page) 타입
// ─────────────────────────────────────────────────────────────────────────────

export type ContactMethod = 'email' | 'sms' | 'visit' | 'mail';

export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  email: '이메일',
  sms: '문자',
  visit: '방문',
  mail: '우편',
};

/** 결과코드 상태 — 응답률·모집단 처리 분류. */
export type ResultCodeStatus = 'positive' | 'negative' | 'neutral';

/** 결과코드 1개 정의 — surveys.contact_result_codes JSONB 안의 항목 */
export interface ContactResultCode {
  /** UI 표시 코드 (예: '1.조사완료'). 사용자 자유 텍스트. */
  code: string;
  /** UI 라벨 (코드와 동일하게 두는 게 일반적) */
  label: string;
  /** 정렬 순서 */
  order: number;
  /**
   * pill 색상 톤. mockup 의 컨택결과 이력 표 색상 매칭용.
   */
  tone?: 'green' | 'amber' | 'rose' | 'blue' | 'slate';
  /**
   * 응답률·모집단 처리.
   * - 'positive': 응답 완료로 인정 (응답률 분자)
   * - 'neutral': 응답률 분모에만 포함
   * - 'negative': 모집단 완전 제외 — 응답률·단체메일·응답 페이지 모두 제거
   *
   * 누락 (undefined) 시 fallback:
   * - code === '1.조사완료' → 'positive' (backward compat)
   * - 그 외 → 'neutral'
   * 사용자가 빌더에서 한 번 저장하면 명시 status 박힘 → fallback 우회.
   */
  status?: ResultCodeStatus;
}

/**
 * surveys.contact_result_codes 가 NULL 일 때 사용되는 디폴트 13개.
 * mockup §6 의 결과코드 라디오 그대로.
 *
 * status 매핑:
 * - '1.조사완료' → 'positive' (응답 완료 인정)
 * - '수신거부' → 'negative' (모집단 제외)
 * - 나머지 11개 → 필드 생략 (= 'neutral')
 */
export const DEFAULT_RESULT_CODES: ContactResultCode[] = [
  { code: '1.조사완료', label: '1.조사완료', order: 1, tone: 'green', status: 'positive' },
  { code: '2.재통화예약', label: '2.재통화예약', order: 2, tone: 'blue' },
  { code: '3.비수신', label: '3.비수신', order: 3, tone: 'slate' },
  { code: '4.부재', label: '4.부재', order: 4, tone: 'slate' },
  { code: '5.출장', label: '5.출장', order: 5, tone: 'slate' },
  { code: '6.거절', label: '6.거절', order: 6, tone: 'rose' },
  { code: '7.결번·번호오류', label: '7.결번·번호오류', order: 7, tone: 'rose' },
  { code: '8.중복', label: '8.중복', order: 8, tone: 'slate' },
  { code: '9.전시회미참가', label: '9.전시회미참가', order: 9, tone: 'slate' },
  { code: '10.메일발송', label: '10.메일발송', order: 10, tone: 'blue' },
  { code: '11.기타', label: '11.기타', order: 11, tone: 'amber' },
  { code: '12.담당자퇴사', label: '12.담당자퇴사', order: 12, tone: 'rose' },
  { code: '수신거부', label: '수신거부', order: 13, tone: 'rose', status: 'negative' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 메일 (mail_templates) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/** mail_templates.attachments 의 각 원소 */
export interface MailAttachment {
  /** R2 object key — 예: mail/<surveyId>/<uuid>.pdf */
  key: string;
  filename: string;
  size: number;   // bytes
  mime: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메일 단체 메일 (mail_campaigns) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mail_campaigns.filter_snapshot — 마법사 ②단계 필터 조건 보존.
 * 단체 메일 사후 "이 단체 메일 미응답자 재발송" 동선에서 prefill 용으로 활용.
 */
export interface CampaignFilterSnapshot {
  /** 다중 절 필터 (조사대상목록과 동일 직렬화). blindIndex 미포함 raw — 요청 시 재계산. */
  clauses?: { source: string; value: string; op: 'AND' | 'OR' | null }[];
  /** 미응답자만 (responded_at IS NULL) — 별도 체크박스로 유지 */
  unrespondedOnly?: boolean;
  /** "발송 후 N일 경과 단체 메일의 미오픈자 재발송" 동선 (?from=<cid>&unopenedAfterDays=7) */
  unopenedFromCampaignId?: string;
  unopenedAfterDays?: number;
  /** @deprecated legacy 단순 검색 필드 — 신규 생성엔 미사용, 기존 저장 캠페인 읽기 호환용. */
  qfield?: 'all' | 'resid' | 'email' | 'group' | 'biz';
  /** @deprecated legacy 검색어 */
  q?: string;
  /** @deprecated legacy 결과코드 필터 */
  resultCodes?: string[];
  /** @deprecated legacy 그룹값 필터 */
  groupValues?: string[];
}

// ── 쿼터 (surveys.quota_config) ──────────────────────────────
/** 한 차원 안의 구간. kind='choice'면 values, kind='numeric'이면 min/max 사용. */
export interface QuotaCategory {
  id: string;
  label: string;
  /**
   * choice: 이 카테고리에 속하는 보기값(수동=option.value, 테이블소스=cell.id)
   * `| undefined` 명시: zod `.optional()` 추론 타입과 exactOptionalPropertyTypes 하에서
   * 정합하려면 필요(features/quota/domain 의 컴파일 타임 zod↔drizzle 가드 참조).
   */
  values?: string[] | undefined;
  /** numeric: 반열림 구간 min ≤ 값 < max (null = 무한) */
  min?: number | null | undefined;
  max?: number | null | undefined;
}

/** 쿼터 축. 문항 1개에 바인딩. */
export interface QuotaDimension {
  id: string;
  questionId: string;
  label: string;
  kind: 'choice' | 'numeric';
  categories: QuotaCategory[];
}

/** 셀 = 차원 카테고리 조합 + 목표. categoryIds는 dimensions 순서대로. */
export interface QuotaCell {
  categoryIds: string[];
  target: number;
}

/** surveys.quota_config — 설문 쿼터 플랜 전체 (NULL = 쿼터 없음) */
export interface QuotaConfig {
  /** 집행 on/off. false면 정의·집계만 하고 응답자 차단 안 함. */
  enabled: boolean;
  dimensions: QuotaDimension[];
  /** sparse — 목표가 있는 셀만 */
  cells: QuotaCell[];
  /** 마감 종료 화면 문구. null이면 기본 폴백. */
  closedMessage: string | null;
}
