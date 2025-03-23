require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, FunctionCallingMode } = require('@google/generative-ai');
const { createTools } = require('./dist/index');

// APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;

// 一時テストディレクトリの作成
const TEST_DIR = path.join(__dirname, 'test-mixed');

async function setup() {
  try {
    // テストディレクトリの作成
    await fs.mkdir(TEST_DIR, { recursive: true });
    console.log('テスト環境を準備しました。');
  } catch (error) {
    console.error('テスト環境の準備に失敗しました:', error);
    process.exit(1);
  }
}

async function cleanup() {
  try {
    // テストディレクトリの削除
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    console.log('テスト環境をクリーンアップしました。');
  } catch (error) {
    console.error('テスト環境のクリーンアップに失敗しました:', error);
  }
}

// ツールの実行関数
async function executeFunction(name, args) {
  // 全ツールのリストを取得
  const tools = createTools(TEST_DIR);
  
  // 指定された名前のツールを検索
  const tool = tools.find(t => t.name === name);
  if (!tool) {
    return { error: `Tool '${name}' not found` };
  }
  
  // ツールを実行
  try {
    return await tool.execute(args);
  } catch (error) {
    return { 
      error: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function runMixedTest() {
  await setup();
  const genAI = new GoogleGenerativeAI(API_KEY);
  
  // ツールを定義
  const tools = [
    {
      functionDeclarations: [
        {
          name: "edit_file",
          description: "既存のファイルに編集を提案します。",
          parameters: {
            type: "OBJECT",
            properties: {
              target_file: {
                type: "STRING",
                description: "編集対象のファイルパス"
              },
              instructions: {
                type: "STRING",
                description: "編集の内容を説明する一文"
              },
              code_edit: {
                type: "STRING",
                description: "編集したいコードの内容"
              }
            },
            required: ["target_file", "instructions", "code_edit"]
          }
        }
      ]
    },
    {
      functionDeclarations: [
        {
          name: "write_to_file",
          description: "新しいファイルを作成するか、既存のファイルを上書きします。",
          parameters: {
            type: "OBJECT",
            properties: {
              path: {
                type: "STRING",
                description: "書き込み先のファイルパス"
              },
              content: {
                type: "STRING",
                description: "ファイルに書き込む内容"
              },
              line_count: {
                type: "NUMBER",
                description: "書き込む内容の行数"
              }
            },
            required: ["path", "content", "line_count"]
          }
        }
      ]
    },
    {
      functionDeclarations: [
        {
          name: "read_file",
          description: "ファイルの内容を読み込みます。",
          parameters: {
            type: "OBJECT",
            properties: {
              path: {
                type: "STRING",
                description: "読み込むファイルのパス"
              }
            },
            required: ["path"]
          }
        }
      ]
    }
  ];

  // テスト1: テキスト応答のみのケース (FunctionCallingMode.AUTO)
  try {
    console.log('\n===== テスト1: テキスト応答のみのケース (FunctionCallingMode.AUTO) =====');
    
    // モデルを初期化 (AUTO モード)
    const autoModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.2
      },
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO', // AUTOモードを使用
        }
      },
      tools
    });
    
    // テキスト応答を求めるプロンプト
    const textPrompt = `宇宙について教えてください。簡潔に答えてください。`;
    
    console.log('プロンプト:', textPrompt);
    
    // Gemini APIを呼び出し
    const textResult = await autoModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: textPrompt }] }]
    });
    
    const textResponse = textResult.response;
    
    // 関数呼び出しがあるか確認
    const textFunctionCalls = textResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (textFunctionCalls.length > 0) {
      console.log('❌ 失敗: テキスト応答が期待されていたのに関数呼び出しがありました');
      for (const functionCall of textFunctionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
      }
    } else {
      console.log('✅ 成功: 期待通りテキスト応答が返されました');
      console.log('応答:', textResponse.text());
    }
    
  } catch (error) {
    console.error('テスト1でエラーが発生しました:', error);
  }

  // テスト2: 明示的なファイル編集要求で関数呼び出しが行われるか (FunctionCallingMode.AUTO)
  try {
    console.log('\n===== テスト2: 明示的なファイル編集要求で関数呼び出しが行われるか (FunctionCallingMode.AUTO) =====');
    
    // モデルを初期化 (AUTO モード)
    const autoModel = genAI.getGenerativeModel({
      model: 'gemini-1.5-pro',
      generationConfig: {
        temperature: 0.2
      },
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO', // AUTOモードを使用
        }
      },
      tools
    });
    
    // ファイル編集を求めるプロンプト
    const editPrompt = `test.jsという新しいファイルを作成して、簡単なHello World関数を含めてください。`;
    
    console.log('プロンプト:', editPrompt);
    
    // Gemini APIを呼び出し
    const editResult = await autoModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: editPrompt }] }]
    });
    
    const editResponse = editResult.response;
    
    // 関数呼び出しがあるか確認
    const editFunctionCalls = editResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (editFunctionCalls.length > 0) {
      console.log('✅ 成功: 期待通り関数呼び出しが返されました');
      for (const functionCall of editFunctionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
        console.log('引数:', JSON.stringify(functionCall.args, null, 2));
        
        // 関数を実行
        const result = await executeFunction(functionCall.name, functionCall.args);
        console.log('実行結果:', result);
      }
    } else {
      console.log('❌ 失敗: 関数呼び出しが期待されていたのにテキスト応答が返されました');
      console.log('応答:', editResponse.text());
    }
    
  } catch (error) {
    console.error('テスト2でエラーが発生しました:', error);
  }

  // テスト3: 通常の質問でも強制的に関数呼び出しを行う (FunctionCallingMode.ANY)
  try {
    console.log('\n===== テスト3: 通常の質問でも強制的に関数呼び出しを行う (FunctionCallingMode.ANY) =====');
    
    // モデルを初期化 (ANY モード)
    const anyModel = genAI.getGenerativeModel({
      model: 'gemini-1.5-pro',
      generationConfig: {
        temperature: 0.2
      },
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY, // ANYモードを使用
        }
      },
      tools
    });
    
    // 通常の質問プロンプト
    const anyPrompt = `富士山の高さは何メートルですか？`;
    
    console.log('プロンプト:', anyPrompt);
    
    // Gemini APIを呼び出し
    const anyResult = await anyModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: anyPrompt }] }]
    });
    
    const anyResponse = anyResult.response;
    
    // 関数呼び出しがあるか確認
    const anyFunctionCalls = anyResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (anyFunctionCalls.length > 0) {
      console.log('✅ 成功: ANYモードでは通常の質問でも関数呼び出しが返されました');
      for (const functionCall of anyFunctionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
        console.log('引数:', JSON.stringify(functionCall.args, null, 2));
      }
    } else {
      console.log('❌ 失敗: ANYモードなのに関数呼び出しがありませんでした');
      console.log('応答:', anyResponse.text());
    }
    
  } catch (error) {
    console.error('テスト3でエラーが発生しました:', error);
  }

  await cleanup();
}

runMixedTest(); 