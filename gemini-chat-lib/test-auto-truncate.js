// .env.localファイルから環境変数を読み込む
require('dotenv').config({ path: '.env.local' });

const { GeminiHandler } = require('./dist/gemini/gemini-handler');
const { ChatHistory } = require('./dist/conversation/message-history');
const { truncateConversation, estimateTokenCount } = require('./dist/utils/sliding-window');

// 環境変数からAPIキーを取得
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('エラー: GEMINI_API_KEYが設定されていません。.env.localファイルを確認してください。');
  process.exit(1);
}

// オプション設定も環境変数から取得
const modelId = process.env.GEMINI_MODEL_ID;
const baseUrl = process.env.GEMINI_BASE_URL || undefined;
const temperature = process.env.GEMINI_TEMPERATURE ? parseFloat(process.env.GEMINI_TEMPERATURE) : undefined;
const maxTokens = process.env.GEMINI_MAX_TOKENS ? parseInt(process.env.GEMINI_MAX_TOKENS) : undefined;

/**
 * 会話履歴の自動削減機能をテストする関数
 */
async function testAutoTruncate() {
  try {
    console.log('Geminiハンドラーを初期化中...');
    console.log(`モデル: ${modelId || 'デフォルト'}`);
    
    // Geminiハンドラーを初期化
    const gemini = new GeminiHandler({
      apiKey,
      modelId,
      baseUrl,
      temperature,
      maxTokens
    });

    // モデル情報を取得
    const model = gemini.getModel();
    console.log(`使用するモデル: ${model.id}`);
    console.log(`通常のコンテキストウィンドウ: ${model.info.contextWindow}トークン`);
    console.log(`通常の最大出力トークン: ${model.info.maxTokens}トークン`);
    
    // 会話履歴を初期化（テスト用に小さいコンテキストサイズを設定）
    const testContextWindow = 1000; // テスト用の小さいコンテキストウィンドウ
    const testMaxTokens = 100;     // テスト用の小さい最大トークン数
    
    console.log(`\nテスト用に設定するコンテキストウィンドウ: ${testContextWindow}トークン`);
    console.log(`テスト用に設定する最大出力トークン: ${testMaxTokens}トークン`);
    
    const conversation = new ChatHistory({
      modelMaxTokens: testMaxTokens,
      contextWindow: testContextWindow
    });
    
    // テスト用に会話履歴にダミーメッセージを追加
    console.log('\n--- ダミーメッセージの追加 ---');
    
    // 非常に長いダミーメッセージを生成（自動削減をトリガーするため）
    const longMessage = '長いメッセージ。'.repeat(100); // 100回繰り返し
    const longMessageTokens = estimateTokenCount(longMessage);
    console.log(`長いメッセージのトークン数（推定）: ${longMessageTokens}`);
    
    // ユーザーからの最初のメッセージ
    console.log('最初のメッセージを追加します...');
    conversation.addMessage({
      role: "user",
      content: "こんにちは、これは最初のメッセージです。",
      ts: Date.now() - 10000
    });
    
    // アシスタントからの応答
    console.log('アシスタントの応答を追加します...');
    conversation.addMessage({
      role: "assistant",
      content: "こんにちは、お手伝いできることはありますか？",
      ts: Date.now() - 9000
    });
    
    // ユーザーからの長いメッセージ（自動削減のトリガー）
    console.log('ユーザーからの長いメッセージを追加します（自動削減をトリガー）...');
    const beforeCount = conversation.getMessages().length;
    
    conversation.addMessage({
      role: "user",
      content: longMessage,
      ts: Date.now() - 8000
    });
    
    const afterCount = conversation.getMessages().length;
    
    console.log(`削減前のメッセージ数: ${beforeCount}`);
    console.log(`削減後のメッセージ数: ${afterCount}`);
    
    if (beforeCount !== afterCount) {
      console.log('会話履歴が自動的に削減されました！');
    } else {
      console.log('メッセージが短すぎるか、削減条件を満たしませんでした。');
      console.log('より長いメッセージを使うか、コンテキストウィンドウの設定を小さくしてテストしてください。');
    }
    
    // 手動で削減をテスト
    console.log('\n--- 手動削減のテスト ---');
    
    // さらにいくつかメッセージを追加
    for (let i = 0; i < 10; i++) {
      conversation.addMessage({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `これはテストメッセージ ${i + 1} です。`,
        ts: Date.now() - (7000 - i * 500)
      });
    }
    
    console.log(`現在のメッセージ数: ${conversation.getMessages().length}`);
    
    // 手動で会話履歴を削減（50%）
    const messages = conversation.getMessages();
    const truncatedMessages = truncateConversation(messages, 0.5);
    
    console.log(`削減前のメッセージ数: ${messages.length}`);
    console.log(`削減後のメッセージ数: ${truncatedMessages.length}`);
    console.log(`削減されたメッセージ数: ${messages.length - truncatedMessages.length}`);
    
    console.log('\n--- 会話履歴 ---');
    console.log('最初の3つのメッセージ:');
    const firstThree = truncatedMessages.slice(0, 3);
    firstThree.forEach((msg, i) => {
      console.log(`${i + 1}. [${msg.role}] ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    });
    
    console.log('\n最後の3つのメッセージ:');
    const lastThree = truncatedMessages.slice(-3);
    lastThree.forEach((msg, i) => {
      const index = truncatedMessages.length - 3 + i;
      console.log(`${index + 1}. [${msg.role}] ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    });
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// テスト実行
testAutoTruncate(); 