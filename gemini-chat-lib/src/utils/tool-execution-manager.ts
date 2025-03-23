import { FunctionTool, ToolParams, ToolResult } from './function-tools';
import { ChatMessage } from '../conversation/types';
import { ChatHistory } from '../conversation/message-history';

/**
 * ツール実行の完了を示すコールバック型
 */
export type ToolExecutionCompletedCallback = (
  toolName: string, 
  params: ToolParams, 
  result: ToolResult
) => Promise<void>;

/**
 * ツール実行の承認を求めるコールバック型
 */
export type ToolApprovalCallback = (
  toolName: string, 
  params: ToolParams
) => Promise<boolean>;

/**
 * ツール実行マネージャーのオプション
 */
export interface ToolExecutionManagerOptions {
  /**
   * 利用可能なツールのリスト
   */
  tools: FunctionTool[];
  
  /**
   * 会話履歴
   */
  chatHistory: ChatHistory;
  
  /**
   * ツール実行完了時のコールバック
   */
  onToolExecutionCompleted?: ToolExecutionCompletedCallback;
  
  /**
   * ユーザー承認が必要なツール名のリスト
   */
  toolsRequiringApproval?: string[];
  
  /**
   * ユーザー承認を求めるコールバック
   */
  onToolApprovalRequired?: ToolApprovalCallback;
}

/**
 * 連続ツール実行を管理するクラス
 * Roo-codeのinititeTaskLoopとrecursivelyMakeClineRequestsの機能を簡略化して実装
 */
export class ToolExecutionManager {
  private tools: FunctionTool[];
  private chatHistory: ChatHistory;
  private onToolExecutionCompleted?: ToolExecutionCompletedCallback;
  private toolsRequiringApproval: string[];
  private onToolApprovalRequired?: ToolApprovalCallback;
  private consecutiveMistakeCount: number = 0;
  private maxConsecutiveMistakes: number = 3;
  private isExecutingTool: boolean = false;
  private aborted: boolean = false;
  
  /**
   * コンストラクタ
   * @param options ツール実行マネージャーのオプション
   */
  constructor(options: ToolExecutionManagerOptions) {
    this.tools = options.tools;
    this.chatHistory = options.chatHistory;
    this.onToolExecutionCompleted = options.onToolExecutionCompleted;
    this.toolsRequiringApproval = options.toolsRequiringApproval || [];
    this.onToolApprovalRequired = options.onToolApprovalRequired;
  }
  
  /**
   * ツール名からツールを取得する
   * @param toolName ツール名
   * @returns ツール、または未定義
   */
  private getToolByName(toolName: string): FunctionTool | undefined {
    return this.tools.find(tool => tool.name === toolName);
  }
  
  /**
   * ツールを実行する
   * @param toolName ツール名
   * @param params ツールパラメータ
   * @returns ツールの実行結果
   */
  private async executeTool(toolName: string, params: ToolParams): Promise<ToolResult> {
    try {
      const tool = this.getToolByName(toolName);
      if (!tool) {
        return {
          content: '',
          error: `ツール '${toolName}' が見つかりません`
        };
      }
      
      // ユーザー承認が必要なツールの場合
      if (this.toolsRequiringApproval.includes(toolName) && this.onToolApprovalRequired) {
        const approved = await this.onToolApprovalRequired(toolName, params);
        if (!approved) {
          return {
            content: `ユーザーがツール '${toolName}' の実行を拒否しました`
          };
        }
      }
      
      // ツールを実行
      this.isExecutingTool = true;
      const result = await tool.execute(params);
      this.isExecutingTool = false;
      
      // ツール実行完了コールバックを呼び出す
      if (this.onToolExecutionCompleted) {
        await this.onToolExecutionCompleted(toolName, params, result);
      }
      
      // タスク完了ツールが呼ばれた場合は成功を記録
      if (toolName === 'attempt_completion') {
        this.consecutiveMistakeCount = 0;
      }
      
      return result;
    } catch (error) {
      this.isExecutingTool = false;
      this.consecutiveMistakeCount++;
      
      return {
        content: '',
        error: `ツール実行エラー: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * 連続ツール実行を中止する
   */
  abort(): void {
    this.aborted = true;
  }
  
  /**
   * 連続でツールを実行する
   * @param functionCallMessage 関数呼び出しを含むメッセージ
   * @param generateResponse 関数実行結果に基づいて新しいレスポンスを生成する関数
   * @returns 実行結果（タスク完了の場合はtrue）
   */
  async executeToolsSequentially(
    functionCallMessage: ChatMessage,
    generateResponse: (messages: ChatMessage[]) => Promise<ChatMessage>
  ): Promise<boolean> {
    // 中止されている場合は実行しない
    if (this.aborted) {
      return true;
    }
    
    // 連続エラーが多すぎる場合
    if (this.consecutiveMistakeCount >= this.maxConsecutiveMistakes) {
      return true;
    }
    
    // 関数呼び出しを含むメッセージを解析
    if (!functionCallMessage.content || typeof functionCallMessage.content === 'string') {
      // 関数呼び出しがない場合は処理を終了
      return true;
    }
    
    // 配列形式のcontentから関数呼び出しを取得
    const functionCallContent = Array.isArray(functionCallMessage.content)
      ? functionCallMessage.content.find(item => item.type === 'function_call')
      : undefined;
    
    if (!functionCallContent || !('function_call' in functionCallContent)) {
      // 関数呼び出しがない場合は処理を終了
      return true;
    }
    
    const functionCall = functionCallContent.function_call;
    if (!functionCall || !functionCall.name) {
      // 関数名がない場合は処理を終了
      return true;
    }
    
    // タスク完了ツールの場合
    if (functionCall.name === 'attempt_completion') {
      // タスク完了として扱い、処理を終了
      return true;
    }
    
    // ツールを実行
    const toolName = functionCall.name;
    const toolParams = functionCall.arguments || {};
    const toolResult = await this.executeTool(toolName, toolParams);
    
    // エラーがある場合
    if (toolResult.error) {
      this.consecutiveMistakeCount++;
      // エラーを含む応答をチャット履歴に追加
      this.chatHistory.addMessage({
        role: 'user',
        content: `ツール '${toolName}' の実行中にエラーが発生しました: ${toolResult.error}`,
        ts: Date.now()
      });
      return false;
    }
    
    // 実行結果をチャット履歴に追加
    this.chatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'function_response',
          function_response: {
            name: toolName,
            response: toolResult
          }
        }
      ],
      ts: Date.now()
    });
    
    // 成功した場合は連続エラーカウントをリセット
    this.consecutiveMistakeCount = 0;
    
    // 次の応答を生成
    const nextResponse = await generateResponse(this.chatHistory.getMessages());
    this.chatHistory.addMessage(nextResponse);
    
    // 再帰的に連続実行を継続
    return this.executeToolsSequentially(nextResponse, generateResponse);
  }
} 