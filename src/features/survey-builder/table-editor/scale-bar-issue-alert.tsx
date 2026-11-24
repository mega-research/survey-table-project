import type { ScaleBarIssue } from '@/features/survey-builder/lib/scale-bar-diagnostics';

interface ScaleBarIssueAlertProps {
  /** 무엇이 어떻게 보이는지 — 그룹 설정은 「원본 한 줄」, 표시 방식은 「원본 표 조각」 */
  title: string;
  issues: readonly ScaleBarIssue[];
  /**
   * 이유 목록 아래에 따로 적는 한 줄 — 척도 슬라이더의 「그릴 수 있는 행이 없어 화면이 바뀌지 않는다」.
   * 이 줄이 있으면 이유가 없어도 상자를 그린다.
   */
  footnote?: string | undefined;
}

/**
 * 척도 막대·척도 슬라이더 폴백 경고 — 이유별 문구와 그 이유로 폴백하는 행. 문제가 없으면 그리지 않는다.
 * 행이 없는 이유(보통 라디오 문항의 슬라이더)는 행 이름 자리를 비운다.
 */
export function ScaleBarIssueAlert({ title, issues, footnote }: ScaleBarIssueAlertProps) {
  if (issues.length === 0 && !footnote) return null;
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
    >
      <p className="font-medium">{title}</p>
      {issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {issues.map((issue) => (
            <li key={issue.reason}>
              {issue.message}
              {issue.rowLabels.length > 0 && (
                <span className="text-amber-700"> (행: {issue.rowLabels.join(', ')})</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {footnote ? <p>{footnote}</p> : null}
    </div>
  );
}
