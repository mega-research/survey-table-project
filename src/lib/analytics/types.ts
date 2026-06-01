import type { QuestionType } from '@/types/survey';

// ========================
// 질문 유형별 분석 결과 타입
// ========================

export type AnalyticsResult =
  | SingleChoiceAnalytics
  | MultipleChoiceAnalytics
  | TextAnalytics
  | TableAnalytics
  | MultiSelectAnalytics
  | NoticeAnalytics
  | RankingAnalytics;

// 단일 선택 (radio, select)
export interface SingleChoiceAnalytics {
  type: 'single';
  questionId: string;
  questionTitle: string;
  questionType: QuestionType;
  totalResponses: number;
  responseRate: number;
  distribution: OptionDistribution[];
}

// 다중 선택 (checkbox)
export interface MultipleChoiceAnalytics {
  type: 'multiple';
  questionId: string;
  questionTitle: string;
  questionType: QuestionType;
  totalResponses: number;
  responseRate: number;
  avgSelectionsPerResponse: number;
  distribution: OptionDistribution[];
}

// 숫자 단답형 통계 (빈값 제외, 실제 0 포함)
export interface NumericStats {
  count: number; // 유효 숫자 응답 수
  sum: number;
  mean: number;
  min: number;
  max: number;
  median: number;
}

// 텍스트 (text, textarea)
export interface TextAnalytics {
  type: 'text';
  questionId: string;
  questionTitle: string;
  questionType: QuestionType;
  totalResponses: number;
  responseRate: number;
  avgLength: number;
  responses: {
    id: string;
    value: string;
    submittedAt?: Date;
  }[];
  wordFrequency?: {
    word: string;
    count: number;
  }[];
  // inputType==='number' 인 단답형에만 존재
  numericStats?: NumericStats;
}

// 테이블
export interface TableAnalytics {
  type: 'table';
  questionId: string;
  questionTitle: string;
  questionType: QuestionType;
  totalResponses: number;
  responseRate: number;
  // 셀별 분석
  cellAnalytics: CellAnalyticsRow[];
  // 행별 요약 (서비스별 이용률 등)
  rowSummary: RowSummary[];
}

// 다단계 선택 (multiselect)
export interface MultiSelectAnalytics {
  type: 'multiselect';
  questionId: string;
  questionTitle: string;
  questionType: QuestionType;
  totalResponses: number;
  responseRate: number;
  levelAnalytics: {
    levelId: string;
    levelLabel: string;
    distribution: OptionDistribution[];
  }[];
}

// 순위형 (ranking)
export interface RankingAnalytics {
  type: 'ranking';
  questionId: string;
  questionTitle: string;
  questionType: QuestionType;
  totalResponses: number;
  responseRate: number;
  positions: number; // rankingConfig.positions
  maxPossibleScore: number; // positions × 응답자 수 (모두 1위 선택한 가상의 상한)
  // 옵션별 가중치 점수 + 순위별 선택 횟수
  distribution: RankingOptionDistribution[];
}

export interface RankingOptionDistribution {
  value: string; // optionValue 또는 '__other__:<text>' 같은 기타 키
  label: string;
  totalScore: number; // 가중치 합산 (k순위 = positions - k + 1 점)
  avgRank?: number; // 평균 순위 (선택된 응답 기준)
  rankCounts: number[]; // 인덱스 i = (i+1)순위 선택 횟수
}

// 공지사항
export interface NoticeAnalytics {
  type: 'notice';
  questionId: string;
  questionTitle: string;
  questionType: QuestionType;
  totalResponses: number;
  responseRate: number;
  acknowledgedCount: number;
  acknowledgeRate: number;
}

// ========================
// 공통 타입
// ========================

export interface OptionDistribution {
  label: string;
  value: string;
  count: number;
  percentage: number;
}

export interface CellAnalyticsRow {
  rowId: string;
  rowLabel: string;
  cells: CellAnalytics[];
}

export interface CellAnalytics {
  cellId: string;
  columnLabel: string;
  cellType:
    | 'checkbox'
    | 'radio'
    | 'select'
    | 'input'
    | 'text'
    | 'image'
    | 'video'
    | 'ranking'
    | 'merged-horizontal'
    | 'merged-vertical'
    | 'merged-hidden';
  // 체크박스
  checkedCount?: number;
  checkedRate?: number;
  // 라디오/셀렉트
  optionDistribution?: OptionDistribution[];
  // 라디오/셀렉트 상세 value 분포 (analyzeTable 에서 사용하는 필드)
  valueCounts?: Record<string, number>;
  // 입력
  textResponses?: string[];
  // 순위형 셀 (Case 3)
  rankingPositions?: number;
  rankingDistribution?: RankingOptionDistribution[];
  rankingMaxPossibleScore?: number;
}

export interface RowSummary {
  rowId: string;
  rowLabel: string;
  totalInteractions: number;
  interactionRate: number;
  // 추가 상세 분석 (OTT 같은 경우 유료/무료 등)
  details?: Record<string, number>;
}

// ========================
// 전체 설문 분석 결과
// ========================

export interface SurveyAnalytics {
  surveyId: string;
  surveyTitle: string;
  summary: SurveySummary;
  timeline: TimelineData[];
  questions: AnalyticsResult[];
}

export interface SurveySummary {
  totalResponses: number;
  completedResponses: number;
  completionRate: number;
  avgCompletionTime: number; // 분
  lastResponseAt?: Date;
  // 오늘 통계
  todayResponses: number;
  // 이번 주 통계
  weekResponses: number;
}

export interface TimelineData {
  date: string;
  responses: number;
  completed: number;
}

// ========================
// 차트 데이터 포맷 (Tremor용)
// ========================

export interface ChartDataItem {
  name: string;
  value: number;
  [key: string]: string | number;
}

export interface BarChartDataItem {
  name: string;
  [category: string]: string | number;
}

// ========================
// 내보내기 타입
// ========================

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export interface ExportOptions {
  format: ExportFormat;
  includeMetadata: boolean;
  questionIds?: string[];
}
