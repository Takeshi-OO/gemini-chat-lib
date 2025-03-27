import { GoogleGenerativeAI, FunctionDeclarationSchema, FunctionCallingMode, SchemaType } from "@google/generative-ai";
import { ChatMessage } from "../conversation/types";
import { convertChatMessageToGemini } from "./format-converter";
import { ApiStream } from "./stream";
import { geminiModels } from "./models";
import { ChatHistory } from "../conversation/message-history";
import { FunctionTool, PropertyType } from "../utils/function-tools";
import { ToolExecutionManager } from "../utils/tool-execution-manager";

const GEMINI_DEFAULT_TEMPERATURE = 0;
// 固定モデルとFunctionCallingMode
const GEMINI_MODEL_ID = 'gemini-2.0-flash-001';
const DEFAULT_FUNCTION_CALLING_MODE: FunctionCallingMode = FunctionCallingMode.ANY;

export interface GeminiHandlerOptions {
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: FunctionTool[];
  onTaskCompleted?: (result: string, command?: string) => Promise<void>;
  toolsRequiringApproval?: string[];
  onToolApprovalRequired?: (toolName: string, params: any) => Promise<boolean>;
  onToolExecutionCompleted?: (toolName: string, params: any, result: any) => Promise<void>;
}

/**
 * Gemini APIを扱うハンドラークラス
 */
export class GeminiHandler {
  private readonly client: GoogleGenerativeAI;
  private readonly options: {
    apiKey: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: FunctionTool[];
    onTaskCompleted?: (result: string, command?: string) => Promise<void>;
    toolsRequiringApproval?: string[];
    onToolApprovalRequired?: (toolName: string, params: any) => Promise<boolean>;
    onToolExecutionCompleted?: (toolName: string, params: any, result: any) => Promise<void>;
  };
  private toolExecutionManager?: ToolExecutionManager;

  /**
   * コンストラクタ
   * @param options オプション
   */
  constructor(options: GeminiHandlerOptions) {
    this.options = { ...options };
    this.client = new GoogleGenerativeAI(options.apiKey);
  }

  /**
   * モデル情報を取得する
   * @returns モデル情報
   */
  getModel() {
    return {
      id: GEMINI_MODEL_ID,
      info: geminiModels[GEMINI_MODEL_ID]
    };
  }

  /**
   * メッセージを送信し、ストリームで応答を受け取る
   * @param systemPrompt システムプロンプト
   * @param messages メッセージ履歴
   * @returns ストリーム
   */
  async *createMessage(
    systemPrompt: string,
    messages: ChatMessage[]
  ): AsyncGenerator<
    { type: "text"; text: string } | { type: "usage"; inputTokens: number; outputTokens: number },
    void,
    unknown
  > {
    const model = this.client.getGenerativeModel(
      {
        model: this.getModel().id,
        systemInstruction: systemPrompt,
      },
      {
        baseUrl: this.options.baseUrl,
      }
    );

    const generateContentOptions: any = {
      contents: messages.map(convertChatMessageToGemini),
      generationConfig: {
        maxOutputTokens: this.options.maxTokens || this.getModel().info.maxTokens,
        temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
      },
    };

    // 関数呼び出しモードが設定されていて、ツールも提供されている場合
    if (this.options.tools && this.options.tools.length > 0) {
      // ツールの定義を作成
      const tools = this.options.tools.map((tool) => ({
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description || "",
            parameters: {
              type: SchemaType.OBJECT,
              properties: convertParametersFormat(tool.parameters.properties),
              required: tool.parameters.required,
            } as FunctionDeclarationSchema,
          },
        ],
      }));

      // ツールとツール設定を追加
      generateContentOptions.tools = tools;
      generateContentOptions.toolConfig = {
        functionCallingConfig: {
          mode: DEFAULT_FUNCTION_CALLING_MODE,
        },
      };
    }

    const result = await model.generateContentStream(generateContentOptions);

    for await (const chunk of result.stream) {
      yield {
        type: "text",
        text: chunk.text(),
      };
    }

    const response = await result.response;
    yield {
      type: "usage",
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  /**
   * メッセージを送信し、ストリーミングせずに応答を受け取る
   * @param message メッセージ内容
   * @param conversation 会話履歴（オプション）
   * @param options 追加オプション（省略可能）
   * @returns 応答テキストと使用トークン情報
   */
  async sendMessage(
    message: string,
    conversation?: ChatHistory,
    options?: {
      onFollowupQuestion?: (question: string) => Promise<string>;
    }
  ): Promise<{ text: string; usage: { input: number; output: number } }> {
    // 会話履歴が指定されていない場合は新しく作成
    const history = conversation || new ChatHistory();
    
    // 会話履歴にモデル情報を設定
    const modelInfo = this.getModel().info;
    history.setModelLimits(modelInfo.maxTokens, modelInfo.contextWindow);
    
    // 最後のメッセージが既にユーザーからのものでない場合、メッセージを追加
    const messages = history.getMessages();
    if (message && (messages.length === 0 || messages[messages.length - 1].role !== "user")) {
      history.addMessage({
        role: "user",
        content: message,
        ts: Date.now(),
      });
    }
    
    // システムプロンプトなしでメッセージを送信
    const systemPrompt = "";

    // 常に functionCallingMode は 'ANY' を使用
    if (this.options.tools && this.options.tools.length > 0) {
      // ToolExecutionManagerが未初期化の場合は初期化
      if (!this.toolExecutionManager) {
        this.toolExecutionManager = new ToolExecutionManager({
          tools: this.options.tools,
          chatHistory: history,
          onToolExecutionCompleted: this.options.onToolExecutionCompleted,
          toolsRequiringApproval: this.options.toolsRequiringApproval,
          onToolApprovalRequired: this.options.onToolApprovalRequired,
          geminiHandler: this
        });
      }
      
      // 関数呼び出し定義を作成
      const functionDefinitions = this.options.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters.properties
      }));
      
      // 関数呼び出し用のメッセージを作成（allowed_function_namesは指定しない）
      const functionCallResponse = await this.sendMessageWithFunctions(
        history.getMessages(),
        functionDefinitions
      );
      
      // 応答を会話履歴に追加
      history.addMessage(functionCallResponse);
      
      // フォローアップ質問があるかチェック
      if (options?.onFollowupQuestion && 
          Array.isArray(functionCallResponse.content) && 
          functionCallResponse.content.some(part => 
            part.type === 'function_call' && 
            'function_call' in part && 
            part.function_call?.name === 'ask_followup_question')) {
        
        // フォローアップ質問を抽出
        const functionCall = functionCallResponse.content.find(part => 
          part.type === 'function_call' && 
          'function_call' in part && 
          part.function_call?.name === 'ask_followup_question'
        );
        
        if (functionCall && 'function_call' in functionCall && functionCall.function_call) {
          try {
            // フォローアップ質問を取得
            const question = functionCall.function_call.arguments.question;
            
            // ユーザーにフォローアップ質問を投げる
            const answer = await options.onFollowupQuestion(question);
            
            // 回答をチャット履歴に追加
            history.addMessage({
              role: 'user',
              content: [
                {
                  type: 'function_response',
                  function_response: {
                    name: 'ask_followup_question',
                    response: { content: answer }
                  }
                }
              ],
              ts: Date.now()
            });
            
            // 次の応答を取得
            const nextResponse = await this.sendMessageWithFunctions(
              history.getMessages(),
              functionDefinitions
            );
            
            // 応答を履歴に追加
            history.addMessage(nextResponse);
            
            // 応答が次の関数呼び出し（タスク完了または別のフォローアップ質問）を含む場合
            if (Array.isArray(nextResponse.content) && 
                nextResponse.content.some(part => part.type === 'function_call')) {
              // 再度フォローアップまたはツール実行を処理
              return this.sendMessage('', history, options);
            } else {
              // テキスト応答の場合は処理
              return this.processFullResponse(history);
            }
          } catch (error) {
            // フォローアップ質問の処理中にエラーが発生した場合
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('フォローアップ質問エラー:', errorMessage);
            
            // エラーメッセージを会話履歴に追加
            history.addMessage({
              role: 'user',
              content: `フォローアップ質問の処理中にエラーが発生しました: ${errorMessage}`,
              ts: Date.now()
            });
            
            // エラーからの回復を試みる
            return {
              text: `フォローアップ質問の処理に失敗しました: ${errorMessage}`,
              usage: { input: 0, output: 0 }
            };
          }
        }
      }
      
      // 連続ツール実行があるかチェック
      // 初期応答に関数呼び出しが含まれていて、タスク完了でもフォローアップ質問でもない場合
      if (Array.isArray(functionCallResponse.content) && 
          functionCallResponse.content.some(part => 
            part.type === 'function_call' && 
            'function_call' in part)) {
        const functionCall = functionCallResponse.content.find(part => 
          part.type === 'function_call' && 
          'function_call' in part
        );
        
        if (functionCall && 
            'function_call' in functionCall && 
            functionCall.function_call && 
            functionCall.function_call.name !== 'ask_followup_question') {
          const sequentialToolExecution = await this.handleSequentialToolExecution(history, functionCallResponse);
          if (sequentialToolExecution) {
            return sequentialToolExecution;
          }
        }
      }
      
      // 終了の応答を処理して返す
      return this.processFullResponse(history);
    } else {
      // ツールがない場合は単純なメッセージとして送信
      const model = this.client.getGenerativeModel({
        model: this.getModel().id,
        systemInstruction: systemPrompt,
      }, {
        baseUrl: this.options.baseUrl,
      });
      
      const generateContentOptions = {
        contents: history.getMessages().map(convertChatMessageToGemini),
        generationConfig: {
          maxOutputTokens: this.options.maxTokens || this.getModel().info.maxTokens,
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        }
      };
      
      const result = await model.generateContent(generateContentOptions);
      const text = result.response.text();
      
      history.addMessage({
        role: "assistant",
        content: text,
        ts: Date.now(),
      });
      
      return {
        text,
        usage: {
          input: result.response.usageMetadata?.promptTokenCount || 0,
          output: result.response.usageMetadata?.candidatesTokenCount || 0,
        },
      };
    }
  }

  /**
   * 会話履歴の最後の応答から完全なレスポンスを抽出する
   * @param history 会話履歴
   * @returns 応答テキストと使用トークン情報
   */
  private processFullResponse(history: ChatHistory): { text: string; usage: { input: number; output: number } } {
    const messages = history.getMessages();
    const lastMessage = messages[messages.length - 1];
    
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return {
        text: '',
        usage: { input: 0, output: 0 }
      };
    }
    
    // テキスト内容を抽出
    if (typeof lastMessage.content === 'string') {
      return {
        text: lastMessage.content,
        usage: { input: 0, output: 0 }
      };
    } else if (Array.isArray(lastMessage.content)) {
      // 配列形式から通常のテキスト部分を抽出
      const textParts = lastMessage.content
        .filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('');
      
      return {
        text: textParts,
        usage: { input: 0, output: 0 }
      };
    }
    
    return {
      text: '',
      usage: { input: 0, output: 0 }
    };
  }

  /**
   * 連続ツール実行を処理する
   * @param history 会話履歴
   * @param initialResponse 初期応答
   * @returns 応答テキストと使用トークン情報、または処理しなかった場合はnull
   */
  private async handleSequentialToolExecution(
    history: ChatHistory,
    initialResponse: ChatMessage
  ): Promise<{ text: string; usage: { input: number; output: number } } | null> {
    // ToolExecutionManagerを使用して連続実行
    if (this.toolExecutionManager) {
      try {
        // 初期応答から関数呼び出しを確認
        if (Array.isArray(initialResponse.content) && 
            initialResponse.content.some(part => part.type === 'function_call')) {
          
          // ファンクションコールを抽出
          const functionCallPart = initialResponse.content.find(part => 
            part.type === 'function_call' && 
            'function_call' in part
          );
          
          if (functionCallPart && 
              'function_call' in functionCallPart && 
              functionCallPart.function_call && 
              functionCallPart.function_call.name === 'attempt_completion') {
            
            // タスク完了の場合
            const resultText = functionCallPart.function_call.arguments.result;
            const command = functionCallPart.function_call.arguments.command;
            
            // タスク完了コールバックが設定されている場合は呼び出す
            if (this.options.onTaskCompleted) {
              await this.options.onTaskCompleted(resultText, command);
            }
            
            return {
              text: resultText,
              usage: { input: 0, output: 0 }
            };
          }
          
          // 通常のツール実行の場合
          const isCompleted = await this.toolExecutionManager.executeToolsSequentially('');
          
          if (isCompleted) {
            // 最後のメッセージからタスク完了を確認
            const lastMessages = history.getMessages();
            const lastMessage = lastMessages[lastMessages.length - 1];
            
            if (Array.isArray(lastMessage.content)) {
              // function_callから完了メッセージを抽出
              const functionCallPart = lastMessage.content.find(part => 
                part.type === 'function_call' && 
                'function_call' in part && 
                part.function_call?.name === 'attempt_completion'
              );
              
              if (functionCallPart && 'function_call' in functionCallPart && functionCallPart.function_call) {
                const resultText = functionCallPart.function_call.arguments.result;
                const command = functionCallPart.function_call.arguments.command;
                
                // タスク完了コールバックが設定されている場合は呼び出す
                if (this.options.onTaskCompleted) {
                  await this.options.onTaskCompleted(resultText, command);
                }
                
                return {
                  text: resultText,
                  usage: { input: 0, output: 0 }
                };
              }
            }
          }
        }
        
        // 通常のレスポンス処理
        return this.processFullResponse(history);
      } catch (error) {
        console.error('連続ツール実行エラー:', error);
        return {
          text: `ツール実行中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
          usage: { input: 0, output: 0 }
        };
      }
    }
    
    return null;
  }

  /**
   * プロンプトを完成させる
   * @param prompt プロンプト
   * @returns 完成したプロンプト
   */
  async completePrompt(prompt: string): Promise<string> {
    try {
      const model = this.client.getGenerativeModel({
          model: this.getModel().id,
      }, {
          baseUrl: this.options.baseUrl,
      });

      const generateContentOptions = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: this.options.maxTokens || this.getModel().info.maxTokens,
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        }
      };

      const result = await model.generateContent(generateContentOptions);
      return result.response.text();
    } catch (error) {
      console.error('プロンプト完成エラー:', error);
      throw error;
    }
  }

  /**
   * 関数呼び出し機能を使ってメッセージを送信する
   * @param messages メッセージ履歴
   * @param functions 関数定義
   * @returns 応答メッセージ
   */
  async sendMessageWithFunctions(
    messages: ChatMessage[],
    functions: Array<{
      name: string;
      description?: string;
      parameters: Record<string, any>;
    }>
  ): Promise<ChatMessage> {
    try {
      // 常にfunctionCallingMode: 'ANY'を使用
      const functionDeclarations = functions.map(func => ({
        name: func.name,
        description: func.description || '',
        parameters: {
          type: SchemaType.OBJECT,
          properties: convertParametersFormat(func.parameters),
          required: this.getFunctionRequiredParams(func.name)
        } as FunctionDeclarationSchema
      }));
      
      const model = this.client.getGenerativeModel({
          model: this.getModel().id,
        tools: [{
          functionDeclarations
        }],
        toolConfig: {
          functionCallingConfig: {
            mode: DEFAULT_FUNCTION_CALLING_MODE
          }
        }
      }, {
        baseUrl: this.options.baseUrl,
      });

      const result = await model.generateContent({
        contents: messages.map(convertChatMessageToGemini),
        generationConfig: {
          maxOutputTokens: this.options.maxTokens || this.getModel().info.maxTokens,
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        }
      });

      const response = result.response;
      
      // 関数呼び出しを含む応答を変換
      const candidates = response.candidates || [];
      if (candidates.length > 0 && candidates[0].content) {
        const content = candidates[0].content;
        const parts = content.parts || [];
        
        // 関数呼び出しがある場合
        const functionCalls = parts.filter(part => part.functionCall).map(part => part.functionCall);
        if (functionCalls.length > 0 && functionCalls[0]) {
          const functionCall = functionCalls[0];
          
        return {
            role: 'assistant',
          content: [
            {
                type: 'function_call',
              function_call: {
                  name: functionCall.name || '',
                  arguments: functionCall.args || {}
                }
              }
            ],
            ts: Date.now()
          };
        }
        
        // テキスト応答の場合
        const textContent = content.parts
          ?.filter(part => typeof part.text === 'string')
          .map(part => part.text as string)
          .join('') || '';
        
        const chatMessage: ChatMessage = {
          role: 'assistant',
          content: textContent,
          ts: Date.now()
        };
        
        return chatMessage;
      }
      
      // 応答がなかった場合のフォールバック
      return {
        role: 'assistant',
        content: '',
        ts: Date.now()
      };
    } catch (error) {
      console.error('関数呼び出し機能エラー:', error);
      
      // エラー応答を返す
      return {
        role: 'assistant',
        content: `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
        ts: Date.now()
      };
    }
  }

  /**
   * 関数レスポンスを送信して新しい応答を取得する
   * @param messages メッセージ履歴
   * @param functionName 関数名
   * @param functionResponse 関数の応答
   * @returns 新しいアシスタントメッセージ
   */
  async sendFunctionResponse(
    messages: ChatMessage[],
    functionName: string,
    functionResponse: any
  ): Promise<ChatMessage> {
    try {
      // 会話履歴をGeminiAPIフォーマットに変換
      const contents = messages.map(msg => convertChatMessageToGemini(msg));
      
      // モデルを初期化
      const model = this.client.getGenerativeModel({
          model: this.getModel().id,
      }, {
          baseUrl: this.options.baseUrl,
      });
      
      // 関数レスポンスを追加
      const functionResponseContent = {
        role: 'user',
        parts: [{
          functionResponse: {
            name: functionName,
            response: typeof functionResponse === 'string' 
              ? { content: functionResponse } 
              : functionResponse
          }
        }]
      };
      
      // 関数レスポンスを含めてコンテンツを生成
      const result = await model.generateContent({
        contents: [...contents, functionResponseContent],
        generationConfig: {
          maxOutputTokens: this.options.maxTokens || this.getModel().info.maxTokens,
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        }
      });

      const response = result.response;
      
      // 応答を変換
      const candidates = response.candidates || [];
      if (candidates.length > 0 && candidates[0].content) {
        const content = candidates[0].content;
        const parts = content.parts || [];
        
        // 関数呼び出しがある場合
        const functionCalls = parts.filter(part => part.functionCall).map(part => part.functionCall);
        if (functionCalls.length > 0 && functionCalls[0]) {
          const functionCall = functionCalls[0];
          
        return {
            role: 'assistant',
          content: [
            {
                type: 'function_call',
              function_call: {
                  name: functionCall.name || '',
                  arguments: functionCall.args || {}
                }
              }
            ],
            ts: Date.now()
          };
        }
        
        // テキスト応答の場合
        const textContent = content.parts
          ?.filter(part => typeof part.text === 'string')
          .map(part => part.text as string)
          .join('') || '';
        
        return {
          role: 'assistant',
          content: textContent,
          ts: Date.now()
        };
      }
      
      // 応答がなかった場合のフォールバック
      return {
        role: 'assistant',
        content: '',
        ts: Date.now()
      };
    } catch (error) {
      console.error('関数レスポンス送信エラー:', error);
      
      // エラー応答を返す
      return {
        role: 'assistant',
        content: `エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
        ts: Date.now()
      };
    }
  }

  /**
   * フォローアップ質問を処理する
   * @param question 質問内容
   * @param onAskFollowup フォローアップ質問コールバック
   * @returns 応答テキスト
   */
  async handleFollowupQuestion(
    question: string,
    onAskFollowup: (question: string) => Promise<string>
  ): Promise<string> {
    try {
      // ユーザーに質問を投げて回答を取得
      const answer = await onAskFollowup(question);
      return answer;
    } catch (error) {
      console.error('フォローアップ質問エラー:', error);
      throw new Error(`フォローアップ質問の処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * タスク完了を処理する
   * @param result 完了結果
   * @param command 実行コマンド（オプション）
   * @returns 応答テキスト
   */
  async handleTaskCompletion(result: string, command?: string): Promise<string> {
    try {
      if (this.options.onTaskCompleted) {
        await this.options.onTaskCompleted(result, command);
        return `タスクが完了しました: ${result}`;
      }
      return result;
    } catch (error) {
      console.error('タスク完了処理エラー:', error);
      throw new Error(`タスク完了の処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 関数の必須パラメータを取得する
   * @param functionName 関数名
   * @returns 必須パラメータのリスト
   */
  private getFunctionRequiredParams(functionName: string): string[] {
    if (!this.options.tools) {
      return [];
    }
    
    const tool = this.options.tools.find(t => t.name === functionName);
    if (tool && tool.parameters && tool.parameters.required) {
      return tool.parameters.required;
    }
    
    return [];
  }
}

/**
 * パラメータ形式を変換する
 * @param properties プロパティ定義
 * @returns 変換されたプロパティ定義
 */
function convertParametersFormat(properties: Record<string, PropertyType>): any {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(properties)) {
    result[key] = {
      type: value.type,
      description: value.description || ''
    };
    
    // 配列型の場合はitemsを追加
    if (value.type === 'array' && value.items) {
      result[key].items = value.items;
    }
  }
  
  return result;
} 