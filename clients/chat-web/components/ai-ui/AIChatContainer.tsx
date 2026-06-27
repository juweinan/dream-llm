'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { AIUIResponse, UIAction, ChatMessage, UIComponent, SessionStage } from '@/types/ai-ui';
import ComponentRenderer from './ComponentRenderer';

/** 将 UI 操作翻译为用户可见的描述文本 */
function describeAction(action: UIAction): string {
  switch (action.componentType) {
    case 'selection': {
      const label = (action.payload['selectedLabel'] as string) ?? action.payload['selectedId'];
      return `选择了「${label}」`;
    }
    case 'form':
      return '提交了表单';
    case 'confirmation': {
      const confirmed = action.payload['confirmed'];
      return confirmed ? '点击了「确认」' : '点击了「取消」';
    }
    case 'action_buttons': {
      const clicked = action.payload['label'] ?? action.payload['action'];
      return `点击了「${clicked}」`;
    }
    default:
      return '执行了操作';
  }
}

/** 根据流程阶段返回输入框占位符 */
function getPlaceholder(stage: SessionStage): string {
  switch (stage) {
    case 'select_type':
      return '描述您的需求，或直接选择下方的卡片选项…';
    case 'fill_detail':
      return '您可以在下方表单中填写详情，或在输入框补充说明…';
    case 'confirm':
      return '请确认上方的需求摘要，或输入修改意见…';
    case 'result':
      return '分析进行中，输入您的后续问题…';
    default:
      return '输入您的问题或需求描述…';
  }
}

/** 进入页面时的初始欢迎消息 */
const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: '👋 你好！我是需求分析助手。\n\n我可以帮您逐步梳理需求、生成分析报告。请先告诉我您想做什么：',
  components: [],
  sessionStage: 'select_type',
  source: 'text',
};

/**
 * 智能聊天容器 — 管理对话状态、调用后端 UI 协议 API、
 * 渲染消息气泡和 UI 组件。
 */
export default function AIChatContainer() {
  const [sessionId] = useState(
    () => `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 最后一条 AI 消息在 messages 里的索引（只有它的组件可点击）
  const lastAiMsgIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return 0; // WELCOME_MESSAGE
  }, [messages]);

  // 当前流程阶段（取最后一条 AI 消息的 stage）
  const currentStage: SessionStage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].sessionStage;
    }
    return 'select_type';
  }, [messages]);

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
      sessionStage: currentStage,
      source: 'text',
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
        source: 'text',
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
          sessionStage: currentStage,
          source: 'text',
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

    // 生成用户操作描述文本
    const userText = describeAction(action);
    const userActionMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: userText,
      components: [],
      sessionStage: currentStage,
      source: 'action',
    };
    setMessages((prev) => [...prev, userActionMsg]);

    try {
      const data = await callAction(action);
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: data.message,
        components: data.components as UIComponent[],
        sessionStage: data.sessionStage,
        source: 'text',
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
          sessionStage: currentStage,
          source: 'text',
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
        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isLastAi={msg.role === 'assistant' && idx === lastAiMsgIndex}
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
            placeholder={getPlaceholder(currentStage)}
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
  isLastAi,
  onAction,
  disabled,
}: {
  message: ChatMessage;
  /** 是否是最后一条 AI 消息（只有它的组件可以交互） */
  isLastAi: boolean;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}) {
  const isUser = message.role === 'user';
  // 历史消息的组件永久禁用，只有最后一条 AI 消息 + 非 loading 时可交互
  const componentsDisabled = !isLastAi || disabled;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] ${
          isUser ? '' : 'space-y-3'
        }`}
      >
        {/* 用户消息（文本输入 / UI 操作 统一样式） */}
        {isUser && (
          <div className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm text-white">
            <p className="whitespace-pre-wrap">{message.text}</p>
          </div>
        )}

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
                disabled={componentsDisabled}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
