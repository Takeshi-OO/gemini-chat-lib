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