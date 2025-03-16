import { Content, FunctionCallPart, FunctionResponsePart, InlineDataPart, Part, TextPart } from "@google/generative-ai";
import { ChatContent, ChatMessage } from "../conversation/types";

/**
 * ChatMessageの内容をGeminiのPart[]に変換する
 */
export function convertChatContentToGeminiParts(content: string | ChatContent[]): Part[] {
  if (typeof content === "string") {
    return [{ text: content } as TextPart];
  }

  return content.flatMap((block) => {
    switch (block.type) {
      case "text":
        return { text: block.text } as TextPart;
      case "image":
        if (!block.image_url?.url) {
          throw new Error("Image URL is required");
        }
        // Base64形式の画像データの場合
        if (block.image_url.url.startsWith("data:")) {
          const matches = block.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            throw new Error("Invalid image data URL");
          }
          const [, mimeType, data] = matches;
          return {
            inlineData: {
              data,
              mimeType,
            },
          } as InlineDataPart;
        }
        throw new Error("Only base64 image data is supported");
      case "function_call":
        if (!block.function_call) {
          throw new Error("Function call data is required");
        }
        return {
          functionCall: {
            name: block.function_call.name,
            args: block.function_call.arguments,
          },
        } as FunctionCallPart;
      case "function_response":
        if (!block.function_response) {
          throw new Error("Function response data is required");
        }
        return {
          functionResponse: {
            name: block.function_response.name,
            response: {
              name: block.function_response.name,
              content: JSON.stringify(block.function_response.response),
            },
          },
        } as FunctionResponsePart;
      default:
        throw new Error(`Unsupported content block type: ${(block as any).type}`);
    }
  });
}

/**
 * ChatMessageをGeminiのContentに変換する
 */
export function convertChatMessageToGemini(message: ChatMessage): Content {
  return {
    role: message.role === "assistant" ? "model" : message.role,
    parts: convertChatContentToGeminiParts(message.content),
  };
}

/**
 * 以下は元のRoo-Codeのコードを参考にした実装
 * Anthropicのメッセージ形式からGeminiのメッセージ形式に変換する
 */

// Anthropic SDKの型定義を簡略化
interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  source?: {
    type: string;
    data: string;
    media_type: string;
  };
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
}

/**
 * Anthropicのコンテンツブロックをgeminiのパーツに変換する
 */
export function convertAnthropicContentToGemini(content: string | AnthropicContentBlock[]): Part[] {
  if (typeof content === "string") {
    return [{ text: content } as TextPart];
  }

  return content.flatMap((block) => {
    switch (block.type) {
      case "text":
        return { text: block.text } as TextPart;
      case "image":
        if (block.source?.type !== "base64") {
          throw new Error("Unsupported image source type");
        }
        return {
          inlineData: {
            data: block.source.data,
            mimeType: block.source.media_type,
          },
        } as InlineDataPart;
      case "tool_use":
        return {
          functionCall: {
            name: block.name,
            args: block.input,
          },
        } as FunctionCallPart;
      case "tool_result":
        const name = block.tool_use_id?.split("-")[0] || "";
        if (!block.content) {
          return [];
        }
        if (typeof block.content === "string") {
          return {
            functionResponse: {
              name,
              response: {
                name,
                content: block.content,
              },
            },
          } as FunctionResponsePart;
        } else {
          // The only case when tool_result could be array is when the tool failed and we're providing ie user feedback potentially with images
          const textParts = block.content.filter((part) => part.type === "text");
          const imageParts = block.content.filter((part) => part.type === "image");
          const text = textParts.length > 0 ? textParts.map((part) => part.text).join("\n\n") : "";
          const imageText = imageParts.length > 0 ? "\n\n(See next part for image)" : "";
          return [
            {
              functionResponse: {
                name,
                response: {
                  name,
                  content: text + imageText,
                },
              },
            } as FunctionResponsePart,
            ...imageParts.map(
              (part) =>
                ({
                  inlineData: {
                    data: part.source?.data,
                    mimeType: part.source?.media_type,
                  },
                }) as InlineDataPart
            ),
          ];
        }
      default:
        throw new Error(`Unsupported content block type: ${(block as any).type}`);
    }
  });
}

/**
 * Anthropicのメッセージをgeminiのコンテンツに変換する
 */
export function convertAnthropicMessageToGemini(message: AnthropicMessage): Content {
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: convertAnthropicContentToGemini(message.content),
  };
} 