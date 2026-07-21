export default function ShortInviteNotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold text-gray-900">유효하지 않은 링크입니다</h2>
        <p className="text-sm text-gray-600">
          초대 링크가 만료되었거나 올바르지 않습니다. 발송된 메일의 링크를 다시 확인해 주세요.
        </p>
      </div>
    </div>
  );
}
