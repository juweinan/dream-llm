'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { AIUIResponse, UIAction, ChatMessage, UIComponent } from '@/types/ai-ui';
import ComponentRenderer from './ComponentRenderer';

/**
 * 智能聊天容器 — 管理对话状态、调用后端 UI 协议 API、
 * 渲染消息气泡和 UI 组件。
 */
export default function AIChatContainer() {
  const [sessionId] = useState(
    () => `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ---- 调用后端 API ----

  const callChat = useCallback(
    async (text: string): Promise<AIUIResponse> => {
      const res = await fetch('/api/ui-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, input: text }),
      });
      if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
      return (await res.json()).data as AIUIResponse;
    },
    [sessionId],
  );

  const callAction = useCallback(
    async (action: UIAction): Promise<AIUIResponse> => {
      const res = await fetch('/api/ui-chat/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action }),
      });
      if (!res.ok) throw new Error(`Action API error: ${res.status}`);
      return (await res.json()).data as AIUIResponse;
    },
    [sessionId],
  );

  // ---- 用户输入文本 ----

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      components: [],
      sessionStage: messages.at(-1)?.sessionStage ?? 'select_type',
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const data = await callChat(text);
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: data.message,
        components: data.components as UIComponent[],
        sessionStage: data.sessionStage,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: '抱歉，请求失败，请稍后重试。',
          components: [],
          sessionStage: prev.at(-1)?.sessionStage ?? 'select_type',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ---- UI 组件操作回调 ----

  async function handleAction(action: UIAction) {
    if (loading) return;
    setLoading(true);

    try {
      const data = await callAction(action);
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: data.message,
        components: data.components as UIComponent[],
        sessionStage: data.sessionStage,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: '操作处理失败，请重试。',
          components: [],
          sessionStage: prev.at(-1)?.sessionStage ?? 'select_type',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // ---- 渲染 ----

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* 消息列表 */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <div className="py-20 text-center text-gray-400">
            <p className="text-lg font-medium">👋 需求分析助手</p>
            <p className="mt-1 text-sm">
              您可以在这里提交需求、查看分析进度，我会逐步引导您完成需求分析全流程。
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onAction={handleAction}
            disabled={loading}
          />
        ))}

        {loading && (
          <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 [animation-delay:0.2s]" />
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 [animation-delay:0.4s]" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 输入栏 */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入您的问题或需求描述…（Enter 发送，Shift+Enter 换行）"
            disabled={loading}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 消息气泡 ----

function MessageBubble({
  message,
  onAction,
  disabled,
}: {
  message: ChatMessage;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] ${
          isUser
            ? 'rounded-xl bg-blue-600 px-4 py-2.5 text-sm text-white'
            : 'space-y-3'
        }`}
      >
        {/* 用户消息 */}
        {isUser && <p className="whitespace-pre-wrap">{message.text}</p>}

        {/* AI 消息：文本 + 组件 */}
        {!isUser && (
          <>
            {message.text && (
              <div className="prose prose-sm max-w-none rounded-xl bg-gray-100 px-4 py-2.5 text-sm leading-relaxed text-gray-800">
                {message.text}
              </div>
            )}
            {message.components.map((comp, i) => (
              <ComponentRenderer
                key={`${comp.type}-${i}`}
                component={comp}
                onAction={onAction}
                disabled={disabled}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
