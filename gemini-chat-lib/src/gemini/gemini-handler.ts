import { GoogleGenerativeAI, FunctionDeclarationSchema, FunctionCallingMode } from "@google/generative-ai";
import { ChatMessage } from "../conversation/types";
import { convertChatMessageToGemini } from "./format-converter";
import { ApiStream } from "./stream";
import { GeminiModelId, ModelInfo, geminiDefaultModelId, geminiModels } from "./models";
import { ChatHistory } from "../conversation/message-history";
import { FunctionTool } from "../utils/function-tools";

const GEMINI_DEFAULT_TEMPERATURE = 0;

export interface GeminiHandlerOptions {
  apiKey: string;
  modelId?: GeminiModelId;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  functionCallingMode?: 'ANY' | 'AUTO' | 'NONE';
  tools?: FunctionTool[];
}

/**
 * Gemini APIを扱うハンドラークラス
 */
export class GeminiHandler {
  private readonly client: GoogleGenerativeAI;
  private readonly options: {
    apiKey: string;
    modelId?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    functionCallingMode?: 'ANY' | 'AUTO' | 'NONE';
    tools?: FunctionTool[];
  };

  /**
   * コンストラクタ
   * @param options オプション
   */
  constructor(options: {
    apiKey: string;
    modelId?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    functionCallingMode?: 'ANY' | 'AUTO' | 'NONE';
    tools?: FunctionTool[];
  }) {
    this.options = options;
    this.client = new GoogleGenerativeAI(options.apiKey);
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
    if (this.options.functionCallingMode && this.options.tools && this.options.tools.length > 0) {
      // ツールの定義を作成
      const tools = this.options.tools.map((tool) => ({
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description || "",
            parameters: {
              type: "OBJECT",
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
          mode: this.options.functionCallingMode,
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
   * @returns 応答テキストと使用トークン情報
   */
  async sendMessage(
    message: string,
    conversation?: ChatHistory
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

    // 関数呼び出しモードが設定されていて、ツールも提供されている場合
    if (this.options.functionCallingMode === 'ANY' && this.options.tools && this.options.tools.length > 0) {
      // sendMessageWithFunctionsを使用して関数呼び出しを強制
      const allToolNames = this.options.tools.map(tool => tool.name);
      
      // 関数呼び出し用のメッセージを作成
      const functionCallResponse = await this.sendMessageWithFunctions(
        history.getMessages(),
        this.options.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters.properties
        })),
        allToolNames
      );
      
      // 応答を会話履歴に追加
      history.addMessage(functionCallResponse);
      
      // 関数呼び出しがあるか確認
      if (Array.isArray(functionCallResponse.content) && 
          functionCallResponse.content.length > 0 && 
          functionCallResponse.content[0].type === 'function_call') {
        const functionCallContent = functionCallResponse.content[0];
        if ('function_call' in functionCallContent && functionCallContent.function_call) {
          const functionCall = functionCallContent.function_call;
          // 関数実行
          const tool = this.options.tools.find(t => t.name === functionCall.name);
          if (tool) {
            const result = await tool.execute(functionCall.arguments);
            
            // 関数実行結果をAIに送信して応答を得る
            const finalResponse = await this.sendFunctionResponse(
              history.getMessages(),
              functionCall.name,
              result
            );
            
            // 応答を会話履歴に追加
            history.addMessage(finalResponse);
            
            return {
              text: typeof finalResponse.content === 'string' ? 
                    finalResponse.content : 
                    JSON.stringify(finalResponse.content),
              usage: { input: 0, output: 0 } // 正確なトークン使用量の取得は難しいため、仮の値を設定
            };
          }
        }
      }
      
      // 関数呼び出しがない場合や実行できなかった場合
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
   * 現在のモデル情報を取得
   * @returns モデルID、情報を含むオブジェクト
   */
  getModel() {
    const modelId = (this.options.modelId || geminiDefaultModelId) as GeminiModelId;
    const modelInfo = geminiModels[modelId] || geminiModels[geminiDefaultModelId];
    
    return {
      id: modelId,
      info: modelInfo,
    };
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
   * 関数呼び出しを含むメッセージを送信する
   * @param messages メッセージ履歴
   * @param functions 関数定義
   * @param allowedFunctionNames 許可する関数名の配列（指定した場合、これらの関数のみが呼び出される）
   * @returns 応答
   */
  async sendMessageWithFunctions(
    messages: ChatMessage[],
    functions: Array<{
      name: string;
      description?: string;
      parameters: Record<string, any>;
    }>,
    allowedFunctionNames?: string[]
  ): Promise<ChatMessage> {
    try {
      const model = this.client.getGenerativeModel(
        {
          model: this.getModel().id,
        },
        {
          baseUrl: this.options.baseUrl,
        }
      );

      // 関数定義をツールとして設定
      const tools = functions.map((fn) => ({
        functionDeclarations: [
          {
            name: fn.name,
            description: fn.description || "",
            parameters: {
              type: "OBJECT",
              properties: fn.parameters,
            } as FunctionDeclarationSchema,
          },
        ],
      }));

      // functionCallingConfigの設定
      const functionCallingConfig: {
        mode: typeof FunctionCallingMode.ANY;
        allowed_function_names?: string[];
      } = {
        mode: FunctionCallingMode.ANY
      };

      // 許可された関数名が指定されている場合、設定に追加
      if (allowedFunctionNames && allowedFunctionNames.length > 0) {
        functionCallingConfig.allowed_function_names = allowedFunctionNames;
      }

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
      },
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

    const result = await model.generateContent({
      contents: updatedMessages.map((msg) => convertChatMessageToGemini(msg)),
      generationConfig: {
        temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
      },
    });

    return {
      role: "assistant",
      content: result.response.text(),
      ts: Date.now(),
    };
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
}

/**
 * ツールのパラメータ形式をGemini APIに適したフォーマットに変換する
 * @param properties パラメータのプロパティ
 * @returns 変換されたプロパティ
 */
function convertParametersFormat(properties: Record<string, { type: string; description: string }>): any {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(properties)) {
    // データ型の変換（JavaScriptの型名をGemini APIの型名に変換）
    let type: string;
    switch (value.type.toLowerCase()) {
      case 'string':
        type = 'STRING';
        break;
      case 'integer':
      case 'number':
        type = 'NUMBER';
        break;
      case 'boolean':
        type = 'BOOLEAN';
        break;
      case 'array':
        type = 'ARRAY';
        break;
      case 'object':
        type = 'OBJECT';
        break;
      default:
        type = 'STRING';
    }
    
    result[key] = {
      type,
      description: value.description
    };
  }
  
  return result;
} 