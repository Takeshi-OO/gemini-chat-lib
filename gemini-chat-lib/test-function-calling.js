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

// 天気情報を取得する関数（実際のAPIの代わりにモックデータを返す）
function getWeatherInfo(location, unit = 'celsius') {
  console.log(`天気情報を取得中: ${location}, 単位: ${unit}`);
  
  // モックデータ
  const weatherData = {
    location: location,
    temperature: unit === 'celsius' ? 22 : 71.6,
    condition: '晴れ',
    humidity: 45,
    unit: unit
  };
  
  return weatherData;
}

async function testFunctionCalling() {
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

    // 関数を定義
    const functions = [
      {
        name: 'get_weather',
        description: '特定の場所の天気情報を取得します',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: '天気を知りたい場所（都市名など）'
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: '温度の単位'
            }
          },
          required: ['location']
        }
      }
    ];
    
    // メッセージを送信
    console.log('\n--- 関数呼び出しテスト ---');
    console.log('送信: "東京の天気を教えてください"');
    
    const messages = [
      {
        role: "user",
        content: "大阪の天気を教えてください"
      }
    ];
    
    // 関数呼び出し機能を使ってメッセージを送信
    console.log('関数呼び出し機能を使ってメッセージを送信中...');
    const response = await gemini.sendMessageWithFunctions(messages, functions);
    
    console.log('\n応答:', JSON.stringify(response, null, 2));
    
    // AIが関数を呼び出そうとした場合
    if (response.content && Array.isArray(response.content) && response.content[0]?.type === 'function_call') {
      const functionCall = response.content[0].function_call;
      console.log('呼び出された関数:', functionCall.name);
      console.log('パラメータ:', JSON.stringify(functionCall.arguments, null, 2));
      
      // 実際に関数を実行
      const functionResult = getWeatherInfo(
        functionCall.arguments.location,
        functionCall.arguments.unit
      );
      
      console.log('\n関数の実行結果:', JSON.stringify(functionResult, null, 2));
      
      // 関数の結果をAIに返す
      console.log('\n関数の結果をAIに送信中...');
      const finalResponse = await gemini.sendFunctionResponse(
        [...messages, response],
        functionCall.name,
        functionResult
      );
      
      console.log('\n最終応答:', JSON.stringify(finalResponse, null, 2));
    } else {
      console.log('\n通常の応答:', response.content);
    }
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// テスト実行
testFunctionCalling(); 