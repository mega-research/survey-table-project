import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import {
  buildStepLocationMap,
  parseQuestionNumberFromTitle,
  type StepGroupInput,
  type StepQuestionInput,
} from '@/lib/operations/profiles-format';
import type { Question, QuestionOption } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { resolveRankingOptions, toSpssValueLabelPairs } from '@/utils/ranking-source';

/** Date → KST "YYYY-MM-DD HH:mm" 문자열. null/undefined → '' */
export function formatExcelDateTime(value: Date | null | undefined): string {
  if (!value) return '';
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function pairsFromOptions(options: QuestionOption[]): string {
  return options
    .map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`)
    .join(', ');
}

/**
 * 코딩북 "값 라벨" 셀 문자열을 컬럼 종류별로 생성한다 (spssNumericCode 기반).
 * 값 라벨이 의미 없는 텍스트/날짜류는 빈 문자열.
 */
export function buildCodebookValueLabel(
  col: SPSSExportColumn,
  questionMap: Map<string, Question>,
): string {
  const q = questionMap.get(col.questionId);

  switch (col.type) {
    case 'notice-agree':
      return '동의=확인, 빈값=미확인';

    case 'checkbox-item':
    case 'table-cell': {
      if (col.type === 'checkbox-item') {
        const opts = q ? resolveChoiceOptions(q) : [];
        const code =
          col.optionIndex != null
            ? (opts[col.optionIndex]?.spssNumericCode ?? col.optionIndex + 1)
            : 1;
        return `빈값=비선택, ${code}=선택`;
      }
      if (col.tableCellType === 'checkbox') {
        const code =
          col.optionIndex != null
            ? (col.cellOptions?.[col.optionIndex]?.spssNumericCode ?? col.optionIndex + 1)
            : 1;
        return `빈값=비선택, ${code}=선택`;
      }
      if (col.cellOptions && col.cellOptions.length > 0) return pairsFromOptions(col.cellOptions);
      return '';
    }

    case 'single': {
      const opts = q ? resolveChoiceOptions(q) : [];
      return opts.length > 0 ? pairsFromOptions(opts) : '';
    }

    case 'radio-group':
      if (col.radioGroupValueLabels) {
        return Object.entries(col.radioGroupValueLabels)
          .map(([code, label]) => `${code}=${label}`)
          .join(', ');
      }
      return '';

    case 'choice-group':
      if (col.choiceGroupValueLabels && col.choiceGroupValueLabels.length > 0) {
        return col.choiceGroupValueLabels
          .map(({ value, label }) => `${value}=${label}`)
          .join(', ');
      }
      return '';

    case 'choice-group-item': {
      // checkbox-item 형식 재사용: 빈값=비선택, {code}=선택
      const code = col.choiceGroupMemberCode;
      if (code == null) return '';
      return `빈값=비선택, ${code}=선택`;
    }

    case 'ranking-rank':
    case 'table-cell-ranking': {
      const opts = col.cellOptions ?? (q ? resolveRankingOptions(q) : []);
      const pairs = toSpssValueLabelPairs(opts);
      return pairs.length > 0 ? pairs.map((p) => `${p.code}=${p.label}`).join(', ') : '';
    }

    default:
      // text, textarea, multiselect, other-text, option-text, notice-date, *-other
      return '';
  }
}

/**
 * currentStepId → 엑셀 "마지막 입력 문항" 표시 라벨 맵.
 * 페이지 대표 질문 환산은 운영 콘솔의 buildStepLocationMap 을 재사용하되, 라벨은
 * 엑셀 변수명·코딩북과 동일 기준인 질문코드(questionCode, 예: Q13)를 우선한다.
 * 질문코드가 없으면 제목의 Qx 파싱 폴백, 둘 다 없으면 공백 — 위치 표기("{n}번째")는 쓰지 않는다.
 */
export function buildStepLabelMap(
  questions: StepQuestionInput[],
  groups: StepGroupInput[],
): Map<string, string> {
  // 질문코드 우선/제목 Qx 폴백은 buildStepLocationMap 의 qNumber 가 이미 처리한다 (운영 콘솔과 공유).
  const labels = new Map<string, string>();
  for (const [stepId, loc] of buildStepLocationMap(questions, groups)) {
    labels.set(stepId, loc.qNumber ?? '');
  }
  return labels;
}

/**
 * 질문 id → { order, 표시 라벨(질문코드 우선, 제목 Qx 폴백) } 맵.
 * currentStepId 가 없는 구응답의 "마지막 입력 문항" 폴백(응답값 존재 질문 중 최후순)에 쓴다.
 */
export function buildQuestionMetaMap(
  questions: Array<{ id: string; order: number; title: string; questionCode?: string | null }>,
): Map<string, { order: number; label: string }> {
  return new Map(
    questions.map((q) => [
      q.id,
      { order: q.order, label: q.questionCode || parseQuestionNumberFromTitle(q.title) || '' },
    ]),
  );
}
