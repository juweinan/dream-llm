import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';

export type LangChainAppConfig = {
  llm: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  retrieval: {
    enabled: boolean;
    topK: number;
  };
  tools: {
    enableConstraintCheck: boolean;
    enableEntityLookup: boolean;
  };
  features: {
    enableStructuredOutput: boolean;
    enableStreaming: boolean;
  };
};

export type LangChainApiKeys = {
  openaiApiKey: string;
  openaiBaseUrl?: string;
  embeddingApiKey: string;
  vectorDbUrl?: string;
  vectorDbApiKey?: string;
};

const parseYaml = load as unknown as (source: string) => unknown;

export function loadLangChainConfig(): LangChainAppConfig {
  const filePath = path.resolve(__dirname, '../../config/langchain.yaml');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseYaml(raw);

  return parsed as LangChainAppConfig;
}

export function getApiKeys(): LangChainApiKeys {
  const openaiApiKey =
    process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '';

  return {
    openaiApiKey,
    openaiBaseUrl:
      process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
    embeddingApiKey: process.env.EMBEDDING_API_KEY ?? openaiApiKey,
    vectorDbUrl: process.env.VECTOR_DB_URL,
    vectorDbApiKey: process.env.VECTOR_DB_API_KEY,
  };
}
