require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, FunctionCallingMode } = require('@google/generative-ai');
const { createTools } = require('./dist/index');

// APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;

// 一時テストディレクトリの作成
const TEST_DIR = path.join(__dirname, 'test-files');

async function setup() {
  try {
    // テストディレクトリの作成
    await fs.mkdir(TEST_DIR, { recursive: true });
    
    // テスト用ファイルの作成
    await fs.writeFile(
      path.join(TEST_DIR, 'sample.js'),
      `// サンプルJavaScriptファイル
function hello() {
  console.log('Hello, World!');
}

function add(a, b) {
  return a + b;
}

module.exports = {
  hello,
  add
};
`
    );
    
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

async function runTest() {
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

  // モデルを初期化
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-pro',
    generationConfig: {
      temperature: 0.2
    },
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
      }
    },
    tools
  });

  try {
    // 1. ファイル編集機能のテスト
    console.log('\n===== ファイル編集機能テスト =====');
    
    // sample.jsの内容を読み込み
    console.log('現在のsample.jsファイルの内容:');
    const sampleContent = await fs.readFile(path.join(TEST_DIR, 'sample.js'), 'utf8');
    console.log(sampleContent);
    
    // AIに編集を依頼
    const editPrompt = `sample.jsファイルを編集して、新しく multiply 関数を追加してください。関数の形式は「function multiply(a, b) { return a * b; }」とし、module.exportsにも追加してください。

edit_fileツールを使用する際は、次の3つのパラメータを指定してください:
1. target_file: "sample.js" （編集対象のファイル）
2. instructions: "multiply関数を追加し、module.exportsに追加する" （編集内容の説明）
3. code_edit: 編集内容（既存コードを保持しつつ、新しい関数を追加するコード。"// ... existing code ..."コメントを使って既存コードの場所を示してください）`;
    
    // Gemini APIを呼び出し
    const editResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: editPrompt }] }]
    });
    
    const editResponse = editResult.response;
    console.log('応答:', editResponse.text());
    
    // 関数呼び出しがあるか確認
    const functionCalls = editResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (functionCalls.length > 0) {
      for (const functionCall of functionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
        console.log('引数:', JSON.stringify(functionCall.args, null, 2));
        
        // 関数を実行
        const result = await executeFunction(functionCall.name, functionCall.args);
        console.log('実行結果:', result);
      }
      
      // 編集後のファイル内容を表示
      const editedContent = await fs.readFile(path.join(TEST_DIR, 'sample.js'), 'utf8');
      console.log('\n編集後のsample.jsファイルの内容:');
      console.log(editedContent);
    } else {
      console.log('関数呼び出しはありませんでした。');
    }
    
    // 2. 新規ファイル作成のテスト
    console.log('\n===== 新規ファイル作成テスト =====');
    
    // AIに新規ファイル作成を依頼
    const createPrompt = `utils.jsという新しいファイルを作成して、文字列を大文字にする uppercase 関数と、文字列を小文字にする lowercase 関数を定義してください。`;
    
    // Gemini APIを呼び出し
    const createResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: createPrompt }] }]
    });
    
    const createResponse = createResult.response;
    console.log('応答:', createResponse.text());
    
    // 関数呼び出しがあるか確認
    const createFunctionCalls = createResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (createFunctionCalls.length > 0) {
      for (const functionCall of createFunctionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
        console.log('引数:', JSON.stringify(functionCall.args, null, 2));
        
        // 関数を実行
        const result = await executeFunction(functionCall.name, functionCall.args);
        console.log('実行結果:', result);
      }
      
      // 作成されたファイルの内容を表示
      try {
        const createdContent = await fs.readFile(path.join(TEST_DIR, 'utils.js'), 'utf8');
        console.log('\n作成されたutils.jsファイルの内容:');
        console.log(createdContent);
      } catch (error) {
        console.error('ファイル読み込みエラー:', error);
      }
    } else {
      console.log('関数呼び出しはありませんでした。');
    }

  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error);
  }
}

// テストの実行
(async () => {
  try {
    await setup();
    await runTest();
  } finally {
    // テスト終了後のクリーンアップ
    await cleanup();
  }
})(); 