import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import {
  getApiKeys,
  loadLangChainConfig,
} from '../config/load-langchain-config';

export function createChatModel() {
  const config = loadLangChainConfig();
  const apiKeys = getApiKeys();

  if (config.llm.provider === 'anthropic') {
    return new ChatAnthropic({
      apiKey: apiKeys.anthropicApiKey,
      anthropicApiUrl: apiKeys.anthropicBaseUrl,
      model: config.llm.model,
      maxTokens: config.llm.maxTokens,
    });
  }

  return new ChatOpenAI({
    apiKey: apiKeys.openaiApiKey,
    configuration: apiKeys.openaiBaseUrl
      ? { baseURL: apiKeys.openaiBaseUrl }
      : undefined,
    model: config.llm.model,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
  });
}
