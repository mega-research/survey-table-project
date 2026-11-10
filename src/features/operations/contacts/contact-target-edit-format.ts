// 「대상 정보 수정 현황」 문구 — 기록 한 줄의 요약과 펼친 줄. 상세 화면 카드와 읽기 로더가 함께 쓴다.
// 기록 모양(ContactTargetEditChange)은 shared/contracts/contacts 가 정본이다.
import {
  CONTACT_METHOD_LABEL,
  type ContactMethod,
  type ContactTargetEditAssignee,
  type ContactTargetEditChange,
  type ContactTargetEditPiiOp,
} from '@/shared/contracts/contacts';

/** 빈 값(null·빈 문자열)의 화면 글자. */
export const CONTACT_TARGET_EDIT_EMPTY = '(빈 값)';
/** 기록할 때 1,000자에서 잘린 값 뒤에 붙는 표식. */
export const CONTACT_TARGET_EDIT_TRUNCATED_MARK = '…(이하 생략)';
/** 요약 줄에서 값 하나를 줄이는 글자 수. 펼친 줄은 저장된 만큼 다 보인다. */
const SUMMARY_VALUE_MAX = 30;

const PII_OP_LABEL: Record<ContactTargetEditPiiOp, string> = {
  set: '입력',
  changed: '변경',
  cleared: '삭제',
};

/** 값 하나의 화면 글자. maxChars 를 주면 그 글자 수(코드 포인트)에서 줄이고 「…」. */
function shown(value: string | null, truncated: boolean | undefined, maxChars?: number): string {
  const v = value ?? '';
  if (v === '') return CONTACT_TARGET_EDIT_EMPTY;
  if (maxChars !== undefined) {
    const chars = Array.from(v);
    if (chars.length > maxChars) return `${chars.slice(0, maxChars).join('')}…`;
  }
  return truncated ? `${v}${CONTACT_TARGET_EDIT_TRUNCATED_MARK}` : v;
}

function methodLabel(code: string): string {
  if (code === '') return CONTACT_TARGET_EDIT_EMPTY;
  return CONTACT_METHOD_LABEL[code as ContactMethod] ?? code;
}

function assigneeLabel(a: ContactTargetEditAssignee | null): string {
  return a ? a.name : '배정 없음';
}

function format(change: ContactTargetEditChange, maxChars?: number): string {
  switch (change.kind) {
    case 'attr':
      return `${change.label} ${shown(change.before, change.beforeTruncated, maxChars)} → ${shown(change.after, change.afterTruncated, maxChars)}`;
    case 'pii':
      return `${change.label} ${PII_OP_LABEL[change.op]}`;
    case 'memo':
      return `메모 ${shown(change.before, change.beforeTruncated, maxChars)} → ${shown(change.after, change.afterTruncated, maxChars)}`;
    case 'contactMethod':
      return `컨택 방법 ${methodLabel(change.before)} → ${methodLabel(change.after)}`;
    case 'assignment':
      return `컨택원 ${assigneeLabel(change.before)} → ${assigneeLabel(change.after)}`;
    case 'attempt': {
      const { attemptNo, before, after, beforeTruncated, afterTruncated } = change;
      if (after === null) {
        const note = before.note ?? '';
        const detail =
          note === ''
            ? before.resultCode
            : `${before.resultCode} · ${shown(note, beforeTruncated, maxChars)}`;
        return `${attemptNo}회차 삭제 (${detail})`;
      }
      const parts: string[] = [];
      if (before.resultCode !== after.resultCode) {
        parts.push(`결과 ${before.resultCode} → ${after.resultCode}`);
      }
      // 결과가 그대로인데 기록이 있으면 바뀐 것은 비고다 — 1,000자에서 잘린 앞부분이 같아 보여도.
      if ((before.note ?? '') !== (after.note ?? '') || parts.length === 0) {
        parts.push(
          `비고 ${shown(before.note, beforeTruncated, maxChars)} → ${shown(after.note, afterTruncated, maxChars)}`,
        );
      }
      return `${attemptNo}회차 ${parts.join(', ')}`;
    }
  }
}

/** 펼친 줄 — 변경 하나당 한 줄, 값은 저장된 만큼 전부. */
export function describeContactTargetEditChange(change: ContactTargetEditChange): string {
  return format(change);
}

/**
 * 기록 한 줄의 요약 — 첫 변경 + 「외 N개」. 값은 짧게 줄인다.
 * 예: 「사업자등록증기업명 - → 아리오나트 외 2개」. 변경이 없으면 빈 글자.
 */
export function summarizeContactTargetEdit(changes: ContactTargetEditChange[]): string {
  const [first] = changes;
  if (!first) return '';
  const head = format(first, SUMMARY_VALUE_MAX);
  return changes.length > 1 ? `${head} 외 ${changes.length - 1}개` : head;
}
