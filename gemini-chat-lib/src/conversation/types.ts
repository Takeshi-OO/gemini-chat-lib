/**
 * 会話履歴管理に必要な型定義
 */

export type ChatRole = "user" | "assistant" | "system" | string;

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContent[];
  ts?: number;
}

export interface ChatContent {
  type: "text" | "image" | "function_call" | "function_response";
  text?: string;
  image_url?: {
    url: string;
  };
  function_call?: {
    name: string;
    arguments: Record<string, any>;
  };
  function_response?: {
    name: string;
    response: any;
  };
}

/**
 * 以下はRoo-Codeからの移植型定義
 */

export type ClineAsk =
  | "followup"
  | "command"
  | "command_output"
  | "completion_result"
  | "tool"
  | "api_req_failed"
  | "resume_task"
  | "resume_completed_task"
  | "mistake_limit_reached"
  | "browser_action_launch"
  | "use_mcp_server"
  | "finishTask";

export type ClineSay =
  | "task"
  | "error"
  | "api_req_started"
  | "api_req_finished"
  | "api_req_retried"
  | "api_req_retry_delayed"
  | "api_req_deleted"
  | "text"
  | "reasoning"
  | "completion_result"
  | "user_feedback"
  | "user_feedback_diff"
  | "command_output"
  | "tool"
  | "shell_integration_warning"
  | "browser_action"
  | "browser_action_result"
  | "command"
  | "mcp_server_request_started"
  | "mcp_server_response"
  | "new_task_started"
  | "new_task"
  | "checkpoint_saved"
  | "rooignore_error";

export interface ClineMessage {
  ts: number;
  type: "ask" | "say";
  ask?: ClineAsk;
  say?: ClineSay;
  text?: string;
  images?: string[];
  partial?: boolean;
  reasoning?: string;
  conversationHistoryIndex?: number;
  checkpoint?: Record<string, unknown>;
  progressStatus?: ToolProgressStatus;
}

export type ToolProgressStatus = {
  icon?: string;
  text?: string;
}; 