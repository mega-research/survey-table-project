import type { ReactNode } from 'react';

import { Info } from 'lucide-react';

import type { ScaleSliderIssue } from '@/features/survey-builder/lib/scale-slider-diagnostics';

import { ScaleBarIssueAlert } from './scale-bar-issue-alert';

/**
 * 척도 슬라이더의 빌더 안내 조각 — 폴백 경고와 막지 않는 안내 줄(CONTEXT.md 「척도 슬라이더」).
 *
 * ── 배선과 규칙 ──
 * - **경고 상자는 척도 막대의 것 그대로다**(`ScaleBarIssueAlert`). 여기는 슬라이더의 글자만 정한다 — 묶음
 *   편집(보기 칸 편집)과 문항 설정 두 자리가 같은 글자를 쓰도록 한 곳에 둔다.
 * - 무엇을 보일지는 진단(scale-slider-diagnostics)이 정한다. 이 조각은 판정하지 않는다.
 * - **경고는 「켰는데 그려지지 않는 것」에만 쓴다.** 그려지긴 하는데 알아 둘 것(행 단위 배치로 바뀜 · 휴대폰의
 *   좁은 타일 · 답이 문항에 하나)은 안내 줄이다 — 막는 일이 아니라 낭독기에 끼어들지 않는다.
 * - 문구에 이모지를 쓰지 않는다.
 */

/** 못 그리는 행이 응답 화면에서 어떻게 보이는지 — 표는 그 행의 그룹 열을 원본 표 조각으로 그린다 */
const TABLE_FALLBACK_TITLE =
  '척도 슬라이더로 그릴 수 없는 행이 있어 그 행은 원본 표 조각으로 보입니다.';
const TABLE_NO_TARGET_TITLE = '척도 슬라이더로 그릴 보기 칸이 없습니다.';
/** 표 배치 판정이 「지금과 같다」를 내는 경우 — 슬라이더로 그려지는 행이 표에 하나도 없다 */
const TABLE_DRAWS_NOTHING = '슬라이더로 그릴 수 있는 행이 없어 이 표의 화면은 바뀌지 않습니다.';
/** 보통 라디오 문항은 통째로 그리거나 통째로 못 그린다 */
const RADIO_OPTIONS_FALLBACK_TITLE =
  '척도 슬라이더로 그릴 수 없어 화면이 바뀌지 않습니다. 지금 보기 목록 그대로 보입니다.';

interface ScaleSliderIssueAlertProps {
  /** 표(보기 그룹 · 그룹 없는 설명 테이블)인가, 보통 라디오 문항의 보기 목록인가 */
  kind: 'table' | 'radio-options';
  issues: readonly ScaleSliderIssue[];
  /** 슬라이더로 그릴 수 있는 것이 없다 — 화면이 바뀌지 않는다 */
  drawsNothing: boolean;
}

/** 척도 슬라이더 폴백 경고 — 문제가 없으면 아무것도 그리지 않는다 */
export function ScaleSliderIssueAlert({ kind, issues, drawsNothing }: ScaleSliderIssueAlertProps) {
  if (kind === 'radio-options') {
    return <ScaleBarIssueAlert title={RADIO_OPTIONS_FALLBACK_TITLE} issues={issues} />;
  }
  return (
    <ScaleBarIssueAlert
      // 이유 없이 그릴 행만 없는 표는 슬라이더 대상인 보기 칸이 아예 없는 것이다
      title={issues.length > 0 ? TABLE_FALLBACK_TITLE : TABLE_NO_TARGET_TITLE}
      issues={issues}
      footnote={drawsNothing ? TABLE_DRAWS_NOTHING : undefined}
    />
  );
}

interface ScaleSliderInfoNoteProps {
  /** 이 줄을 설명으로 잇는 컨트롤이 있으면 그 `aria-describedby` 가 가리킬 id */
  id?: string | undefined;
  children: ReactNode;
}

/** 막지 않는 안내 한 줄 — 켜진 슬라이더가 화면을 어떻게 바꾸는지, 알아 둘 것 */
export function ScaleSliderInfoNote({ id, children }: ScaleSliderInfoNoteProps) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-xs text-blue-700">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
