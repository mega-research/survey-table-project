import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
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
