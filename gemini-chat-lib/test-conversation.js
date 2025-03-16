// .env.localファイルから環境変数を読み込む
require('dotenv').config({ path: '.env.local' });

const { GeminiHandler } = require('./dist/gemini/gemini-handler');
const { ChatHistory } = require('./dist/conversation/message-history');

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

async function testConversation() {
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

    // 会話を初期化
    const conversation = new ChatHistory();
    
    // 最初のメッセージを送信
    console.log('\n--- 最初のメッセージ ---');
    console.log('送信: "私の名前は田中です。"');
    
    const systemPrompt = "あなたは親切なアシスタントです。簡潔に回答してください。";
    const messages1 = [
      {
        role: "user",
        content: "私の名前は田中です。"
      }
    ];
    
    // 会話履歴に追加
    conversation.addMessage(messages1[0]);
    
    // ストリーミングレスポンスを取得
    console.log('応答を取得中...');
    let response1 = '';
    for await (const chunk of gemini.createMessage(systemPrompt, conversation.getMessages())) {
      if (chunk.type === "text") {
        process.stdout.write(chunk.text);
        response1 += chunk.text;
      }
    }
    
    // アシスタントの応答を会話履歴に追加
    conversation.addMessage({
      role: "assistant",
      content: response1
    });
    
    console.log('\n\n--- 会話履歴を使った2回目のメッセージ ---');
    console.log('送信: "私の名前は何ですか？"');
    
    // 2回目のメッセージを送信（会話履歴を使用）
    conversation.addMessage({
      role: "user",
      content: "私の名前は何ですか？"
    });
    
    // ストリーミングレスポンスを取得
    console.log('応答を取得中...');
    let response2 = '';
    for await (const chunk of gemini.createMessage(systemPrompt, conversation.getMessages())) {
      if (chunk.type === "text") {
        process.stdout.write(chunk.text);
        response2 += chunk.text;
      }
    }
    
    console.log('\n\n--- 会話履歴 ---');
    console.log(JSON.stringify(conversation.getMessages(), null, 2));
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// テスト実行
testConversation(); 