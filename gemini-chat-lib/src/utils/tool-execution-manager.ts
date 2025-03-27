import { FunctionTool, ToolParams, ToolResult } from './function-tools';
import { ChatMessage } from '../conversation/types';
import { ChatHistory } from '../conversation/message-history';
import { GeminiHandler } from '../gemini/gemini-handler';

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

  /**
   * GeminiHandlerインスタンス
   */
  geminiHandler: GeminiHandler;
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
  private geminiHandler: GeminiHandler;
  
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
    this.geminiHandler = options.geminiHandler;
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
   * ツールの連続実行を開始する
   * @param prompt ユーザープロンプト
   * @returns 実行結果（タスク完了の場合はtrue）
   */
  async executeToolsSequentially(prompt: string): Promise<boolean> {
    if (this.aborted) {
      this.aborted = false;
      return false;
    }

    try {
      // プロンプトが空でなければ会話履歴に追加
      if (prompt) {
        this.chatHistory.addMessage({
          role: 'user',
          content: prompt,
          ts: Date.now()
        });
      }

      // 関数呼び出しを含むメッセージかどうかを確認
      const lastMessage = this.chatHistory.getMessages().slice(-1)[0];
      
      // 応答にファンクションコールが含まれているかチェック
      if (lastMessage && 
          'content' in lastMessage && 
          Array.isArray(lastMessage.content) && 
          lastMessage.content.some(part => part.type === 'function_call')) {
        
        // ファンクションコールを抽出
        const functionCallPart = lastMessage.content.find(part => part.type === 'function_call');
        if (functionCallPart && 'function_call' in functionCallPart && functionCallPart.function_call) {
          const functionName = functionCallPart.function_call.name;
          const functionArgs = functionCallPart.function_call.arguments;
          
          // attempt_completionツールの場合はタスク完了
          if (functionName === 'attempt_completion') {
            return true;
          }
          
          // フォローアップ質問ツールの場合は特別な処理
          if (functionName === 'ask_followup_question') {
            // フォローアップ質問処理はGeminiHandlerに任せる
            return false;
          }
          
          // ツールを実行
          const result = await this.executeTool(functionName, functionArgs);
          
          // 結果を会話履歴に追加
          this.chatHistory.addMessage({
            role: 'user',
            content: [
              {
                type: 'function_response',
                function_response: {
                  name: functionName,
                  response: { content: result.content, error: result.error }
                }
              }
            ],
            ts: Date.now()
          });

          // 次の応答を取得するためにGeminiAPIを使用（直接会話履歴を渡す）
          const functionDefinitions = this.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters.properties
          }));
          
          // 関数呼び出し用のメッセージを作成
          const nextResponse = await this.geminiHandler.sendMessageWithFunctions(
            this.chatHistory.getMessages(),
            functionDefinitions
          );
          
          // 応答を会話履歴に追加
          this.chatHistory.addMessage(nextResponse);
          
          // 連続して次のツールを実行（空のプロンプトで再帰呼び出し）
          return await this.executeToolsSequentially('');
        }
      }
      
      // 通常のテキスト応答の場合
      return false;
    } catch (error) {
      console.error('ツール連続実行エラー:', error);
      this.consecutiveMistakeCount++;
      
      if (this.consecutiveMistakeCount >= this.maxConsecutiveMistakes) {
        this.consecutiveMistakeCount = 0;
        return false;
      }
      
      return false;
    }
  }
} 