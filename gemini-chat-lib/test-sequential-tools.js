require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI, FunctionCallingMode } = require('@google/generative-ai');

// APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;

// テストディレクトリの作成
const TEST_DIR = path.join(__dirname, 'test-sequential');
const WORKSPACE_ROOT = path.join(__dirname);

// function-tools.tsから必要なツールをインポート
// 注意: TypeScriptのモジュールを直接requireできないため、ビルド済みのJSモジュールを使用
const { createReadFileTool, createEditFileTool, createAttemptCompletionTool } = require('./dist/utils/function-tools');

// ツールの初期化
const readFileTool = createReadFileTool(WORKSPACE_ROOT);
const editFileTool = createEditFileTool(WORKSPACE_ROOT);
const attemptCompletionTool = createAttemptCompletionTool();

// ツール定義をGemini APIフォーマットに変換する関数
function convertToGeminiToolFormat(tool) {
  // propertiesオブジェクトをGeminiフォーマットに変換
  const convertProperties = (properties) => {
    const result = {};
    
    Object.entries(properties).forEach(([key, prop]) => {
      result[key] = {
        type: prop.type.toUpperCase(), // GeminiはSTRINGを期待
        description: prop.description
      };
    });
    
    return result;
  };
  
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "OBJECT",
      properties: convertProperties(tool.parameters.properties),
      required: tool.parameters.required
    }
  };
}

// Gemini APIフォーマットに変換されたツール定義
const geminiReadFileTool = convertToGeminiToolFormat(readFileTool);
const geminiEditFileTool = convertToGeminiToolFormat(editFileTool);
const geminiAttemptCompletionTool = convertToGeminiToolFormat(attemptCompletionTool);

// ツールの実行関数
async function executeReadFile(params) {
  try {
    // パスを調整: test-sequential/ プレフィックスを処理
    let adjustedParams = { ...params };
    if (params.path && params.path.startsWith('test-sequential/')) {
      // テスト用のパスをそのまま使用
      adjustedParams.path = params.path;
    }
    
    // readFileToolのexecuteメソッドを呼び出し
    return await readFileTool.execute(adjustedParams);
  } catch (error) {
    return { error: `ファイル読み込みエラー: ${error.message}` };
  }
}

async function executeEditFile(params) {
  try {
    // JSONの編集に特化した処理
    // テスト用に簡略化された処理を使用
    if (params.target_file && params.target_file.includes('config.json')) {
      const filePath = path.join(TEST_DIR, params.target_file.replace('test-sequential/', ''));
      
      // ファイルの内容を読み込む
      const content = await fs.readFile(filePath, 'utf-8');
      
      // JSONをパース
      const json = JSON.parse(content);
      
      // バージョンを更新 (新しい値を指定した場合)
      if (params.new_version) {
        json.version = params.new_version;
      } else if (params.code_edit) {
        // code_editに含まれるバージョン情報を探す
        const versionMatch = params.code_edit.match(/"version"\s*:\s*"([^"]+)"/);
        if (versionMatch && versionMatch[1]) {
          json.version = versionMatch[1];
        }
      }
      
      // ファイルに書き戻す
      await fs.writeFile(filePath, JSON.stringify(json, null, 2));
      
      return { 
        content: `ファイル ${params.target_file} を更新しました。` +
                (params.new_version ? ` バージョンを ${params.new_version} に変更しました。` : '')
      };
    } else {
      // 標準のeditFileToolを使用
      return await editFileTool.execute(params);
    }
  } catch (error) {
    return { error: `ファイル編集エラー: ${error.message}` };
  }
}

async function executeAttemptCompletion(params) {
  return await attemptCompletionTool.execute(params);
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
    
    // function-tools.tsから取得したツール定義を使用（Gemini用に変換）
    const tools = [{
      functionDeclarations: [
        geminiReadFileTool,
        geminiEditFileTool,
        geminiAttemptCompletionTool
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
    const prompt = `以下の手順で作業を進めてください：
1. test-sequential/config.jsonファイルの内容を${geminiReadFileTool.name}ツールを使用して読み込む
2. ${geminiEditFileTool.name}ツールを使用してconfig.jsonのバージョンを"2.0.0"に更新する
3. 完了したら${geminiAttemptCompletionTool.name}ツールを使用して結果を報告する

必ず指定されたツールを順番に使用してください。`;
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
    if (firstFunctionCall.name === geminiReadFileTool.name) {
      result = await executeReadFile(firstFunctionCall.args);
    } else if (firstFunctionCall.name === geminiEditFileTool.name) {
      result = await executeEditFile(firstFunctionCall.args);
    } else if (firstFunctionCall.name === geminiAttemptCompletionTool.name) {
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
    if (secondFunctionCall.name === geminiReadFileTool.name) {
      result2 = await executeReadFile(secondFunctionCall.args);
    } else if (secondFunctionCall.name === geminiEditFileTool.name) {
      result2 = await executeEditFile(secondFunctionCall.args);
    } else if (secondFunctionCall.name === geminiAttemptCompletionTool.name) {
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
      if (thirdFunctionCall.name === geminiAttemptCompletionTool.name) {
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