'use client';

import AIChatContainer from '@/components/ai-ui/AIChatContainer';

export default function Home() {
  return (
    <main className="h-screen flex flex-col bg-gray-50">
      <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-gray-900">
          需求分析助手
        </h1>
        <p className="text-xs text-gray-500">Dream LLM · AI 驱动的需求分析系统</p>
      </header>
      <div className="flex-1 min-h-0">
        <AIChatContainer />
      </div>
    </main>
  );
}
