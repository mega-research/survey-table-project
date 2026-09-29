import Link from 'next/link';

import { operationsPaths } from '../operations-paths';

interface Props {
  /** 이 콘솔의 주소 접두. */
  basePath: string;
  /**
   * 명단을 직접 올릴 수 있는가 — `contacts.manage` (ADR-0026, 티켓 06).
   *
   * 외주 실사 링크에는 그 권한이 없고 업로드 화면도 그 트리에 없다. 안내를 그대로 두면
   * **열리지 않는 주소**를 가리키며 할 수 없는 일을 시키게 된다.
   */
  canUpload?: boolean;
}

export function ProgressEmptyCard({ basePath, canUpload = true }: Props) {
  return (
    <div
      role="alert"
      className="mt-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700"
    >
      <p className="mb-1 font-semibold">📌 조사 대상 명단이 없습니다.</p>
      {canUpload ? (
        <p>
          이 설문은 조사 대상 명단이 비어 있어 진척률 표가 표시되지 않습니다.{' '}
          <Link
            href={operationsPaths(basePath).contactsUploadNew}
            className="underline hover:text-amber-900"
          >
            조사 대상 메뉴 → 조사 대상 업로드
          </Link>
          에서 엑셀을 올린 뒤 그룹 컬럼(예: 전시회명) 을 매핑하면 자동으로 집계됩니다.
        </p>
      ) : (
        <p>
          이 설문은 조사 대상 명단이 비어 있어 진척률 표가 표시되지 않습니다. 담당 연구원이
          명단을 올리면 자동으로 집계됩니다.
        </p>
      )}
    </div>
  );
}
