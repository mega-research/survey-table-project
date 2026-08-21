import { QueryProvider } from '@/components/providers/query-provider';

// TanStack Query 는 관리자 화면만 쓴다. 공개 응답 페이지(/survey, /i, /preview, /unsubscribe)는
// plain RPC client 만 쓰므로 Provider 를 루트가 아니라 여기서 연다 — 응답자 번들에서 Query 런타임을 뺀다.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
