require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI, FunctionCallingMode } = require('@google/generative-ai');

// APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;

// テストディレクトリの作成
const TEST_DIR = path.join(__dirname, 'test-sequential');

// ツールの実行関数
async function executeReadFile(params) {
  try {
    // パスからtest-sequential/を削除して、直接ファイル名を使用
    const filePath = path.join(TEST_DIR, params.path.replace('test-sequential/', ''));
    const content = await fs.readFile(filePath, 'utf-8');
    return { content };
  } catch (error) {
    return { error: `ファイル読み込みエラー: ${error.message}` };
  }
}

async function executeEditFile(params) {
  try {
    // パスからtest-sequential/を削除して、直接ファイル名を使用
    const filePath = path.join(TEST_DIR, params.target_file.replace('test-sequential/', ''));
    
    // ファイルの内容を読み込む
    const content = await fs.readFile(filePath, 'utf-8');
    
    // JSONをパース
    const json = JSON.parse(content);
    
    // バージョンを更新
    if (params.new_version) {
      json.version = params.new_version;
    }
    
    // ファイルに書き戻す
    await fs.writeFile(filePath, JSON.stringify(json, null, 2));
    
    return { content: `ファイル ${params.target_file} のバージョンを ${params.new_version} に更新しました。` };
  } catch (error) {
    return { error: `ファイル編集エラー: ${error.message}` };
  }
}

async function executeAttemptCompletion(params) {
  return { content: params.result };
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

// 連続ツール実行をシミュレートするテスト関数
async function runSequentialToolExecutionTest() {
  try {
    await setup();
    console.log('\n===== 連続ツール実行テスト開始 =====');
    
    // Gemini API初期化
    const genAI = new GoogleGenerativeAI(API_KEY);
    
    // シンプルな関数定義
    const tools = [{
      functionDeclarations: [
        {
          name: "read_file",
          description: "ファイルの内容を読み取ります",
          parameters: {
            type: "OBJECT",
            properties: {
              path: {
                type: "STRING",
                description: "読み取り対象のファイルパス"
              }
            },
            required: ["path"]
          }
        },
        {
          name: "edit_file",
          description: "JSONファイルのバージョンを更新します",
          parameters: {
            type: "OBJECT",
            properties: {
              target_file: {
                type: "STRING",
                description: "編集対象のファイルパス"
              },
              new_version: {
                type: "STRING",
                description: "新しいバージョン番号"
              }
            },
            required: ["target_file", "new_version"]
          }
        },
        {
          name: "attempt_completion",
          description: "タスク完了を示します",
          parameters: {
            type: "OBJECT",
            properties: {
              result: {
                type: "STRING",
                description: "タスクの結果"
              }
            },
            required: ["result"]
          }
        }
      ]
    }];
    
    // テスト1: ファイル読み込みと編集の連続実行
    console.log('\n===== テスト1: ファイル読み込みと編集の連続実行 =====');
    
    // モデルを初期化 (ANY モード)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.2
      },
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY // ANYモードを使用
        }
      },
      tools
    });
    
    // プロンプト
    const prompt = `test-sequentialディレクトリ内のconfig.jsonファイルを読み込んで、バージョンを2.0.0に更新してください。`;
    console.log('プロンプト:', prompt);
    
    // Gemini APIを呼び出し
    const initialResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });
    
    const initialResponse = initialResult.response;
    console.log('初期応答テキスト:', initialResponse.text());
    
    // 関数呼び出しがあるか確認
    const initialFunctionCalls = initialResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (initialFunctionCalls.length === 0) {
      console.log('❌ 失敗: 関数呼び出しがありませんでした');
      return;
    }
    
    console.log('✅ 成功: 関数呼び出しが返されました');
    
    // 最初の関数呼び出し情報を表示
    const firstFunctionCall = initialFunctionCalls[0];
    console.log(`最初の関数呼び出し: ${firstFunctionCall.name}`);
    console.log('引数:', JSON.stringify(firstFunctionCall.args, null, 2));
    
    // 関数を実行
    let result;
    if (firstFunctionCall.name === 'read_file') {
      result = await executeReadFile(firstFunctionCall.args);
    } else if (firstFunctionCall.name === 'edit_file') {
      result = await executeEditFile(firstFunctionCall.args);
    } else if (firstFunctionCall.name === 'attempt_completion') {
      result = await executeAttemptCompletion(firstFunctionCall.args);
    }
    
    console.log('最初の関数実行結果:', result);
    
    // 実行結果をGeminiに送信して次のステップを取得
    const secondResponse = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: prompt }] },
        { 
          role: 'model', 
          parts: [{ 
            functionCall: {
              name: firstFunctionCall.name, 
              args: firstFunctionCall.args
            } 
          }]
        },
        { 
          role: 'user', 
          parts: [{ 
            functionResponse: {
              name: firstFunctionCall.name,
              response: { content: result.content, error: result.error }
            } 
          }]
        }
      ]
    });
    
    // 2回目の関数呼び出しを確認
    const secondFunctionCalls = secondResponse.response.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (secondFunctionCalls.length === 0) {
      console.log('❌ 失敗: 2回目の関数呼び出しがありませんでした');
      console.log('応答:', secondResponse.response.text());
      return;
    }
    
    console.log('✅ 成功: 2回目の関数呼び出しが返されました');
    
    // 2回目の関数呼び出し情報を表示
    const secondFunctionCall = secondFunctionCalls[0];
    console.log(`2回目の関数呼び出し: ${secondFunctionCall.name}`);
    console.log('引数:', JSON.stringify(secondFunctionCall.args, null, 2));
    
    // 2回目の関数を実行
    let result2;
    if (secondFunctionCall.name === 'read_file') {
      result2 = await executeReadFile(secondFunctionCall.args);
    } else if (secondFunctionCall.name === 'edit_file') {
      result2 = await executeEditFile(secondFunctionCall.args);
    } else if (secondFunctionCall.name === 'attempt_completion') {
      result2 = await executeAttemptCompletion(secondFunctionCall.args);
    }
    
    console.log('2回目の関数実行結果:', result2);
    
    // 実行結果をGeminiに送信して最終ステップを取得
    const thirdResponse = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: prompt }] },
        { 
          role: 'model', 
          parts: [{ 
            functionCall: {
              name: firstFunctionCall.name, 
              args: firstFunctionCall.args
            } 
          }]
        },
        { 
          role: 'user', 
          parts: [{ 
            functionResponse: {
              name: firstFunctionCall.name,
              response: { content: result.content, error: result.error }
            } 
          }]
        },
        { 
          role: 'model', 
          parts: [{ 
            functionCall: {
              name: secondFunctionCall.name, 
              args: secondFunctionCall.args
            } 
          }]
        },
        { 
          role: 'user', 
          parts: [{ 
            functionResponse: {
              name: secondFunctionCall.name,
              response: { content: result2.content, error: result2.error }
            } 
          }]
        }
      ]
    });
    
    // 3回目の関数呼び出しを確認
    const thirdFunctionCalls = thirdResponse.response.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (thirdFunctionCalls.length === 0) {
      console.log('❌ 失敗: 3回目の関数呼び出しがありませんでした');
      console.log('応答:', thirdResponse.response.text());
      
      // テキスト応答の場合はタスク完了の可能性もある
      console.log('最終応答テキスト:', thirdResponse.response.text());
    } else {
      console.log('✅ 成功: 3回目の関数呼び出しが返されました');
      
      // 3回目の関数呼び出し情報を表示
      const thirdFunctionCall = thirdFunctionCalls[0];
      console.log(`3回目の関数呼び出し: ${thirdFunctionCall.name}`);
      console.log('引数:', JSON.stringify(thirdFunctionCall.args, null, 2));
      
      // attempt_completionの場合はタスク完了
      if (thirdFunctionCall.name === 'attempt_completion') {
        console.log('✅ 成功: タスク完了ツールが呼び出されました');
        console.log('タスク完了メッセージ:', thirdFunctionCall.args.result);
      }
    }
    
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
  } finally {
    await cleanup();
  }
}

// テスト実行
runSequentialToolExecutionTest().catch(error => {
  console.error('テスト実行エラー:', error);
}); 