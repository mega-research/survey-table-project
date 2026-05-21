import * as XLSX from 'xlsx';

import { isCellInputable } from '@/lib/analytics/excel-export-utils';
import { Survey, SurveySubmission } from '@/types/survey';
import {
  resolveRankingOptions,
  toSpssValueLabelPairs,
} from '@/utils/ranking-source';
import {
  buildTableCellVarName,
  resolveRankVarName,
} from '@/utils/table-cell-code-generator';

/**
 * Summary 워크북 생성
 */
export function generateSummaryWorkbook(
  survey: Survey,
  responses: SurveySubmission[],
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const summaryData = generateSummaryData(survey, responses);
  const ws = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, ws, 'Summary');
  return workbook;
}

/**
 * Variable Map 워크북 생성
 */
export function generateVariableMapWorkbook(survey: Survey): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const mapData = generateVariableMap(survey);
  const ws = XLSX.utils.json_to_sheet(mapData);
  ws['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 22 }, { wch: 40 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(workbook, ws, 'Variable Map');
  return workbook;
}

// ============================================================
// Internal: Summary
// ============================================================

function generateSummaryData(survey: Survey, responses: SurveySubmission[]) {
  const summary: any[] = [];
  const totalResponses = responses.length;

  [...survey.questions]
    .sort((a, b) => a.order - b.order)
    .forEach((q) => {
      if (q.type === 'notice') return;

      summary.push({
        구분: `[${q.type}] ${q.title}`,
        '응답 수': '',
        '비율(%)': '',
      });

      if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
        q.tableRowsData.forEach((row) => {
          q.tableColumns!.forEach((col, colIndex) => {
            const cell = row.cells[colIndex];
            if (!cell || !isCellInputable(cell)) return;

            const count = responses.filter((r) => {
              const ans = (r.questionResponses as any)?.[q.id];
              const val = ans && ans[cell.id];

              if (!val) return false;
              if (Array.isArray(val)) return val.length > 0;
              if (typeof val === 'string') return val.trim().length > 0;
              return true;
            }).length;

            summary.push({
              구분: `  - ${row.label} > ${col.label}`,
              '응답 수': count,
              '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
            });

            // ranking 셀(Case 3): 옵션별 가중치 총점 + 응답 수 추가
            if (cell.type === 'ranking' && cell.rankingOptions && cell.rankingOptions.length > 0) {
              const N = Math.max(1, cell.rankingConfig?.positions ?? 3);
              cell.rankingOptions.forEach((opt) => {
                let totalScore = 0;
                let optCount = 0;
                responses.forEach((r) => {
                  const ans = (r.questionResponses as any)?.[q.id];
                  const cellVal = ans && ans[cell.id];
                  if (!Array.isArray(cellVal)) return;
                  const entry = cellVal.find((a: any) => a?.optionValue === opt.value);
                  if (entry && typeof entry.rank === 'number' && entry.rank >= 1 && entry.rank <= N) {
                    totalScore += N - entry.rank + 1;
                    optCount++;
                  }
                });
                summary.push({
                  구분: `      · ${opt.label} (총점 ${totalScore})`,
                  '응답 수': optCount,
                  '비율(%)':
                    (totalResponses > 0 ? (optCount / totalResponses) * 100 : 0).toFixed(1) + '%',
                });
              });
            }
          });
        });
      } else if (q.type === 'multiselect' && q.selectLevels) {
        q.selectLevels.forEach((level) => {
          summary.push({
            구분: `  [${level.label}]`,
            '응답 수': '',
            '비율(%)': '',
          });

          level.options.forEach((opt) => {
            const count = responses.filter((r) => {
              const ans = (r.questionResponses as any)?.[q.id];
              return ans && ans[level.id] === opt.value;
            }).length;

            summary.push({
              구분: `    - ${opt.label}`,
              '응답 수': count,
              '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
            });
          });
        });
      } else if (q.type === 'ranking') {
        // Case 1/2 공통 — resolveRankingOptions 로 옵션 통합
        const resolved = resolveRankingOptions(q);
        const N = Math.max(1, q.rankingConfig?.positions ?? 3);
        resolved.forEach((opt) => {
          let totalScore = 0;
          let count = 0;
          responses.forEach((r) => {
            const ans = (r.questionResponses as any)?.[q.id];
            if (!Array.isArray(ans)) return;
            const entry = ans.find((a: any) => a?.optionValue === opt.value);
            if (entry && typeof entry.rank === 'number' && entry.rank >= 1 && entry.rank <= N) {
              totalScore += N - entry.rank + 1;
              count++;
            }
          });
          summary.push({
            구분: `  - ${opt.label} (총점 ${totalScore})`,
            '응답 수': count,
            '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
          });
        });
      } else if (q.options) {
        q.options.forEach((opt) => {
          const count = responses.filter((r) => {
            const ans = (r.questionResponses as any)?.[q.id];
            if (Array.isArray(ans)) return ans.includes(opt.value);
            return ans === opt.value;
          }).length;

          summary.push({
            구분: `  - ${opt.label}`,
            '응답 수': count,
            '비율(%)': (totalResponses > 0 ? (count / totalResponses) * 100 : 0).toFixed(1) + '%',
          });
        });
      }

      summary.push({});
    });

  return summary;
}

// ============================================================
// Internal: Variable Map
// ============================================================

function generateVariableMap(survey: Survey) {
  const mapData: Record<string, string>[] = [];

  survey.questions
    .sort((a, b) => a.order - b.order)
    .forEach((q) => {
      if (q.type === 'notice' && !q.requiresAcknowledgment) return;

      let valueLabels = '';
      if (q.type === 'notice' && q.requiresAcknowledgment) {
        valueLabels = '동의=확인함, 빈값=미확인';
      } else if ((q.type === 'radio' || q.type === 'select' || q.type === 'checkbox' || q.type === 'ranking') && q.options) {
        valueLabels = q.options
          .map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`)
          .join(', ');
      }

      mapData.push({
        '질문 ID': q.id,
        '타입': q.type,
        'SPSS 변수명': q.questionCode || '',
        '질문 제목': q.title,
        '값 라벨': valueLabels,
      });

      if (q.options && ['radio', 'select', 'checkbox'].includes(q.type)) {
        q.options.forEach((opt, i) => {
          mapData.push({
            '질문 ID': '',
            '타입': 'Option',
            'SPSS 변수명': q.type === 'checkbox' ? `${q.questionCode}_${opt.optionCode ?? String(i + 1)}` : '',
            '질문 제목': `  ${opt.spssNumericCode ?? i + 1}. ${opt.label}`,
            '값 라벨': `Value: ${opt.value}`,
          });
          // allowTextInput 옵션마다 _text 컬럼 추가
          if (opt.allowTextInput) {
            const varNumber = opt.optionCode ?? String(i + 1);
            mapData.push({
              '질문 ID': '',
              '타입': 'Option Text',
              'SPSS 변수명': `${q.questionCode}_${varNumber}_text`,
              '질문 제목': `  ${opt.label} (텍스트 입력)`,
              '값 라벨': '(텍스트)',
            });
          }
        });
      }

      if (q.type === 'ranking') {
        // Case 1/2 공통: 변수명 동일, 값 라벨은 resolveRankingOptions 로 통합.
        // 기타(sentinel) 엔트리는 numeric 변수에서 system-missing 이라 라벨에서 자동 제외됨.
        const resolved = resolveRankingOptions(q);
        const labelPairs = toSpssValueLabelPairs(resolved);
        const rankingValueLabels = labelPairs.length > 0
          ? labelPairs.map((p) => `${p.code}=${p.label}`).join(', ')
          : '(옵션 없음)';
        const N = Math.max(1, q.rankingConfig?.positions ?? 3);
        for (let k = 1; k <= N; k++) {
          mapData.push({
            '질문 ID': '',
            '타입': `Ranking (${k}순위)`,
            'SPSS 변수명': `${q.questionCode}_rk${k}`,
            '질문 제목': `  ${k}순위`,
            '값 라벨': rankingValueLabels,
          });
        }
      }

      if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
        q.tableRowsData.forEach((row) => {
          q.tableColumns!.forEach((col, colIndex) => {
            const cell = row.cells[colIndex];
            if (!cell || !isCellInputable(cell)) return;
            // 셀코드가 의도적으로 비어있으면 내보내기에서 제외 (표시용 셀)
            if (cell.isCustomCellCode === true && !cell.cellCode) return;

            // ranking 셀(Case 3): positions 만큼 _rk{k} / _rk{k}_etc 변수 행을 따로 생성
            if (cell.type === 'ranking') {
              const baseVarName = cell.cellCode
                || buildTableCellVarName(q, row, colIndex, q.tableColumns!, q.tableRowsData!);
              const opts = cell.rankingOptions ?? [];
              const rankingValueLabels = opts.length > 0
                ? opts.map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`).join(', ')
                : '';
              const positions = Math.max(1, cell.rankingConfig?.positions ?? 3);
              for (let k = 1; k <= positions; k++) {
                const rankVar = resolveRankVarName(
                  baseVarName,
                  cell.rankSuffixPattern,
                  cell.rankVarNames,
                  k,
                );
                mapData.push({
                  '질문 ID': '',
                  '타입': `Table (ranking ${k}순위)`,
                  'SPSS 변수명': rankVar,
                  '질문 제목': `  ${row.label} - ${col.label} (${k}순위)`,
                  '값 라벨': rankingValueLabels || '(순위형 옵션 없음)',
                });
              }
              return;
            }

            const varName = cell.cellCode || cell.exportLabel
              || `${q.questionCode}_${row.rowCode || row.label}_${col.columnCode || col.label}`;

            let cellValueLabels = '';
            if (cell.type === 'checkbox') {
              cellValueLabels = '1=선택, 빈값=미선택';
            } else {
              const opts = cell.radioOptions || cell.selectOptions;
              if (opts && opts.length > 0) {
                cellValueLabels = opts.map((o, i) => `${o.spssNumericCode ?? i + 1}=${o.label}`).join(', ');
              }
            }

            mapData.push({
              '질문 ID': '',
              '타입': `Table (${cell.type})`,
              'SPSS 변수명': varName,
              '질문 제목': `  ${row.label} - ${col.label}`,
              '값 라벨': cellValueLabels || `(${cell.type})`,
            });
          });
        });
      }

      if (q.type === 'multiselect' && q.selectLevels) {
        q.selectLevels.forEach((level) => {
          mapData.push({
            '질문 ID': '',
            '타입': 'Select Level',
            'SPSS 변수명': '',
            '질문 제목': `  [Level] ${level.label}`,
            '값 라벨': level.options.map((o) => o.label).join(', '),
          });
        });
      }
    });

  return mapData;
}
