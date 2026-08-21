import Link from 'next/link';

interface Props {
  surveyId: string;
}

export function ProgressEmptyCard({ surveyId }: Props) {
  return (
    <div
      role="alert"
      className="mt-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700"
    >
      <p className="mb-1 font-semibold">📌 조사 대상 명단이 없습니다.</p>
      <p>
        이 설문은 조사 대상 명단이 비어 있어 진척률 표가 표시되지 않습니다.{' '}
        <Link
          href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}
          className="underline hover:text-amber-900"
        >
          조사 대상 메뉴 → 조사 대상 업로드
        </Link>
        에서 엑셀을 올린 뒤 그룹 컬럼(예: 전시회명) 을 매핑하면 자동으로 집계됩니다.
      </p>
    </div>
  );
}
