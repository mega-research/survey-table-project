import type { ScaleBarIssue } from '@/features/survey-builder/lib/scale-bar-diagnostics';

interface ScaleBarIssueAlertProps {
  /** 무엇이 어떻게 보이는지 — 그룹 설정은 「원본 한 줄」, 표시 방식은 「원본 표 조각」 */
  title: string;
  issues: readonly ScaleBarIssue[];
}

/** 척도 막대 폴백 경고 — 이유별 문구와 그 이유로 폴백하는 행. 문제가 없으면 그리지 않는다 */
export function ScaleBarIssueAlert({ title, issues }: ScaleBarIssueAlertProps) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
    >
      <p className="font-medium">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {issues.map((issue) => (
          <li key={issue.reason}>
            {issue.message}
            <span className="text-amber-700"> (행: {issue.rowLabels.join(', ')})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
