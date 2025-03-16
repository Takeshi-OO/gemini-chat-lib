/**
 * Geminiモデルの情報
 * 元のRoo-Codeのコードを参考に、シンプル化したもの
 */

export interface ModelInfo {
  maxTokens?: number;
  contextWindow: number;
  supportsImages?: boolean;
  supportsPromptCache?: boolean;
  inputPrice?: number;
  outputPrice?: number;
  description?: string;
}

export type GeminiModelId = keyof typeof geminiModels;
export const geminiDefaultModelId: GeminiModelId = "gemini-2.0-flash-001";

export const geminiModels = {
  "gemini-2.0-flash-001": {
    maxTokens: 8192,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-2.0-flash-lite-preview-02-05": {
    maxTokens: 8192,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-2.0-pro-exp-02-05": {
    maxTokens: 8192,
    contextWindow: 2_097_152,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-2.0-flash-thinking-exp-01-21": {
    maxTokens: 65_536,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-2.0-flash-thinking-exp-1219": {
    maxTokens: 8192,
    contextWindow: 32_767,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-2.0-flash-exp": {
    maxTokens: 8192,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-1.5-flash-002": {
    maxTokens: 8192,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-1.5-pro-002": {
    maxTokens: 8192,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-1.0-pro-vision-001": {
    maxTokens: 8192,
    contextWindow: 16_384,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-1.0-pro-001": {
    maxTokens: 8192,
    contextWindow: 32_768,
    supportsImages: false,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
  "gemini-1.0-pro-latest": {
    maxTokens: 8192,
    contextWindow: 32_768,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  },
}; 