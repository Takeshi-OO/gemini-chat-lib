import { GoogleGenerativeAI, FunctionDeclarationSchema } from "@google/generative-ai";
import { ChatMessage } from "../conversation/types";
import { convertChatMessageToGemini } from "./format-converter";
import { ApiStream } from "./stream";
import { GeminiModelId, ModelInfo, geminiDefaultModelId, geminiModels } from "./models";

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
  private client: GoogleGenerativeAI;
  private options: GeminiHandlerOptions;

  /**
   * コンストラクタ
   * @param options オプション
   */
  constructor(options: GeminiHandlerOptions) {
    this.options = options;
    this.client = new GoogleGenerativeAI(options.apiKey);
  }

  /**
   * メッセージを送信し、ストリームで応答を受け取る
   * @param systemPrompt システムプロンプト
   * @param messages メッセージ履歴
   * @returns ストリーム
   */
  async *createMessage(systemPrompt: string, messages: ChatMessage[]): ApiStream {
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
   * モデル情報を取得する
   * @returns モデル情報
   */
  getModel(): { id: GeminiModelId; info: ModelInfo } {
    const modelId = this.options.modelId;
    if (modelId && modelId in geminiModels) {
      return { id: modelId, info: geminiModels[modelId] };
    }
    return { id: geminiDefaultModelId, info: geminiModels[geminiDefaultModelId] };
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

      const result = await model.generateContent({
        contents: messages.map((msg) => convertChatMessageToGemini(msg)),
        generationConfig: {
          temperature: this.options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
        },
        tools,
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