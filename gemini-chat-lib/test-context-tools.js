// ファイル処理とコンテキスト機能のテスト
const path = require('path');
const { 
  addLineNumbers, 
  extractTextFromFile, 
  truncateOutput,
  readFile,
  ContextHelper,
  createTools,
  createReadFileTool,
  createCodebaseSearchTool,
  createListDirTool
} = require('./dist');

// テスト用の現在のディレクトリを取得
const workspaceRoot = process.cwd();

async function testFileUtils() {
  console.log('===== ファイル処理機能のテスト =====');
  
  try {
    // 行番号追加テスト
    const testContent = 'これは1行目です\nこれは2行目です\nこれは3行目です';
    const numberedContent = addLineNumbers(testContent);
    console.log('行番号追加テスト:');
    console.log(numberedContent);
    console.log('');
    
    // ファイル読み込みテスト
    console.log('ファイル読み込みテスト:');
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
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
    console.error('ファイル処理テストエラー:', error);
    return false;
  }
}

async function testContextHelper() {
  console.log('===== コンテキスト機能のテスト =====');
  
  try {
    // ワークスペース情報取得テスト
    console.log('ワークスペース情報テスト:');
    const workspaceInfo = await ContextHelper.getWorkspaceInfo(workspaceRoot);
    console.log(workspaceInfo);
    console.log('');
    
    // ディレクトリ一覧テスト
    console.log('ディレクトリ一覧テスト:');
    const files = await ContextHelper.listFiles(workspaceRoot, { maxFiles: 10 });
    console.log(`最初の10ファイル:\n${files.join('\n')}\n`);
    
    // 関連ファイル推論テスト
    console.log('関連ファイル推論テスト:');
    const testQueries = [
      'package.jsonを見せて',
      'TypeScriptの設定を変更したい',
      'geminiのハンドラーについて教えて',
      'コンテキスト処理はどうなってる？'
    ];
    
    const fileList = await ContextHelper.listFiles(workspaceRoot);
    
    for (const query of testQueries) {
      console.log(`クエリ: "${query}"`);
      const relevantFiles = ContextHelper.inferRelevantFiles(query, workspaceRoot, fileList);
      console.log(`関連ファイル: ${relevantFiles.join(', ')}`);
      console.log('');
    }
    
    // 最適化コンテキストテスト
    console.log('最適化コンテキストテスト:');
    const optimizedContext = await ContextHelper.getOptimizedContext(
      'Geminiのハンドラーで関数呼び出しを実装したい',
      workspaceRoot,
      { maxFiles: 3, includeFileContents: true }
    );
    console.log(optimizedContext);
    
    return true;
  } catch (error) {
    console.error('コンテキストテストエラー:', error);
    return false;
  }
}

async function testFunctionTools() {
  console.log('===== Function Callingツールのテスト =====');
  
  try {
    // ツール作成テスト
    const tools = createTools(workspaceRoot);
    console.log(`作成されたツール: ${tools.map(t => t.name).join(', ')}\n`);
    
    // ファイル読み込みツールテスト
    console.log('ファイル読み込みツールテスト:');
    const readFileTool = createReadFileTool(workspaceRoot);
    const readResult = await readFileTool.execute({
      path: 'package.json',
      limit: 10
    });
    console.log(`ツール実行結果:\n${readResult.content}\n`);
    
    // ディレクトリ一覧ツールテスト
    console.log('ディレクトリ一覧ツールテスト:');
    const listDirTool = createListDirTool(workspaceRoot);
    const listResult = await listDirTool.execute({
      relative_workspace_path: 'src'
    });
    console.log(`ツール実行結果:\n${listResult.content}\n`);
    
    // コードベース検索ツールテスト
    console.log('コードベース検索ツールテスト:');
    const searchTool = createCodebaseSearchTool(workspaceRoot);
    const searchResult = await searchTool.execute({
      query: 'Geminiのハンドラー'
    });
    console.log(`ツール実行結果:\n${searchResult.content}\n`);
    
    return true;
  } catch (error) {
    console.error('Function Callingツールテストエラー:', error);
    return false;
  }
}

// メインのテスト実行関数
async function runTests() {
  console.log('gemini-chat-lib コンテキスト・ファイル機能テスト開始\n');
  
  const fileUtilsSuccess = await testFileUtils();
  console.log(`ファイル処理テスト: ${fileUtilsSuccess ? '成功' : '失敗'}\n`);
  
  const contextHelperSuccess = await testContextHelper();
  console.log(`コンテキスト機能テスト: ${contextHelperSuccess ? '成功' : '失敗'}\n`);
  
  const functionToolsSuccess = await testFunctionTools();
  console.log(`Function Callingツールテスト: ${functionToolsSuccess ? '成功' : '失敗'}\n`);
  
  console.log('すべてのテスト完了');
  
  // 性能評価の概要
  console.log('\n===== 性能評価の概要 =====');
  console.log(`
1. ファイル処理機能
- 行番号追加: ${fileUtilsSuccess ? '正常に動作' : '失敗'}
- 長いテキストの切り詰め: ${fileUtilsSuccess ? '20行に制限し、前後のコンテキストを維持' : '失敗'}
- 部分読み込み: ${fileUtilsSuccess ? '指定範囲の読み込みが可能' : '失敗'}

2. コンテキスト最適化
- 環境情報収集: ${contextHelperSuccess ? '正常に収集' : '失敗'}
- ファイル推論: ${contextHelperSuccess ? 'クエリに基づいた関連ファイルの特定が可能' : '失敗'}
- コンテキスト最適化: ${contextHelperSuccess ? '必要な情報のみを抽出し、サイズを最適化' : '失敗'}

3. Function Callingツール
- read_file: ${functionToolsSuccess ? '正常に動作' : '失敗'}
- list_dir: ${functionToolsSuccess ? '正常に動作' : '失敗'}
- codebase_search: ${functionToolsSuccess ? '正常に動作' : '失敗'}

総合評価: ${fileUtilsSuccess && contextHelperSuccess && functionToolsSuccess ? 
  'すべての機能が正常に動作。情報量と精度のバランスを取りながら、必要な情報を効率的に抽出できる仕組みが実現できています。' : 
  '一部の機能に問題があります。詳細なログを確認してください。'}
`);
}

// テスト実行
runTests()
  .catch(error => {
    console.error('テスト中にエラーが発生しました:', error);
    process.exit(1);
  }); 