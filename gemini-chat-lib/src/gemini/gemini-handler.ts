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
const DEFAULT_FUNCTION_CALLING_MODE = 'ANY';

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
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
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
            
            // 再帰的に処理を続行（新しい会話履歴で）
            return this.sendMessage('', history, options);
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
      
      // 連続ツール実行を処理
      const result = await this.handleSequentialToolExecution(history, functionCallResponse);
      if (result) {
        return result;
      }
      
      // 連続ツール実行がない、またはタスク完了した場合は通常の応答を返す
      return {
        text: typeof functionCallResponse.content === 'string' ? 
              functionCallResponse.content : 
              JSON.stringify(functionCallResponse.content),
        usage: { input: 0, output: 0 }
      };
    }
    
    // 通常のメッセージ送信（関数呼び出しなし）
    let fullResponse = "";
    let inputTokens = 0;
    let outputTokens = 0;
    
    for await (const chunk of this.createMessage(systemPrompt, history.getMessages())) {
      if (chunk.type === "text") {
        fullResponse += chunk.text;
      } else if (chunk.type === "usage") {
        inputTokens = chunk.inputTokens;
        outputTokens = chunk.outputTokens;
      }
    }
    
    // 応答を会話履歴に追加
    history.addMessage({
      role: "assistant",
      content: fullResponse,
      ts: Date.now(),
    });
    
    return {
      text: fullResponse,
      usage: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }

  /**
   * 連続ツール実行を処理する
   * @param history 会話履歴
   * @param initialResponse 初期応答
   * @returns 処理結果（ある場合）
   */
  private async handleSequentialToolExecution(
    history: ChatHistory,
    initialResponse: ChatMessage
  ): Promise<{ text: string; usage: { input: number; output: number } } | null> {
    // 関数呼び出しがあるか確認
    if (!initialResponse.content || typeof initialResponse.content === 'string') {
      return null;
    }
    
    const functionCallContent = Array.isArray(initialResponse.content)
      ? initialResponse.content.find(item => item.type === 'function_call')
      : undefined;
    
    if (!functionCallContent || !('function_call' in functionCallContent)) {
      return null;
    }
    
    // ツール実行マネージャーを初期化
    this.toolExecutionManager = new ToolExecutionManager({
      tools: this.options.tools || [],
      chatHistory: history,
      toolsRequiringApproval: this.options.toolsRequiringApproval || ['write_to_file', 'edit_file'],
      onToolApprovalRequired: this.options.onToolApprovalRequired,
      onToolExecutionCompleted: this.options.onToolExecutionCompleted,
    });
    
    // 連続ツール実行を実行
    const taskCompleted = await this.toolExecutionManager.executeToolsSequentially(
      initialResponse,
      async (messages) => {
        // 新しい応答を生成する関数
        const functions = this.options.tools?.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters.properties
        })) || [];
        
        // allowed_function_namesは使用しない
        return await this.sendMessageWithFunctions(messages, functions);
      }
    );
    
    // タスク完了ツールが呼び出された場合
    if (taskCompleted) {
      const lastMessage = history.getMessages().slice(-1)[0];
      if (lastMessage.role === 'assistant' && Array.isArray(lastMessage.content)) {
        const functionCall = lastMessage.content.find(item => 
          item.type === 'function_call' && 
          'function_call' in item && 
          item.function_call?.name === 'attempt_completion'
        );
        
        if (functionCall && 'function_call' in functionCall && functionCall.function_call) {
          const completionResult = functionCall.function_call.arguments.result;
          const completionCommand = functionCall.function_call.arguments.command;
          
          // タスク完了を処理
          await this.handleTaskCompletion(completionResult, completionCommand);
          
          // 結果を会話履歴に追加
          const completionMessage = {
            role: "assistant" as const,
            content: `<タスク完了>\n${completionResult}`,
            ts: Date.now(),
          };
          history.addMessage(completionMessage);
          
          return {
            text: completionMessage.content,
            usage: { input: 0, output: 0 }
          };
        }
      }
    }
    
    // タスク完了していない場合はnullを返す
    return null;
  }

  /**
   * プロンプトを送信し、応答を受け取る（ストリームなし）
   * @param prompt プロンプト
   * @returns 応答テキスト
   */
  async completePrompt(prompt: string): Promise<string> {
    try {
      const model = this.client.getGenerativeModel(
        {
          model: this.getModel().id,
        },
        {
          baseUrl: this.options.baseUrl,
        }
      );

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        },
      });

      return result.response.text();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Gemini completion error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 関数呼び出しを強制的に行うメッセージを送信する
   * @param messages メッセージ履歴
   * @param functions 利用可能な関数の定義
   * @returns 応答
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
      const model = this.client.getGenerativeModel(
        {
          model: this.getModel().id,
          generationConfig: {
            temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
          }
        },
        {
          baseUrl: this.options.baseUrl,
        }
      );

      // 関数定義をツールとして設定
      const tools = functions.map((fn) => {
        // ツールの名前を使って元のツール定義を探す
        const originalTool = this.options.tools?.find(t => t.name === fn.name);
        
        return {
          functionDeclarations: [
            {
              name: fn.name,
              description: fn.description || "",
              parameters: {
                type: SchemaType.OBJECT,
                properties: originalTool 
                  ? convertParametersFormat(originalTool.parameters.properties)
                  : (typeof fn.parameters === 'object' ? fn.parameters : {}),
                required: this.getFunctionRequiredParams(fn.name)
              } as FunctionDeclarationSchema,
            },
          ],
        };
      });

      // functionCallingConfigの設定（allowed_function_namesは使用しない）
      const functionCallingConfig = {
        mode: FunctionCallingMode.ANY
      };

      const result = await model.generateContent({
        contents: messages.map((msg) => convertChatMessageToGemini(msg)),
        generationConfig: {
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        },
        tools,
        toolConfig: {
          functionCallingConfig
        }
      });

      const response = result.response;
      const functionCall = response.candidates?.[0]?.content?.parts?.find(
        (part) => "functionCall" in part
      );

      if (functionCall && "functionCall" in functionCall) {
        // 関数呼び出しがある場合
        const { name, args } = functionCall.functionCall as { name: string; args: Record<string, any> };
        return {
          role: "assistant",
          content: [
            {
              type: "function_call",
              function_call: {
                name,
                arguments: args,
              },
            },
          ],
          ts: Date.now(),
        };
      } else {
        // 通常のテキスト応答の場合
        return {
          role: "assistant",
          content: response.text(),
          ts: Date.now(),
        };
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Gemini function calling error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 関数の実行結果を送信する
   * @param messages メッセージ履歴
   * @param functionName 関数名
   * @param functionResponse 関数の実行結果
   * @returns 応答
   */
  async sendFunctionResponse(
    messages: ChatMessage[],
    functionName: string,
    functionResponse: any
  ): Promise<ChatMessage> {
    try {
      // 関数の実行結果をメッセージに追加
      const updatedMessages = [
        ...messages,
        {
          role: "user" as const,
          content: [
            {
              type: "function_response" as const,
              function_response: {
                name: functionName,
                response: functionResponse,
              },
            },
          ],
          ts: Date.now(),
        }
      ];

      // 応答を取得
      const model = this.client.getGenerativeModel(
        {
          model: this.getModel().id,
        },
        {
          baseUrl: this.options.baseUrl,
        }
      );

      // 常にANYモードを使用
      const toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY
        }
      };

      const tools = this.options.tools?.map(tool => ({
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description || "",
            parameters: {
              type: SchemaType.OBJECT,
              properties: tool.parameters.properties,
            } as FunctionDeclarationSchema,
          }
        ]
      }));

      const result = await model.generateContent({
        contents: updatedMessages.map((msg) => convertChatMessageToGemini(msg)),
        generationConfig: {
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        },
        tools: tools && tools.length > 0 ? tools : undefined,
        toolConfig
      });

      const response = result.response;
      const functionCall = response.candidates?.[0]?.content?.parts?.find(
        (part) => "functionCall" in part
      );

      if (functionCall && "functionCall" in functionCall) {
        // 関数呼び出しがある場合
        const { name, args } = functionCall.functionCall as { name: string; args: Record<string, any> };
        return {
          role: "assistant",
          content: [
            {
              type: "function_call",
              function_call: {
                name,
                arguments: args,
              },
            },
          ],
          ts: Date.now(),
        };
      } else {
        // 通常のテキスト応答の場合
        return {
          role: "assistant",
          content: response.text(),
          ts: Date.now(),
        };
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Gemini function response error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * フォローアップ質問を処理する
   * この関数は、AIがask_followup_questionツールを使用した場合に呼び出される
   * @param question ユーザーに尋ねる質問
   * @param onAskFollowup フォローアップ質問をユーザーに提示し、回答を受け取るコールバック関数
   * @returns ユーザーからの回答
   */
  async handleFollowupQuestion(
    question: string,
    onAskFollowup: (question: string) => Promise<string>
  ): Promise<string> {
    try {
      // フォローアップ質問をユーザーに提示し、回答を取得
      const answer = await onAskFollowup(question);
      return answer;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`フォローアップ質問処理エラー: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * タスク完了を処理する
   * @param result タスク完了の結果
   * @param command デモ用のコマンド（オプション）
   * @returns 処理結果
   */
  async handleTaskCompletion(result: string, command?: string): Promise<string> {
    try {
      // タスク完了イベントをコールバックで通知
      if (this.options.onTaskCompleted) {
        await this.options.onTaskCompleted(result, command);
      }
      
      let response = `<タスク完了>\n${result}`;
      
      if (command) {
        response += `\n\n実行コマンド: ${command}`;
      }
      
      return response;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`タスク完了処理エラー: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 関数の必須パラメータリストを取得する
   * @param functionName 関数名
   * @returns 必須パラメータの配列
   */
  private getFunctionRequiredParams(functionName: string): string[] {
    if (!this.options.tools) return [];
    
    const tool = this.options.tools.find(t => t.name === functionName);
    if (!tool) return [];
    
    return tool.parameters.required || [];
  }
}

/**
 * ツールのパラメータ形式をGemini APIに適したフォーマットに変換する
 * @param properties パラメータのプロパティ
 * @returns 変換されたプロパティ
 */
function convertParametersFormat(properties: Record<string, PropertyType>): any {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(properties)) {
    // データ型の変換（JavaScriptの型名をGemini APIの型名に変換）
    let type: string;
    switch (value.type.toLowerCase()) {
      case 'string':
        type = SchemaType.STRING;
        break;
      case 'integer':
      case 'number':
        type = SchemaType.NUMBER;
        break;
      case 'boolean':
        type = SchemaType.BOOLEAN;
        break;
      case 'array':
        type = SchemaType.ARRAY;
        break;
      case 'object':
        type = SchemaType.OBJECT;
        break;
      default:
        type = SchemaType.STRING;
    }
    
    result[key] = {
      type,
      description: value.description
    };
    
    // itemsフィールドがある場合は追加
    if (value.items) {
      result[key].items = {
        type: value.items.type.toUpperCase()
      };
    }
  }
  
  return result;
} 