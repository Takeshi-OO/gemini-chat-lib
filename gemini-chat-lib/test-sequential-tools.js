require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');

// APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;

// テストディレクトリの作成
const TEST_DIR = path.join(__dirname, 'test-sequential');
const WORKSPACE_ROOT = path.join(__dirname);

// gemini-chat-libからモジュールをインポート
const { GeminiHandler, ChatHistory } = require('./dist/index');
const { createReadFileTool, createEditFileTool, createAttemptCompletionTool } = require('./dist/utils/function-tools');

// 環境のセットアップ
async function setup() {
  try {
    // テストディレクトリの作成
    await fs.mkdir(TEST_DIR, { recursive: true });
    
    // テストファイルの作成
    await fs.writeFile(
      path.join(TEST_DIR, 'config.json'),
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        description: "テスト用アプリケーション",
        author: "テストユーザー"
      }, null, 2)
    );
    
    console.log('テスト環境を準備しました。');
  } catch (error) {
    console.error('テスト環境の準備に失敗しました:', error);
    process.exit(1);
  }
}

// クリーンアップ
async function cleanup() {
  try {
    // テストディレクトリの削除
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    console.log('テスト環境をクリーンアップしました。');
  } catch (error) {
    console.error('テスト環境のクリーンアップに失敗しました:', error);
  }
}

// 連続ツール実行をシミュレートするテスト関数
async function runSequentialToolExecutionTest() {
  try {
    await setup();
    console.log('\n===== 連続ツール実行テスト開始 =====');
    
    // 会話履歴を初期化
    const chatHistory = new ChatHistory();
    
    // テスト1: ファイル読み込みと編集の連続実行
    console.log('\n===== テスト1: ファイル読み込みと編集の連続実行 =====');
    
    // 必要な最小限のツールだけを準備
    const readFileTool = createReadFileTool(WORKSPACE_ROOT);
    const editFileTool = createEditFileTool(WORKSPACE_ROOT);
    const attemptCompletionTool = createAttemptCompletionTool();
    
    // ツール実行のログを追加
    const onToolExecutionCompleted = async (toolName, params, result) => {
      console.log(`\n===== ツール実行完了: ${toolName} =====`);
      console.log('パラメータ:', JSON.stringify(params, null, 2));
      console.log('結果:', JSON.stringify(result, null, 2));
    };
    
    // GeminiHandlerを初期化 (最小限のツールを使用、ログコールバック追加)
    const geminiHandler = new GeminiHandler({
      apiKey: API_KEY,
      tools: [readFileTool, editFileTool, attemptCompletionTool],
      onToolExecutionCompleted
    });
    
    // プロンプト (特定のツールを指定しない)
    const prompt = `test-sequentialディレクトリにあるconfig.jsonファイルを読み込み、バージョン番号を"1.0.0"から"2.0.0"に更新してください。
ファイルを編集する際は、edit_fileツールを使用し、必ず以下の3つのパラメータを指定してください：
- target_file: 編集するファイル名（例：test-sequential/config.json）
- instructions: 何を変更するかの説明（例：バージョン番号を2.0.0に変更します）
- code_edit: 変更するコード。既存コードは// ... existing code ...で示します。例：
  // ... existing code ...
  "version": "2.0.0",
  // ... existing code ...

タスクが完了したら教えてください。`;

    console.log('プロンプト:', prompt);
    
    // ユーザーメッセージを会話履歴に追加
    chatHistory.addMessage({
      role: 'user',
      content: prompt,
      ts: Date.now()
    });
    
    // GeminiHandlerを使用してメッセージを送信
    console.log('メッセージ送信と連続ツール実行を開始します...');
    const response = await geminiHandler.sendMessage(prompt, chatHistory);
    console.log('応答:', response.text);
    
    // 会話履歴を表示
    console.log('\n===== 会話履歴 =====');
    const messages = chatHistory.getMessages();
    messages.forEach((msg, index) => {
      console.log(`[${msg.role}]: ${typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content, null, 2)}`);
    });
    
    // 最終的なconfig.jsonの内容を確認
    try {
      const configContent = await fs.readFile(path.join(TEST_DIR, 'config.json'), 'utf-8');
      console.log('\n===== 最終的なconfig.jsonの内容 =====');
      console.log(configContent);
      
      // バージョンが更新されているか確認
      const config = JSON.parse(configContent);
      if (config.version === '2.0.0') {
        console.log('✅ 成功: バージョンが正しく更新されています');
      } else {
        console.log(`❌ 失敗: バージョンが更新されていません (${config.version})`);
      }
    } catch (error) {
      console.error('config.jsonの読み込みエラー:', error);
    }
    
  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error);
    if (error.stack) {
      console.error('スタックトレース:', error.stack);
    }
  } finally {
    await cleanup();
  }
}

// テスト実行前にTypeScriptがコンパイルされているか確認
async function checkTsCompiled() {
  try {
    // dist/utils/function-tools.jsが存在するか確認
    await fs.access(path.join(__dirname, 'dist/utils/function-tools.js'));
    // GeminiHandlerが存在するか確認
    await fs.access(path.join(__dirname, 'dist/gemini/gemini-handler.js'));
    console.log('✅ TypeScriptのコンパイル結果が見つかりました');
    return true;
  } catch (error) {
    console.error('❌ TypeScriptがコンパイルされていません。先に `npm run build` を実行してください。');
    console.error('エラー:', error.message);
    return false;
  }
}

// TypeScriptのコンパイル確認後にテスト実行
async function runTests() {
  const isCompiled = await checkTsCompiled();
  if (isCompiled) {
    await runSequentialToolExecutionTest();
  }
}

// テスト実行
runTests().catch(error => {
  console.error('テスト実行エラー:', error);
  if (error.stack) {
    console.error('スタックトレース:', error.stack);
  }
}); 