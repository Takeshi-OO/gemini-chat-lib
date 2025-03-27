import { ChatMessage, ClineMessage } from "./types";
import { truncateConversationIfNeeded } from "../utils/sliding-window";

/**
 * 会話履歴を管理するクラス
 * タスクID別のメッセージ管理と一般的なチャット履歴機能を提供
 */
export class ChatHistory {
  private messages: ChatMessage[] = [];
  private modelMaxTokens: number = 8192;  // デフォルト値
  private contextWindow: number = 131072; // デフォルト値
  private readonly taskMessages: Record<string, Record<number, ClineMessage>>;
  private readonly taskList: Record<string, number[]>;

  /**
   * コンストラクタ
   * @param options オプション
   */
  constructor(options?: { modelMaxTokens?: number; contextWindow?: number }) {
    if (options) {
      this.modelMaxTokens = options.modelMaxTokens || this.modelMaxTokens;
      this.contextWindow = options.contextWindow || this.contextWindow;
    }
    this.taskMessages = {};
    this.taskList = {};
  }

  /**
   * モデルのトークン制限を設定する
   * @param maxTokens 最大トークン数
   * @param contextWindow コンテキストウィンドウサイズ
   */
  public setModelLimits(maxTokens: number, contextWindow: number): void {
    this.modelMaxTokens = maxTokens;
    this.contextWindow = contextWindow;
  }

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

    // 会話履歴が長すぎる場合は自動で削減
    this.autoTruncateIfNeeded();
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

  /**
   * 必要に応じて会話履歴を自動的に削減する
   * @returns 削減されたかどうか
   */
  private autoTruncateIfNeeded(): boolean {
    if (this.messages.length <= 1) {
      return false;
    }

    const truncatedMessages = truncateConversationIfNeeded({
      messages: this.messages,
      modelMaxTokens: this.modelMaxTokens,
      contextWindow: this.contextWindow,
    });

    if (truncatedMessages.length !== this.messages.length) {
      this.messages = truncatedMessages;
      return true;
    }

    return false;
  }

  /**
   * タスク別会話履歴にメッセージを追加する
   * @param taskId タスクID
   * @param message 追加するメッセージ
   */
  public addTaskMessage(taskId: string, message: ClineMessage) {
    if (!this.taskMessages[taskId]) {
      this.taskMessages[taskId] = {};
    }

    this.taskMessages[taskId][message.ts] = message;

    if (!this.taskList[taskId]) {
      this.taskList[taskId] = [];
    }

    this.taskList[taskId].push(message.ts);
  }

  /**
   * タスク別会話履歴のメッセージを更新する
   * @param taskId タスクID
   * @param message 更新するメッセージ
   */
  public updateTaskMessage(taskId: string, message: ClineMessage) {
    if (this.taskMessages[taskId] && this.taskMessages[taskId][message.ts]) {
      this.taskMessages[taskId][message.ts] = message;
    }
  }

  /**
   * タスク別会話履歴のメッセージを取得する
   * @param taskId タスクID
   * @returns メッセージの配列
   */
  public getTaskMessages(taskId: string): ClineMessage[] {
    return (this.taskList[taskId] ?? [])
      .map((ts) => this.taskMessages[taskId][ts])
      .filter(Boolean);
  }

  /**
   * タスク履歴を持つすべてのタスクIDを取得する
   * @returns タスクIDの配列
   */
  public getAllTaskIds(): string[] {
    return Object.keys(this.taskList);
  }

  /**
   * 特定のタスクの履歴をクリアする
   * @param taskId タスクID
   */
  public clearTaskHistory(taskId: string): void {
    if (this.taskMessages[taskId]) {
      delete this.taskMessages[taskId];
    }
    
    if (this.taskList[taskId]) {
      delete this.taskList[taskId];
    }
  }
} 