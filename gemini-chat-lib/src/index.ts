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
export { GeminiHandler } from "./gemini/gemini-handler";
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

// コンテキストとファイル処理
export {
  addLineNumbers,
  extractTextFromFile,
  truncateOutput,
  readFile
} from "./utils/file-utils";

export { ContextHelper } from "./utils/context-helper";

// Function calling ツール
export {
  FunctionTool,
  ToolParams,
  ToolResult,
  ReadFileParams,
  CodebaseSearchParams,
  ListDirParams,
  AskFollowupQuestionParams,
  EditFileParams,
  WriteToFileParams,
  AttemptCompletionParams,
  createTools,
  createReadFileTool,
  createCodebaseSearchTool,
  createListDirTool,
  createAskFollowupQuestionTool,
  createEditFileTool,
  createWriteToFileTool,
  createAttemptCompletionTool
} from "./utils/function-tools";

// 連続ツール実行マネージャー
export {
  ToolExecutionManager,
  ToolExecutionManagerOptions,
  ToolExecutionCompletedCallback,
  ToolApprovalCallback
} from "./utils/tool-execution-manager";

// スライディングウィンドウ
export {
  truncateConversation,
  truncateConversationIfNeeded,
  estimateTokenCount,
  TOKEN_BUFFER_PERCENTAGE
} from "./utils/sliding-window";

// 型定義をエクスポート
export type { GeminiHandlerOptions } from './gemini/gemini-handler';

// 互換性のための型エイリアス
import { ChatContent, ChatRole } from "./conversation/types";
export type MessageContent = ChatContent;
export type MessageRole = ChatRole; 