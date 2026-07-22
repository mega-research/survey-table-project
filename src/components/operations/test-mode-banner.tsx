export function TestModeBanner() {
  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900"
    >
      테스트 데이터를 보고 있습니다. 실제 조사대상자와 응답은 계속 수집되지만 현재 화면에서는 숨겨져 있습니다.
    </div>
  );
}
