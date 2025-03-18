import { GeminiHandler } from "../gemini/gemini-handler";
import { ChatMessage } from "../conversation/types";

/**
 * デフォルトのコンテキストウィンドウの何パーセントをバッファとして使用するか
 */
export const TOKEN_BUFFER_PERCENTAGE = 0.1;

/**
 * メッセージの内容からトークン数を推定する関数
 * @param content メッセージの内容
 * @returns 推定トークン数
 */
export function estimateTokenCount(content: string): number {
  // 簡易的なトークン数推定: 英語では平均的に1単語が1.33トークン
  // 日本語では1文字が1トークン程度と仮定
  return Math.ceil(content.length);
}

/**
 * 会話履歴を削減する関数
 * 最初のメッセージは常に保持し、指定された割合のメッセージを削除する
 * 
 * @param messages 会話メッセージの配列
 * @param fracToRemove 削除するメッセージの割合（0から1の間）
 * @returns 削減された会話メッセージの配列
 */
export function truncateConversation(
  messages: ChatMessage[],
  fracToRemove: number
): ChatMessage[] {
  if (messages.length <= 1 || fracToRemove <= 0) {
    return [...messages];
  }

  // 最初のメッセージは保持
  const firstMessage = messages[0];
  
  // 削除するメッセージ数を計算（偶数になるように丸める）
  const messagesAfterFirst = messages.length - 1;
  const rawMessagesToRemove = Math.floor(messagesAfterFirst * fracToRemove);
  
  // 偶数になるように調整（ユーザー/アシスタントのペアを維持するため）
  const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2);
  
  if (messagesToRemove <= 0) {
    return [...messages];
  }
  
  // 削減されたメッセージを作成
  const remainingMessages = messages.slice(messagesToRemove + 1);
  return [firstMessage, ...remainingMessages];
}

/**
 * 必要に応じて会話履歴を自動的に削減する関数
 * 
 * @param options 削減オプション
 * @returns 元のメッセージまたは削減されたメッセージの配列
 */
export function truncateConversationIfNeeded({
  messages,
  modelMaxTokens,
  contextWindow,
}: {
  messages: ChatMessage[];
  modelMaxTokens: number;
  contextWindow: number;
}): ChatMessage[] {
  if (messages.length <= 1) {
    return [...messages];
  }

  // 応答用に確保するトークン数
  const reservedTokens = modelMaxTokens * 0.2;

  // メッセージの総トークン数を計算
  let totalTokens = 0;
  messages.forEach(msg => {
    if (typeof msg.content === 'string') {
      totalTokens += estimateTokenCount(msg.content);
    }
  });

  // デバッグ用：トークン数を出力
  console.log(`総トークン数: ${totalTokens}, 許容トークン数: ${contextWindow * (1 - TOKEN_BUFFER_PERCENTAGE) - reservedTokens}`);

  // 会話履歴用に使用可能なトークン数
  const allowedTokens = contextWindow * (1 - TOKEN_BUFFER_PERCENTAGE) - reservedTokens;

  // 総トークン数が許容範囲を超えている場合は削減
  if (totalTokens > allowedTokens) {
    const truncated = truncateConversation(messages, 0.5);
    console.log(`会話履歴を削減しました: ${messages.length} → ${truncated.length}`);
    return truncated;
  }
  
  return [...messages];
} 