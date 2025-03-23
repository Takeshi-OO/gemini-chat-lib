# Gemini Chat Library

Gemini ProモデルによるチャットとFunction Callingを実装するためのライブラリです。

## 機能一覧

- Gemini APIとの連携
- 会話履歴の管理
- Function Callingサポート
- ファイル操作やコードベース検索などのツール提供
- 連続ツール実行（パイプライン処理）

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
const { GeminiHandler, ChatHistory } = require('gemini-chat-lib');

// Gemini Handlerの初期化
const geminiHandler = new GeminiHandler({
  apiKey: 'YOUR_GEMINI_API_KEY',
  modelId: 'gemini-1.5-pro',
  temperature: 0.2
});

// 会話履歴を初期化
const chatHistory = new ChatHistory();

// メッセージを送信
async function sendMessage(message) {
  const response = await geminiHandler.sendMessage(message, chatHistory);
  console.log(response.text);
}

// 例
sendMessage('こんにちは、世界！');
```

## Function Calling機能

Function Calling機能を使用すると、AIがユーザーの要望に応じて適切なツールを呼び出して処理を行うことができます。

```javascript
const { GeminiHandler, ChatHistory, createTools } = require('gemini-chat-lib');

// ワークスペースのルートディレクトリ
const WORKSPACE_ROOT = process.cwd();

// Gemini Handlerの初期化（Function Calling対応）
const geminiHandler = new GeminiHandler({
  apiKey: 'YOUR_GEMINI_API_KEY',
  modelId: 'gemini-1.5-pro',
  temperature: 0.2,
  functionCallingMode: 'ANY', // ANYはFunction Callingを強制
  tools: createTools(WORKSPACE_ROOT) // 利用可能なツールセットを提供
});

// 会話履歴を初期化
const chatHistory = new ChatHistory();

// メッセージを送信
async function sendMessage(message) {
  const response = await geminiHandler.sendMessage(message, chatHistory);
  console.log(response.text);
}

// 例: AIにファイル検索とコンテンツ読み込みを依頼
sendMessage('package.jsonファイルを探して、その内容を教えてください');
```

## 連続ツール実行機能

連続ツール実行機能を使用すると、AIが適切なツールを組み合わせて連続的にタスクを実行するパイプライン処理が可能になります。これにより、「ファイルを検索し、内容を読み込み、編集する」といった複雑なタスクをユーザーの追加入力なしに自動で実行できます。

```javascript
const { 
  GeminiHandler, 
  ChatHistory, 
  createTools, 
  ToolExecutionManager 
} = require('gemini-chat-lib');

// Gemini Handlerの初期化（連続ツール実行対応）
const geminiHandler = new GeminiHandler({
  apiKey: 'YOUR_GEMINI_API_KEY',
  modelId: 'gemini-1.5-pro',
  temperature: 0.2,
  functionCallingMode: 'ANY',
  tools: createTools(WORKSPACE_ROOT),
  
  // ユーザー承認が必要なツールを指定
  toolsRequiringApproval: ['write_to_file', 'edit_file'],
  
  // ユーザー承認コールバック
  onToolApprovalRequired: async (toolName, params) => {
    // ユーザーにツール実行の承認を求めるロジック
    // ファイル編集など重要な操作の前に確認を取る
    return true; // または false で拒否
  },
  
  // ツール実行完了コールバック
  onToolExecutionCompleted: async (toolName, params, result) => {
    console.log(`ツール ${toolName} が実行されました`);
  },
  
  // タスク完了コールバック
  onTaskCompleted: async (result, command) => {
    console.log('タスクが完了しました:', result);
  }
});

// 会話履歴を初期化
const chatHistory = new ChatHistory();

// メッセージを送信（連続ツール実行が自動的に処理される）
async function sendMessage(message) {
  const response = await geminiHandler.sendMessage(message, chatHistory);
  console.log(response.text);
}

// 例: 連続したツール実行を伴うタスク
sendMessage('package.jsonファイルのバージョンを1.0.1に更新してください');
```

### 連続ツール実行の流れ

1. AIがユーザーの要望を理解し、適切なツールを選択（例: codebase_search）
2. ツールの実行結果を受け取り、次に必要なツールを判断（例: read_file）
3. さらに次のステップに進む（例: edit_file）
4. 最終的にタスク完了（attempt_completion）で処理を終了

この機能により、ユーザーは複雑なタスクを単一の指示で実行でき、AIが適切なツールを連続して使用して効率的に処理を行います。

## サンプルコード

詳細なサンプルコードは `examples` ディレクトリに用意されています：

- `basic-chat.js`: 基本的なチャット機能
- `function-calling.js`: Function Calling機能の使用例
- `sequential-tool-execution.js`: 連続ツール実行の使用例

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

## タスク完了ツールのテスト

タスク完了判断ツール（`attempt_completion`）のテストを実施しました。このツールは、ユーザーからのタスクが完了したと判断された場合に呼び出され、結果を報告します。

### テスト内容

以下の3つのケースでテストを実施しました：

1. **明確に完了可能なタスク**：
   - 単一のファイル作成など、明確なタスクが完了した後、タスク完了ツールが適切に呼び出されることを確認
   - タスク完了ツールは適切な結果メッセージを生成

2. **まだ完了していないタスク**：
   - 複数のファイル作成タスクで、最初のファイルのみ作成された状態では、タスク完了ツールではなく続きのタスクが実行される
   - ユーザーからの部分的完了の応答に対して、残りのタスクを実行するツールが選択される

3. **情報不足で質問が必要なケース**：
   - 曖昧な指示（「必要なことをしてください」）に対して、`ask_followup_question`ツールが選択される
   - ユーザーから具体的な指示を受けると、適切なツール（ファイル作成）が実行される
   - タスク完了後、タスク完了ツールが呼び出される

### テスト結果

すべてのテストケースで、Geminiはタスクの状態を適切に判断し、正しいツールを選択しました：

- 完了可能なタスクでは完了ツールを呼び出す
- 未完了のタスクでは残りのタスクを実行するツールを呼び出す
- 情報不足の場合は質問ツールを呼び出し、情報が得られた後に適切なツールを呼び出す

### テスト方法

テストには `test-completion-tool.js` スクリプトを使用しました。このスクリプトはGemini APIを使って関数呼び出しを発生させ、期待通りのツールが選択されるかを検証します。

テストを実行するには：

```bash
node test-completion-tool.js
```

## ライセンス

MIT 