import { GoogleGenerativeAI, FunctionDeclarationSchema, FunctionCallingMode } from "@google/generative-ai";
import { ChatMessage } from "../conversation/types";
import { convertChatMessageToGemini } from "./format-converter";
import { ApiStream } from "./stream";
import { GeminiModelId, ModelInfo, geminiDefaultModelId, geminiModels } from "./models";
import { ChatHistory } from "../conversation/message-history";

const GEMINI_DEFAULT_TEMPERATURE = 0;

export interface GeminiHandlerOptions {
  apiKey: string;
  modelId?: GeminiModelId;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
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

    const result = await model.generateContentStream({
      contents: messages.map(convertChatMessageToGemini),
      generationConfig: {
        maxOutputTokens: this.options.maxTokens || this.getModel().info.maxTokens,
        temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
      },
    });

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
} 