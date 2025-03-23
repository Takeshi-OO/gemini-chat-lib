import { FunctionTool, ToolParams, ToolResult } from './function-tools';
import { ChatMessage } from '../conversation/types';
import { ChatHistory } from '../conversation/message-history';
import { GoogleGenerativeAI, FunctionCallingMode, Tool, FunctionDeclarationSchema, SchemaType } from '@google/generative-ai';
import { convertChatMessageToGemini } from '../gemini/format-converter';

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
   * Gemini API用のAPIキー
   */
  apiKey?: string;

  /**
   * Gemini APIのモデルID
   */
  modelId?: string;

  /**
   * 温度設定
   */
  temperature?: number;
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
  private apiKey?: string;
  private modelId?: string;
  private temperature: number = 0.2;
  
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
    this.apiKey = options.apiKey;
    this.modelId = options.modelId;
    this.temperature = options.temperature ?? 0.2;
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
   * Gemini APIを使用して連続ツール実行を行う
   * FunctionCallingMode.ANYモードを使用
   * @param prompt ユーザープロンプト
   * @returns 実行結果（タスク完了の場合はtrue）
   */
  async executeToolsWithGeminiAPI(prompt: string): Promise<boolean> {
    if (!this.apiKey) {
      throw new Error('Gemini APIキーが指定されていません');
    }

    try {
      // Gemini APIを初期化
      const genAI = new GoogleGenerativeAI(this.apiKey);

      // ツール定義を準備
      const tools: Tool[] = [{
        functionDeclarations: this.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: tool.parameters.properties as Record<string, FunctionDeclarationSchema>,
            required: tool.parameters.required
          },
        }))
      }];

      // モデルを初期化
      const model = genAI.getGenerativeModel({
        model: this.modelId || 'gemini-1.5-pro',
        generationConfig: {
          temperature: this.temperature
        },
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingMode.ANY
          }
        },
        tools
      });

      // 会話履歴からGemini APIフォーマットに変換
      const contents = this.chatHistory.getMessages().map(msg => convertChatMessageToGemini(msg));

      // 初回リクエスト
      const initialResult = await model.generateContent({
        contents: [...contents, { role: 'user', parts: [{ text: prompt }] }]
      });

      // 応答を会話履歴に追加
      this.chatHistory.addMessage({
        role: 'user',
        content: prompt,
        ts: Date.now()
      });

      const initialResponse = initialResult.response;
      
      // 関数呼び出しがあるか確認
      const initialFunctionCalls = initialResponse.candidates?.[0]?.content?.parts
        ?.filter((part: any) => part.functionCall)
        .map((part: any) => part.functionCall);

      if (!initialFunctionCalls || initialFunctionCalls.length === 0) {
        // テキスト応答の場合は会話履歴に追加して終了
        this.chatHistory.addMessage({
          role: 'assistant',
          content: initialResponse.text(),
          ts: Date.now()
        });
        return false;
      }

      // 関数呼び出しの場合は実行して結果を送信し、次の応答を取得する
      return await this.processFunctionCallSequence(
        model, 
        [...contents, { role: 'user', parts: [{ text: prompt }] }], 
        initialFunctionCalls[0]
      );
    } catch (error) {
      console.error('Gemini API実行エラー:', error);
      return false;
    }
  }

  /**
   * 関数呼び出しシーケンスを処理する
   * @param model Geminiモデル
   * @param contents 現在の会話コンテンツ
   * @param functionCall 関数呼び出し
   * @returns 実行結果（タスク完了の場合はtrue）
   */
  private async processFunctionCallSequence(
    model: any, 
    contents: any[], 
    functionCall: any
  ): Promise<boolean> {
    if (this.aborted) {
      return true;
    }

    if (this.consecutiveMistakeCount >= this.maxConsecutiveMistakes) {
      return true;
    }

    // 関数名と引数を取得
    const toolName = functionCall.name;
    const toolParams = functionCall.args || {};

    // タスク完了確認
    if (toolName === 'attempt_completion') {
      // attempt_completionツールが呼ばれた場合はタスク完了として扱う
      return true;
    }

    // 関数呼び出しをリクエスト履歴に追加
    contents.push({
      role: 'model',
      parts: [{
        functionCall: {
          name: toolName,
          args: toolParams
        }
      }]
    });

    // ツールを実行
    const toolResult = await this.executeTool(toolName, toolParams);

    // ツール実行結果を会話履歴とリクエスト履歴に追加
    this.chatHistory.addMessage({
      role: 'assistant',
      content: [{
        type: 'function_call',
        function_call: {
          name: toolName,
          arguments: toolParams
        }
      }],
      ts: Date.now()
    });

    contents.push({
      role: 'user',
      parts: [{
        functionResponse: {
          name: toolName,
          response: {
            content: toolResult.content,
            error: toolResult.error
          }
        }
      }]
    });

    this.chatHistory.addMessage({
      role: 'user',
      content: [{
        type: 'function_response',
        function_response: {
          name: toolName,
          response: toolResult
        }
      }],
      ts: Date.now()
    });

    if (toolResult.error) {
      this.consecutiveMistakeCount++;
    } else {
      this.consecutiveMistakeCount = 0;
    }

    // 次の応答を取得
    try {
      const nextResult = await model.generateContent({ contents });
      const nextResponse = nextResult.response;

      // 次の関数呼び出しがあるか確認
      const nextFunctionCalls = nextResponse.candidates?.[0]?.content?.parts
        ?.filter((part: any) => part.functionCall)
        .map((part: any) => part.functionCall);

      if (!nextFunctionCalls || nextFunctionCalls.length === 0) {
        // テキスト応答の場合は会話履歴に追加して終了
        this.chatHistory.addMessage({
          role: 'assistant',
          content: nextResponse.text(),
          ts: Date.now()
        });
        return false;
      }

      // 再帰的に連続実行を継続
      return await this.processFunctionCallSequence(
        model,
        contents,
        nextFunctionCalls[0]
      );
    } catch (error) {
      console.error('Gemini API連続実行エラー:', error);
      return false;
    }
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