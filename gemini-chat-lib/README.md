# Gemini Chat Library

Google Gemini AIモデルと簡単にチャットするためのTypeScriptライブラリです。

## インストール

```bash
npm install gemini-chat-lib
```

## APIキーの取得

このライブラリを使用するには、Google Gemini APIキーが必要です：

1. [Google AI Studio](https://makersuite.google.com/app/apikey)にアクセスします
2. Googleアカウントでログインします
3. APIキーを作成または既存のキーを取得します
4. 取得したキーを`.env.local`ファイルに設定します

## 環境変数の設定

プロジェクトのルートディレクトリに`.env.local`ファイルを作成し、以下の環境変数を設定します：

```
# 必須
GEMINI_API_KEY=your_api_key_here

# オプション
GEMINI_MODEL_ID=gemini-1.5-pro-002
GEMINI_BASE_URL=
GEMINI_TEMPERATURE=0.7
GEMINI_MAX_TOKENS=8192
```

サンプルファイル`.env.local.example`をコピーして`.env.local`を作成することもできます。

## 基本的な使い方

```javascript
// 環境変数を読み込む
require('dotenv').config({ path: '.env.local' });

// APIキーが設定されているか確認
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEYが設定されていません。.env.localファイルを確認してください。');
  process.exit(1);
}

const { GeminiHandler } = require('gemini-chat-lib');

// 環境変数からオプションを取得
const options = {
  apiKey: process.env.GEMINI_API_KEY,
  modelId: process.env.GEMINI_MODEL_ID || 'gemini-1.5-pro-002',
  baseUrl: process.env.GEMINI_BASE_URL || undefined,
  temperature: process.env.GEMINI_TEMPERATURE ? parseFloat(process.env.GEMINI_TEMPERATURE) : 0.7,
  maxTokens: process.env.GEMINI_MAX_TOKENS ? parseInt(process.env.GEMINI_MAX_TOKENS) : 8192
};

async function chatWithGemini() {
  try {
    // GeminiHandlerを初期化
    const handler = new GeminiHandler(options);
    
    // メッセージを送信
    const response = await handler.sendMessage('こんにちは、元気ですか？');
    
    // レスポンスを表示
    console.log('Geminiからの応答:', response.text);
    console.log('使用トークン:', response.usage);
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

chatWithGemini();
```

## 会話履歴の管理

```javascript
const { GeminiHandler, Conversation } = require('gemini-chat-lib');

async function chatWithHistory() {
  const handler = new GeminiHandler({
    apiKey: process.env.GEMINI_API_KEY
  });
  
  // 会話を初期化
  const conversation = new Conversation();
  
  // 最初のメッセージを送信
  const response1 = await handler.sendMessage('私の名前は田中です', conversation);
  console.log('応答1:', response1.text);
  
  // 会話の文脈を保持したまま次のメッセージを送信
  const response2 = await handler.sendMessage('私の名前は何ですか？', conversation);
  console.log('応答2:', response2.text); // "あなたの名前は田中です"と返答するはず
}
```

## 関数呼び出し機能の使用

```javascript
const { GeminiHandler } = require('gemini-chat-lib');

async function testFunctionCalling() {
  const handler = new GeminiHandler({
    apiKey: process.env.GEMINI_API_KEY
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
  
  // 関数呼び出し機能を使ってメッセージを送信
  const response = await handler.sendMessageWithFunctions(
    '東京の天気を教えてください',
    functions
  );
  
  // AIが関数を呼び出そうとした場合
  if (response.functionCall) {
    console.log('呼び出された関数:', response.functionCall.name);
    console.log('パラメータ:', response.functionCall.parameters);
    
    // 実際に天気情報を取得する処理（ここでは仮のデータ）
    const weatherData = {
      location: '東京',
      temperature: 22,
      condition: '晴れ',
      humidity: 45
    };
    
    // 関数の結果をAIに返す
    const finalResponse = await handler.sendFunctionResponse(
      response.functionCall.name,
      weatherData,
      response.functionCall.conversationId
    );
    
    console.log('最終応答:', finalResponse.text);
  }
}
```

## ライセンス

MIT 