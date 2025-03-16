import { ChatMessage, ClineMessage } from "./types";

/**
 * 会話履歴を管理するクラス
 * 元のRoo-Codeのコードを参考に、シンプル化したもの
 */
export class MessageHistory {
  private readonly messages: Record<string, Record<number, ClineMessage>>;
  private readonly list: Record<string, number[]>;

  constructor() {
    this.messages = {};
    this.list = {};
  }

  /**
   * 会話履歴にメッセージを追加する
   * @param taskId タスクID
   * @param message 追加するメッセージ
   */
  public add(taskId: string, message: ClineMessage) {
    if (!this.messages[taskId]) {
      this.messages[taskId] = {};
    }

    this.messages[taskId][message.ts] = message;

    if (!this.list[taskId]) {
      this.list[taskId] = [];
    }

    this.list[taskId].push(message.ts);
  }

  /**
   * 会話履歴のメッセージを更新する
   * @param taskId タスクID
   * @param message 更新するメッセージ
   */
  public update(taskId: string, message: ClineMessage) {
    if (this.messages[taskId][message.ts]) {
      this.messages[taskId][message.ts] = message;
    }
  }

  /**
   * 会話履歴のメッセージを取得する
   * @param taskId タスクID
   * @returns メッセージの配列
   */
  public getMessages(taskId: string): ClineMessage[] {
    return (this.list[taskId] ?? [])
      .map((ts) => this.messages[taskId][ts])
      .filter(Boolean);
  }
}

/**
 * 新しいチャットメッセージ履歴管理クラス
 * より単純化されたインターフェースを提供
 */
export class ChatHistory {
  private messages: ChatMessage[] = [];

  /**
   * メッセージを追加する
   * @param message 追加するメッセージ
   */
  public addMessage(message: ChatMessage): void {
    // タイムスタンプがない場合は現在時刻を設定
    if (!message.ts) {
      message.ts = Date.now();
    }
    this.messages.push(message);
  }

  /**
   * すべてのメッセージを取得する
   * @returns メッセージの配列
   */
  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * すべてのメッセージをクリアする
   */
  public clearMessages(): void {
    this.messages = [];
  }

  /**
   * 特定のインデックス以降のメッセージを削除する
   * @param index 削除開始インデックス
   */
  public truncateMessages(index: number): void {
    if (index >= 0 && index < this.messages.length) {
      this.messages = this.messages.slice(0, index);
    }
  }
} 