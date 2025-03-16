// 会話履歴管理
export { ChatHistory, MessageHistory } from "./conversation/message-history";
export { 
  ChatMessage, 
  ChatContent, 
  ChatRole,
  ClineMessage,
  ClineAsk,
  ClineSay,
  ToolProgressStatus
} from "./conversation/types";

// Gemini関連
export { GeminiHandler, GeminiHandlerOptions } from "./gemini/gemini-handler";
export { 
  convertChatMessageToGemini, 
  convertChatContentToGeminiParts,
  convertAnthropicMessageToGemini,
  convertAnthropicContentToGemini
} from "./gemini/format-converter";
export { 
  GeminiModelId, 
  ModelInfo, 
  geminiDefaultModelId, 
  geminiModels 
} from "./gemini/models";
export { 
  ApiStream, 
  ApiStreamChunk, 
  ApiStreamTextChunk, 
  ApiStreamUsageChunk, 
  ApiStreamReasoningChunk 
} from "./gemini/stream"; 