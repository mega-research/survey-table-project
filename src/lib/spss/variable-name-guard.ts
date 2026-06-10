import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { validateSpssVarName } from '@/lib/spss/variable-validator';

/** export를 막은 변수명 문제 1건 */
export interface VarNameIssue {
  varName: string;
  questionText: string;
  reason: string;
}

/** 변수명 검증 실패. route에서 400으로 변환해 문제 목록을 노출한다. */
export class SpssVarNameError extends Error {
  readonly issues: VarNameIssue[];

  constructor(issues: VarNameIssue[]) {
    const head = issues
      .slice(0, 5)
      .map((i) => `${i.varName}: ${i.reason}`)
      .join(' / ');
    const rest = issues.length > 5 ? ` 외 ${issues.length - 5}건` : '';
    super(`SPSS 변수명 오류 ${issues.length}건 - ${head}${rest}`);
    this.name = 'SpssVarNameError';
    this.issues = issues;
  }
}

/**
 * .sav 생성 전 전체 변수명을 검증한다. 침묵 치환 대신 명시적 에러.
 * - SPSS 규격 위반(validateSpssVarName: 영문 시작, 영문/숫자/밑줄, 64자, 예약어)
 * - 대소문자 무시 중복
 * 가드를 통과한 이름은 sanitizeSpssVarName이 no-op임이 보장된다(영문 시작·허용
 * 문자만·연속/후행 밑줄 금지 — validateSpssVarName이 sanitize가 변형하는 모든
 * 패턴을 거부). 따라서 변수 정의와 레코드 키가 항상 일치 — 컬럼 무징후
 * 전손(C1)이 구조적으로 불가능. validateSpssVarName 규칙을 완화할 때는
 * 이 불변식이 깨지지 않는지 반드시 확인할 것.
 */
export function assertValidSpssVarNames(columns: SPSSExportColumn[]): void {
  const issues: VarNameIssue[] = [];
  const seen = new Map<string, string>(); // upper -> 최초 varName

  for (const col of columns) {
    const { valid, errors } = validateSpssVarName(col.spssVarName);
    if (!valid) {
      issues.push({
        varName: col.spssVarName,
        questionText: col.questionText,
        reason: errors.map((e) => e.message).join(', '),
      });
      continue;
    }
    const upper = col.spssVarName.toUpperCase();
    const first = seen.get(upper);
    if (first) {
      issues.push({
        varName: col.spssVarName,
        questionText: col.questionText,
        reason: `변수명이 '${first}'와 중복됩니다.`,
      });
    } else {
      seen.set(upper, col.spssVarName);
    }
  }

  if (issues.length > 0) throw new SpssVarNameError(issues);
}
