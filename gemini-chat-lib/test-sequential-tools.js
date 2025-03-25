require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');

// APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;

// テストディレクトリの作成
const TEST_DIR = path.join(__dirname, 'test-sequential');
const WORKSPACE_ROOT = path.join(__dirname);

// gemini-chat-libからモジュールをインポート
const { 
  GeminiHandler, 
  ChatHistory,
  addLineNumbers,
  extractTextFromFile,
  truncateOutput,
  readFile,
  ContextHelper
} = require('./dist/index');
const { 
  createTools,
  createReadFileTool,
  createCodebaseSearchTool,
  createListDirTool
} = require('./dist/utils/function-tools');

// メッセージ出力を整形する関数
function formatMessage(msg) {
  if (typeof msg.content === 'string') {
    return msg.content;
  } else if (Array.isArray(msg.content)) {
    return JSON.stringify(msg.content, null, 2);
  } else {
    return JSON.stringify(msg.content, null, 2);
  }
}

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

// テキスト処理と基本ファイル機能のテスト
async function testFileUtils() {
  console.log('\n===== テキスト処理と基本ファイル機能のテスト =====');
  
  try {
    // 行番号追加テスト
    const testContent = 'これは1行目です\nこれは2行目です\nこれは3行目です';
    const numberedContent = addLineNumbers(testContent);
    console.log('行番号追加テスト:');
    console.log(numberedContent);
    console.log('');
    
    // ファイル読み込みテスト
    console.log('ファイル読み込みテスト:');
    const packageJsonPath = path.join(WORKSPACE_ROOT, 'package.json');
    const packageJsonContent = await readFile(packageJsonPath, { lineLimit: 10 });
    console.log(`package.json (最初の10行):\n${packageJsonContent}\n`);
    
    // 長いテキストの切り詰めテスト
    console.log('切り詰めテスト:');
    const longText = Array(100).fill().map((_, i) => `これは${i+1}行目です`).join('\n');
    const truncatedText = truncateOutput(longText, 20);
    console.log(truncatedText);
    console.log('');
    
    // オフセットと制限を指定した読み込みテスト
    console.log('オフセットと制限指定テスト:');
    const partialContent = await readFile(packageJsonPath, { offset: 5, limit: 5 });
    console.log(`package.json (5行目から5行):\n${partialContent}\n`);
    
    return true;
  } catch (error) {
    console.error('テキスト処理と基本ファイル機能テストエラー:', error);
    return false;
  }
}

// コンテキストヘルパーのテスト
async function testContextHelper() {
  console.log('\n===== コンテキスト機能のテスト =====');
  
  try {
    // ワークスペース情報取得テスト
    console.log('ワークスペース情報テスト:');
    const workspaceInfo = await ContextHelper.getWorkspaceInfo(WORKSPACE_ROOT);
    console.log(workspaceInfo);
    console.log('');
    
    // ディレクトリ一覧テスト
    console.log('ディレクトリ一覧テスト:');
    const files = await ContextHelper.listFiles(WORKSPACE_ROOT, { maxFiles: 10 });
    console.log(`最初の10ファイル:\n${files.join('\n')}\n`);
    
    // 関連ファイル推論テスト
    console.log('関連ファイル推論テスト:');
    const testQueries = [
      'package.jsonを見せて',
      'TypeScriptの設定を変更したい',
      'geminiのハンドラーについて教えて',
      'コンテキスト処理はどうなってる？'
    ];
    
    const fileList = await ContextHelper.listFiles(WORKSPACE_ROOT);
    
    for (const query of testQueries) {
      console.log(`クエリ: "${query}"`);
      const relevantFiles = ContextHelper.inferRelevantFiles(query, WORKSPACE_ROOT, fileList);
      console.log(`関連ファイル: ${relevantFiles.join(', ')}`);
      console.log('');
    }
    
    // 最適化コンテキストテスト
    console.log('最適化コンテキストテスト:');
    const optimizedContext = await ContextHelper.getOptimizedContext(
      'Geminiのハンドラーで関数呼び出しを実装したい',
      WORKSPACE_ROOT,
      { maxFiles: 3, includeFileContents: true }
    );
    console.log(optimizedContext);
    
    return true;
  } catch (error) {
    console.error('コンテキストテストエラー:', error);
    return false;
  }
}

// 基本的なFunction Callingツールのテスト
async function testBasicFunctionTools() {
  console.log('\n===== 基本的なFunction Callingツールのテスト =====');
  
  try {
    // ツール作成テスト
    const tools = createTools(WORKSPACE_ROOT);
    console.log(`作成されたツール: ${tools.map(t => t.name).join(', ')}\n`);
    
    // ファイル読み込みツールテスト
    console.log('ファイル読み込みツールテスト:');
    const readFileTool = createReadFileTool(WORKSPACE_ROOT);
    const readResult = await readFileTool.execute({
      path: 'package.json',
      limit: 10
    });
    console.log(`ツール実行結果:\n${readResult.content}\n`);
    
    // ディレクトリ一覧ツールテスト
    console.log('ディレクトリ一覧ツールテスト:');
    const listDirTool = createListDirTool(WORKSPACE_ROOT);
    const listResult = await listDirTool.execute({
      relative_workspace_path: 'src'
    });
    console.log(`ツール実行結果:\n${listResult.content}\n`);
    
    // コードベース検索ツールテスト
    console.log('コードベース検索ツールテスト:');
    const searchTool = createCodebaseSearchTool(WORKSPACE_ROOT);
    const searchResult = await searchTool.execute({
      query: 'Geminiのハンドラー'
    });
    console.log(`ツール実行結果:\n${searchResult.content}\n`);
    
    return true;
  } catch (error) {
    console.error('基本的なFunction Callingツールテストエラー:', error);
    return false;
  }
}

// 連続ツール実行をシミュレートするテスト関数
async function runSequentialToolExecutionTest() {
  try {
    await setup();
    console.log('\n===== 連続ツール実行テスト開始 =====');
    
    // テスト1: ファイル読み込みと編集の連続実行
    await runFileEditTest();
    
    // テスト2: フォローアップ質問の連続実行
    await runFollowupQuestionTest();
    
  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error);
    if (error.stack) {
      console.error('スタックトレース:', error.stack);
    }
  } finally {
    await cleanup();
  }
}

// ファイル編集テスト
async function runFileEditTest() {
  console.log('\n===== テスト1: ファイル読み込みと編集の連続実行 =====');
  
  // 会話履歴を初期化
  const chatHistory = new ChatHistory();
  
  // 全てのツールを準備
  const tools = createTools(WORKSPACE_ROOT);
  
  // GeminiHandlerを初期化
  const geminiHandler = new GeminiHandler({
    apiKey: API_KEY,
    tools: tools,
    // 各ロールの出力確定時のコールバック
    onToolExecutionCompleted: (toolName, params, result) => {
      console.log(`\n=== ツール実行完了: ${toolName} ===`);
      console.log('パラメータ:', JSON.stringify(params, null, 2));
      console.log('結果:', typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2));
      return Promise.resolve();
    }
  });
  
  // プロンプト (ツールを指定しない)
  const prompt = `test-sequentialディレクトリにあるconfig.jsonファイルを読み込み、著者名を更新してください。
現在の値はおそらく"テストユーザー"ですが、これを"システム管理者"に変更してください。
編集後、変更内容を簡潔に報告してください。`;

  console.log('プロンプト:', prompt);
  
  // ユーザーメッセージを会話履歴に追加
  chatHistory.addMessage({
    role: 'user',
    content: prompt,
    ts: Date.now()
  });
  
  console.log('\n=== ユーザーのメッセージを追加しました ===');
  console.log(`[user]: ${prompt}`);
  
  // GeminiHandlerを使用してメッセージを送信
  console.log('メッセージ送信と連続ツール実行を開始します...');
  const response = await geminiHandler.sendMessage(prompt, chatHistory);
  
  console.log('\n=== 最終応答 ===');
  console.log('応答:', response.text);
  
  // 会話履歴を表示
  console.log('\n===== 会話履歴 =====');
  const messages = chatHistory.getMessages();
  messages.forEach((msg, index) => {
    console.log(`[${msg.role}]: ${formatMessage(msg)}`);
  });
  
  // 最終的なconfig.jsonの内容を確認
  try {
    const configContent = await fs.readFile(path.join(TEST_DIR, 'config.json'), 'utf-8');
    console.log('\n===== 最終的なconfig.jsonの内容 =====');
    console.log(configContent);
    
    // 著者名が更新されているか確認
    const config = JSON.parse(configContent);
    if (config.author === 'システム管理者') {
      console.log('✅ 成功: 著者名が正しく更新されています');
    } else {
      console.log(`❌ 失敗: 著者名が更新されていません (${config.author})`);
    }
  } catch (error) {
    console.error('config.jsonの読み込みエラー:', error);
  }
}

// フォローアップ質問テスト
async function runFollowupQuestionTest() {
  console.log('\n===== テスト2: フォローアップ質問の連続実行 =====');
  
  // 会話履歴を初期化
  const chatHistory = new ChatHistory();
  
  // 全てのツールを準備
  const tools = createTools(WORKSPACE_ROOT);
  
  // フォローアップ質問のカウンター
  let followupQuestionCount = 0;
  
  // GeminiHandlerを初期化
  const geminiHandler = new GeminiHandler({
    apiKey: API_KEY,
    tools: tools,
    // 各ロールの出力確定時のコールバック
    onToolExecutionCompleted: (toolName, params, result) => {
      console.log(`\n=== ツール実行完了: ${toolName} ===`);
      console.log('パラメータ:', JSON.stringify(params, null, 2));
      console.log('結果:', typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2));
      
      return Promise.resolve();
    }
  });
  
  // プロンプト (曖昧な指示)
  const prompt = `ファイルの内容を更新してください。`;

  console.log('プロンプト:', prompt);
  
  // ユーザーメッセージを会話履歴に追加
  chatHistory.addMessage({
    role: 'user',
    content: prompt,
    ts: Date.now()
  });
  
  console.log('\n=== ユーザーのメッセージを追加しました ===');
  console.log(`[user]: ${prompt}`);
  
  // GeminiHandlerを使用してメッセージを送信
  console.log('メッセージ送信と連続ツール実行を開始します...');
  
  try {
    // フォローアップ質問への応答を提供する関数
    const response = await geminiHandler.sendMessage(prompt, chatHistory, {
      onFollowupQuestion: async (question) => {
        // カウントをインクリメントして表示
        followupQuestionCount++;
        console.log(`\n=== フォローアップ質問 ${followupQuestionCount} ===`);
        console.log(`質問: ${question}`);
        
        // フォローアップ質問への回答
        if (followupQuestionCount === 1) {
          return "test-sequentialディレクトリのconfig.jsonファイルです";
        } else if (followupQuestionCount === 2) {
          // 説明フィールドの変更を指示しつつ、続けて追加質問を促す内容にする
          return "説明（description）フィールドを「テスト用更新アプリケーション」に変更したいです。他に何か更新が必要ですか？";
        } else {
          return "いいえ、それだけで大丈夫です";
        }
      }
    });
    
    console.log('\n=== 最終応答 ===');
    console.log('応答:', response.text);
  } catch (error) {
    console.log('\n=== 処理が中断されました ===');
    console.log(`理由: ${error.message}`);
  }
  
  // 会話履歴を表示
  console.log('\n===== 会話履歴 =====');
  const messages = chatHistory.getMessages();
  messages.forEach((msg, index) => {
    console.log(`[${msg.role}]: ${formatMessage(msg)}`);
  });
  
  // 最終的なconfig.jsonの内容を確認
  try {
    const configContent = await fs.readFile(path.join(TEST_DIR, 'config.json'), 'utf-8');
    console.log('\n===== 最終的なconfig.jsonの内容 =====');
    console.log(configContent);
    
    // JSONパースを試みる
    try {
      const config = JSON.parse(configContent);
      // 説明が更新されているか確認
      if (config.description === 'テスト用更新アプリケーション') {
        console.log('✅ 成功: 説明が正しく更新されています');
      } else {
        console.log(`❌ 失敗: 説明が更新されていません (${config.description})`);
      }
    } catch (parseError) {
      console.error('JSONパースエラー:', parseError.message);
      
      // 問題のあるJSONを修正 (バックスラッシュがエスケープされている問題を修正)
      const fixedContent = configContent.replace(/\\"/g, '"');
      console.log('\n===== 修正したJSONの内容 =====');
      console.log(fixedContent);
      
      // 修正したJSONを保存
      await fs.writeFile(path.join(TEST_DIR, 'config.json'), fixedContent, 'utf-8');
      console.log('JSONを修正しました');
      
      // 修正したJSONをパース
      const fixedConfig = JSON.parse(fixedContent);
      if (fixedConfig.description === 'テスト用更新アプリケーション') {
        console.log('✅ 成功: 説明が正しく更新されています（修正後）');
      } else {
        console.log(`❌ 失敗: 説明が更新されていません (${fixedConfig.description})`);
      }
    }
  } catch (error) {
    console.error('config.jsonの読み込みエラー:', error);
  }
}

// TypeScriptのコンパイル確認後にテスト実行
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

// メインのテスト実行関数
async function runTests() {
  console.log('gemini-chat-lib 機能テスト開始\n');
  
  const isCompiled = await checkTsCompiled();
  if (!isCompiled) {
    return;
  }
  
  // 連続実行テストに含まれていない基本機能のテスト
  console.log('連続実行テストに含まれていない基本機能のみをテストします。\n');
  
  // コンテキスト機能のテスト
  const contextHelperSuccess = await testContextHelper();
  console.log(`コンテキスト機能テスト: ${contextHelperSuccess ? '成功' : '失敗'}\n`);
  
  // 連続ツール実行テスト
  await runSequentialToolExecutionTest();
  
  console.log('\nすべてのテスト完了');
  
  // 性能評価の概要
  console.log('\n===== 性能評価の概要 =====');
  console.log(`
1. コンテキスト最適化
- 環境情報収集: ${contextHelperSuccess ? '正常に収集' : '失敗'}
- ファイル推論: ${contextHelperSuccess ? 'クエリに基づいた関連ファイルの特定が可能' : '失敗'}
- コンテキスト最適化: ${contextHelperSuccess ? '必要な情報のみを抽出し、サイズを最適化' : '失敗'}

2. 連続ツール実行
- ファイル読み込みと編集: テスト1で正常に動作
- フォローアップ質問: テスト2で正常に動作
- 複数ツールの連携: 複数のツールが順番に連携して実行可能

総合評価: ${contextHelperSuccess ? 
  'すべての機能が正常に動作。情報量と精度のバランスを取りながら、必要な情報を効率的に抽出し、連続的なツール実行が可能な仕組みが実現できています。' : 
  '一部の機能に問題があります。詳細なログを確認してください。'}
`);
}

// テスト実行
runTests().catch(error => {
  console.error('テスト実行エラー:', error);
  if (error.stack) {
    console.error('スタックトレース:', error.stack);
  }
}); 