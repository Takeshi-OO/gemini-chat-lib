/**
 * Geminiモデルの情報
 * gemini-2.0-flashのみをサポートするシンプル版
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

export type GeminiModelId = "gemini-2.0-flash-001";
export const geminiDefaultModelId: GeminiModelId = "gemini-2.0-flash-001";

export const geminiModels = {
  "gemini-2.0-flash-001": {
    maxTokens: 8192,
    contextWindow: 1_048_576,
    supportsImages: true,
    supportsPromptCache: false,
    inputPrice: 0,
    outputPrice: 0,
  }
}; 