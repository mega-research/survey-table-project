import Link from 'next/link';

import { ArrowRight, BarChart3, CheckCircle, FileText, Share2, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Navigation */}
      <nav className="backdrop-blur-apple sticky top-0 z-50 border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-semibold text-gray-900">Survey Table</span>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/analytics">분석 보기</Link>
              </Button>
              <Button variant="ghost" size="sm">
                로그인
              </Button>
              <Button size="sm" asChild>
                <Link href="/admin/surveys/create">시작하기</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 inline-flex items-center rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">
            <Zap className="mr-2 h-4 w-4" />
            Apple처럼 간단한 설문 도구
          </div>

          <h1 className="mb-6 text-4xl leading-tight font-bold text-gray-900 sm:text-5xl lg:text-6xl">
            설문조사를 <span className="gradient-text">쉽고 빠르게</span>
          </h1>

          <p className="mx-auto mb-10 max-w-3xl text-xl leading-relaxed text-gray-600">
            복잡한 기능은 숨기고 필요한 것만. 구글 폼보다 직관적이고, Apple처럼 아름다운 설문조사
            플랫폼입니다.
          </p>

          <div className="mb-12 flex flex-col items-center justify-center space-y-4 sm:flex-row sm:space-y-0 sm:space-x-4">
            <Button size="lg" className="hover-lift px-8 py-4 text-lg" asChild>
              <Link href="/admin/surveys/create">
                무료로 시작하기
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="px-8 py-4 text-lg">
              데모 보기
            </Button>
          </div>

          {/* Feature Preview */}
          <div className="relative mx-auto max-w-5xl">
            <div className="hover-lift rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
              <div className="flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200">
                <div className="text-center">
                  <FileText className="mx-auto mb-4 h-16 w-16 text-gray-400" />
                  <p className="text-lg text-gray-500">설문 생성 인터페이스 미리보기</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl">
              모든 것이 <span className="gradient-text">간단합니다</span>
            </h2>
            <p className="mx-auto max-w-3xl text-xl text-gray-600">
              복잡한 설정 없이 바로 시작하세요. 필요한 모든 기능이 직관적으로 배치되어 있습니다.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <Card className="hover-lift border-0 shadow-lg">
              <CardHeader className="pb-4">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100">
                  <FileText className="h-6 w-6 text-blue-600" />
                </div>
                <CardTitle className="text-xl">직관적인 설문 생성</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed text-gray-600">
                  드래그 앤 드롭으로 질문을 추가하고 순서를 변경하세요. 실시간 미리보기로 결과를
                  바로 확인할 수 있습니다.
                </CardDescription>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card className="hover-lift border-0 shadow-lg">
              <CardHeader className="pb-4">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-100">
                  <Share2 className="h-6 w-6 text-green-600" />
                </div>
                <CardTitle className="text-xl">간편한 공유</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed text-gray-600">
                  공개 링크나 비공개 링크를 선택하여 설문을 공유하세요. QR 코드도 자동으로
                  생성됩니다.
                </CardDescription>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card className="hover-lift border-0 shadow-lg">
              <CardHeader className="pb-4">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100">
                  <BarChart3 className="h-6 w-6 text-purple-600" />
                </div>
                <CardTitle className="text-xl">실시간 분석</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed text-gray-600">
                  응답이 들어오는 즉시 대시보드에서 확인하세요. CSV, Excel로 데이터를 내보낼 수
                  있습니다.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Advanced Features */}
      <section className="bg-gray-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-gray-900 sm:text-4xl">강력한 고급 기능</h2>
            <p className="mx-auto max-w-3xl text-xl text-gray-600">
              단순함 뒤에 숨겨진 강력한 기능들을 만나보세요.
            </p>
          </div>

          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <div>
              <h3 className="mb-6 text-2xl font-bold text-gray-900">다양한 질문 유형 지원</h3>
              <ul className="space-y-4">
                {[
                  '텍스트 입력 (단답형/장문형)',
                  '선택형 질문 (라디오/체크박스)',
                  '다단계 Select (시/도/구 확장)',
                  '테이블 형식 질문',
                  '이미지/동영상 삽입 가능',
                ].map((feature, index) => (
                  <li key={index} className="flex items-center">
                    <CheckCircle className="mr-3 h-5 w-5 text-green-500" />
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="hover-lift rounded-2xl bg-white p-8 shadow-xl">
              <div className="flex aspect-square items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-purple-50">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500">
                    <FileText className="h-8 w-8 text-white" />
                  </div>
                  <p className="text-gray-600">질문 유형 미리보기</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-blue-500 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-6 text-3xl font-bold text-white sm:text-4xl">지금 바로 시작해보세요</h2>
          <p className="mx-auto mb-10 max-w-2xl text-xl text-blue-100">
            복잡한 설정 없이 3분 만에 첫 번째 설문조사를 만들어보세요.
          </p>
          <div className="flex flex-col items-center justify-center space-y-4 sm:flex-row sm:space-y-0 sm:space-x-4">
            <Button
              size="lg"
              variant="secondary"
              className="bg-white px-8 py-4 text-lg text-blue-500 hover:bg-gray-100"
              asChild
            >
              <Link href="/admin/surveys/create">
                무료로 시작하기
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white px-8 py-4 text-lg text-white hover:bg-white hover:text-blue-500"
            >
              예시 설문 보기
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center justify-between md:flex-row">
            <div className="mb-4 flex items-center space-x-2 md:mb-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-semibold text-white">Survey Table</span>
            </div>
            <p className="text-sm text-gray-400">© 2025 Survey Table. Made with ❤️ in Korea.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
