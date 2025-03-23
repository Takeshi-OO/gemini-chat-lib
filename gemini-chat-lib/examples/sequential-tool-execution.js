/**
 * 連続ツール実行の使用例
 * 
 * このサンプルでは、AIが要望に応じて以下のようなツールを連続して実行する方法を示します:
 * 1. ファイル検索
 * 2. ファイル読み込み
 * 3. ファイル編集
 * 4. タスク完了
 */

const path = require('path');
const readline = require('readline');
const fs = require('fs');

const { 
  GeminiHandler, 
  ChatHistory, 
  createTools
} = require('../dist');

// 対話型のコンソール入力を設定
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// ワークスペースのルートパスを設定
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// 連続ツール実行のテスト関数
async function testSequentialToolExecution() {
  console.log('===== 連続ツール実行のテスト =====');
  
  // APIキーの確認
  if (!process.env.GEMINI_API_KEY) {
    console.error('環境変数 GEMINI_API_KEY が設定されていません。');
    process.exit(1);
  }
  
  // GeminiHandlerの初期化
  const geminiHandler = new GeminiHandler({
    apiKey: process.env.GEMINI_API_KEY,
    modelId: 'gemini-1.5-pro',
    temperature: 0.2,
    functionCallingMode: 'ANY',
    tools: createTools(WORKSPACE_ROOT),
    
    // ユーザー承認が必要なツールを指定
    toolsRequiringApproval: ['write_to_file', 'edit_file'],
    
    // ユーザー承認コールバック
    onToolApprovalRequired: async (toolName, params) => {
      return new Promise((resolve) => {
        if (toolName === 'write_to_file') {
          console.log('\n==== ファイル書き込み承認 ====');
          console.log(`ファイルパス: ${params.path}`);
          console.log(`内容の一部: ${params.content.substring(0, 100)}...`);
        } else if (toolName === 'edit_file') {
          console.log('\n==== ファイル編集承認 ====');
          console.log(`ファイルパス: ${params.target_file}`);
          console.log(`編集内容: ${params.instructions}`);
        }
        
        rl.question('このツールの実行を承認しますか？ (y/n): ', (answer) => {
          resolve(answer.toLowerCase() === 'y');
        });
      });
    },
    
    // ツール実行完了コールバック
    onToolExecutionCompleted: async (toolName, params, result) => {
      console.log(`\n[${toolName}] ツールが実行されました`);
      console.log(`結果: ${result.content ? result.content.substring(0, 100) + '...' : 'なし'}`);
    },
    
    // タスク完了コールバック
    onTaskCompleted: async (result, command) => {
      console.log('\n===== タスク完了 =====');
      console.log(result);
      if (command) {
        console.log(`\n実行コマンド: ${command}`);
      }
    }
  });
  
  // 会話履歴の初期化
  const chatHistory = new ChatHistory();
  
  // ユーザー入力を取得
  console.log('\nGeminiに命令を入力してください（例: "package.jsonファイルを見つけて、バージョンを1.0.1に更新してください"）:');
  const userPrompt = await getUserInput();
  
  // 応答を取得
  console.log('\nGeminiが応答を生成しています...');
  const response = await geminiHandler.sendMessage(userPrompt, chatHistory);
  
  console.log('\n===== 応答 =====');
  console.log(response.text);
  
  // 会話履歴を表示
  console.log('\n===== 会話履歴 =====');
  chatHistory.getMessages().forEach((message, index) => {
    console.log(`[${message.role}]: ${typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)}`);
  });
  
  // クリーンアップ
  rl.close();
}

// ユーザー入力を取得するプロミス関数
function getUserInput() {
  return new Promise((resolve) => {
    rl.question('> ', (answer) => {
      resolve(answer);
    });
  });
}

// テストを実行
testSequentialToolExecution().catch(error => {
  console.error('エラーが発生しました:', error);
  rl.close();
}); 