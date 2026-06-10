'use client';
import { useState } from 'react';
import { APP_NAME } from '@autix/contracts';

const DEFAULT_INPUT = '用户注册时必须绑定手机号，密码至少8位';

export default function Home() {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [result, setResult] = useState<object | null>(null);
  const [loading, setLoading] = useState(false);

  async function callApi() {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/requirement/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ error: '请求失败' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>{APP_NAME}</h1>

      <textarea
        rows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{ width: '100%', marginBottom: 12, fontFamily: 'monospace' }}
      />

      <button onClick={callApi} disabled={loading}>
        {loading ? '抽取中…' : '提交'}
      </button>

      <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
        {result ? JSON.stringify(result, null, 2) : '点击提交查看结果'}
      </pre>
    </main>
  );
}
