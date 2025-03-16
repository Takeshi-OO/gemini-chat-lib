// .env.localファイルから環境変数を読み込む
require('dotenv').config({ path: '.env.local' });

const { GeminiHandler } = require('./dist/gemini/gemini-handler');

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

async function testGemini() {
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

    // 簡単なメッセージを送信
    console.log('メッセージを送信中: "こんにちは、元気ですか？"');
    const systemPrompt = "あなたは親切なアシスタントです。簡潔に回答してください。";
    const messages = [
      {
        role: "user",
        content: "こんにちは、元気ですか？"
      }
    ];
    
    // ストリーミングレスポンスを取得
    console.log('ストリーミングレスポンスを取得中...');
    let fullResponse = '';
    for await (const chunk of gemini.createMessage(systemPrompt, messages)) {
      if (chunk.type === "text") {
        process.stdout.write(chunk.text);
        fullResponse += chunk.text;
      } else if (chunk.type === "usage") {
        console.log('\n\n使用トークン:');
        console.log(`入力: ${chunk.inputTokens}`);
        console.log(`出力: ${chunk.outputTokens}`);
        console.log(`合計: ${chunk.inputTokens + chunk.outputTokens}`);
      }
    }
    
    console.log('\n\n完全なレスポンス:');
    console.log(fullResponse);
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// テスト実行
testGemini(); 