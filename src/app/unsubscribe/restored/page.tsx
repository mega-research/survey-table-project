import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '구독 복원',
  robots: { index: false, follow: false },
};

export default function RestoredPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">구독이 복원되었습니다</h1>
        <p className="mt-3 text-sm text-gray-600">
          수신거부가 취소되었습니다. 이후 이 설문 관련 메일을 다시 받으실 수 있습니다.
          <br />
          이 창은 닫으셔도 됩니다.
        </p>
      </div>
    </main>
  );
}
