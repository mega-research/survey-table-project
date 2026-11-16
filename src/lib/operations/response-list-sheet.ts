import { formatExcelDateTime } from '@/lib/analytics/raw-export-helpers';
import { formatPlatformKo } from '@/lib/operations/parse-ua';
import { answerKeyOf, entryKeyOf, formatIpHash } from '@/lib/operations/profile-columns-format';
import {
  type StepLocation,
  formatTotalTime,
  mapStatusPill,
} from '@/lib/operations/profiles-format';
import type { ProfileColumnDef } from '@/shared/contracts/operations';
import type { ProfilesRow } from '@/shared/contracts/operations-io';

/**
 * 응답 내역 목록 엑셀 — **응답 내역 화면에 보이는 열 그대로** 한 시트로 낸다(2026-11-16, 고객 계정용).
 *
 * 열은 응답 내역 컬럼 설정에서 표시 중인 것(화면의 `displayColumns`)이고 값도 화면과 같은 함수로 만든다.
 * 화면과 다른 곳은 둘뿐이다 — 「상태」 뒤에 「마지막 응답 문항」 열이 하나 더 붙고(화면은 상태 알약 안에
 * 함께 적는다), 날짜는 엑셀 글자(`YYYY-MM-DD HH:mm`, 한국 시각)다. 답 자체는 싣지 않는다 —
 * 화면이 응답값 열로 보이는 칸(기업명 등)만 나간다.
 */
export const LAST_QUESTION_HEADER = '마지막 응답 문항';

export interface ResponseListSheetInput {
  /** 표시 컬럼 스킴 — visibleProfileColumns 결과(order 순, 숨긴 열 제외). */
  columns: readonly ProfileColumnDef[];
  rows: readonly ProfilesRow[];
  /** currentStepId → 그 쪽의 대표 문항(buildStepLocationMap). */
  stepLocations: Readonly<Record<string, StepLocation>>;
  /** 조사 대상이 있는 설문인가 — 없으면 시스템ID 열을 내지 않는다(화면과 같은 규칙). */
  hasContacts: boolean;
  /** contactTargetId → 개인정보 열 key → 값. */
  piiByTarget: Readonly<Record<string, Record<string, string>>>;
  /** 응답 id → 응답값 열 key → 표시 글자. */
  answerValues: Readonly<Record<string, Record<string, string>>>;
}

type Cell = string | number;
interface SheetColumn {
  header: string;
  value: (row: ProfilesRow) => Cell;
}

/** 진행 중·이탈 응답이 멈춘 쪽의 대표 문항 번호 — 그 밖의 상태는 빈칸(화면 알약과 같은 범위). */
function lastQuestionOf(
  row: ProfilesRow,
  stepLocations: Readonly<Record<string, StepLocation>>,
): string {
  if (row.status !== 'in_progress' && row.status !== 'drop') return '';
  return (row.currentStepId ? stepLocations[row.currentStepId]?.qNumber : null) ?? '';
}

function columnsOf(input: ResponseListSheetInput): SheetColumn[] {
  const { stepLocations, hasContacts, piiByTarget, answerValues } = input;
  return input.columns.flatMap<SheetColumn>((c) => {
    if (c.key.startsWith('attrs.')) {
      const attrKey = c.key.slice('attrs.'.length);
      return [{ header: c.label, value: (r) => r.attrs?.[attrKey] ?? '' }];
    }
    const entryName = entryKeyOf(c.key);
    if (entryName !== null) {
      return [{ header: c.label, value: (r) => r.entryParams?.[entryName] ?? '' }];
    }
    if (answerKeyOf(c.key) !== null) {
      return [{ header: c.label, value: (r) => answerValues[r.id]?.[c.key] ?? '' }];
    }
    if (c.key.startsWith('pii.')) {
      const piiKey = c.key.slice('pii.'.length);
      return [
        {
          header: c.label,
          value: (r) => (r.contactTargetId ? piiByTarget[r.contactTargetId]?.[piiKey] : '') ?? '',
        },
      ];
    }
    switch (c.key) {
      case 'sys.idx':
        // row_number 는 드라이버가 글자로 돌려준다 — 엑셀에서 숫자로 정렬되게 숫자로 싣는다
        return [{ header: c.label, value: (r) => Number(r.idx) }];
      case 'sys.resid':
        return hasContacts ? [{ header: c.label, value: (r) => r.resid ?? '' }] : [];
      case 'sys.group':
        return [{ header: c.label, value: (r) => r.groupValue ?? '공개링크' }];
      case 'sys.platform':
        return [{ header: c.label, value: (r) => formatPlatformKo(r.platform) }];
      case 'sys.browser':
        return [{ header: c.label, value: (r) => r.browser ?? 'Other' }];
      case 'sys.status':
        return [
          { header: c.label, value: (r) => mapStatusPill({ status: r.status }).label },
          { header: LAST_QUESTION_HEADER, value: (r) => lastQuestionOf(r, stepLocations) },
        ];
      case 'sys.startedAt':
        return [{ header: c.label, value: (r) => formatExcelDateTime(r.startedAt) }];
      case 'sys.completedAt':
        return [
          {
            header: c.label,
            value: (r) =>
              r.status === 'in_progress' ? '진행 중' : formatExcelDateTime(r.completedAt),
          },
        ];
      case 'sys.totalSeconds':
        return [{ header: c.label, value: (r) => formatTotalTime(r.totalSeconds, r.status) }];
      case 'sys.ipHash':
        return [{ header: c.label, value: (r) => formatIpHash(r.ipHash) }];
      default:
        // 알 수 없는 키(스킴 버전 차이 등) — 화면처럼 건너뛴다
        return [];
    }
  });
}

/** 머리 한 줄과 값 줄들 — 시트에 그대로 얹는다. */
export function buildResponseListTable(input: ResponseListSheetInput): {
  headers: string[];
  rows: Cell[][];
} {
  const columns = columnsOf(input);
  return {
    headers: columns.map((c) => c.header),
    rows: input.rows.map((row) => columns.map((c) => c.value(row))),
  };
}
