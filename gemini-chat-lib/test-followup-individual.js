require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI, FunctionCallingMode } = require('@google/generative-ai');
const readline = require('readline');

// APIキーを環境変数から取得
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('APIキーが設定されていません。.env.localファイルにGEMINI_API_KEYを設定してください。');
  process.exit(1);
}

// テストケース番号をコマンドライン引数から取得
const testCaseIndex = process.argv[2] ? parseInt(process.argv[2], 10) - 1 : 0;

// Gemini APIクライアントの初期化
const genAI = new GoogleGenerativeAI(apiKey);

// モデルの取得（システムインストラクション付き）
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  systemInstruction: `あなたは便利なAIアシスタントです。
与えられた情報が不十分な場合は、ask_followup_questionツールを使用して追加情報を求めてください。
情報が十分にある場合は、適切なツールを使用して応答してください。`,
});

// readlineインターフェースの作成
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 関数定義
const tools = [
  {
    functionDeclarations: [
      {
        name: "read_file",
        description: "ファイルの内容を読み込みます。結果は1から始まる行番号と共に表示されます。",
        parameters: {
          type: "OBJECT",
          properties: {
            path: {
              type: "STRING",
              description: "ファイルのパス（ワークスペースのルートからの相対パス）"
            }
          },
          required: ["path"]
        }
      }
    ]
  },
  {
    functionDeclarations: [
      {
        name: "list_dir",
        description: "ディレクトリの内容を一覧表示します。",
        parameters: {
          type: "OBJECT",
          properties: {
            relative_workspace_path: {
              type: "STRING",
              description: "ワークスペースのルートからの相対パス"
            }
          },
          required: ["relative_workspace_path"]
        }
      }
    ]
  },
  {
    functionDeclarations: [
      {
        name: "ask_followup_question",
        description: "タスクを完了するために必要な追加情報を収集するためにユーザーに質問します。",
        parameters: {
          type: "OBJECT",
          properties: {
            question: {
              type: "STRING",
              description: "ユーザーに尋ねる質問"
            }
          },
          required: ["question"]
        }
      }
    ]
  }
];

// ツール関数の実装
async function handleFunctionCall(functionCall) {
  const { name, args } = functionCall;
  
  console.log(`\n関数が呼び出されました: ${name}`);
  console.log(`引数: ${JSON.stringify(args, null, 2)}`);
  
  switch (name) {
    case 'ask_followup_question':
      console.log('\n【テスト結果】: モデルは情報不足を検出し、聞き返しを行いました ✓');
      return await new Promise((resolve) => {
        rl.question(`\n${args.question}\nあなたの回答: `, (answer) => {
          resolve(answer);
        });
      });
    
    case 'list_dir':
      console.log('\n【テスト結果】: モデルは十分な情報があると判断し、list_dirツールを選択しました ✓');
      return `"${args.relative_workspace_path}" の内容:\n- package.json\n- tsconfig.json\n- src/\n- dist/\n- node_modules/`;
    
    case 'read_file':
      console.log('\n【テスト結果】: モデルは十分な情報があると判断し、read_fileツールを選択しました ✓');
      return `1 | # README\n2 | これはサンプルファイルです。`;
    
    default:
      return `未知の関数が呼び出されました: ${name}`;
  }
}

// テストケース
const testCases = [
  {
    description: '曖昧な質問（聞き返しが必要）',
    input: 'このファイルを更新してください',
    expectation: 'ask_followup_questionが使用され、どのファイルを更新するか聞き返される'
  },
  {
    description: '明確な質問（聞き返し不要）',
    input: '現在のディレクトリの内容を表示してください',
    expectation: 'list_dirツールが使用され、カレントディレクトリの内容が表示される'
  },
  {
    description: '曖昧な質問（聞き返しが必要）',
    input: 'コードの問題点を教えてください',
    expectation: 'ask_followup_questionが使用され、どのコードについて説明すべきか聞き返される'
  },
  {
    description: '明確な質問（聞き返し不要）',
    input: 'README.mdファイルの内容を表示してください',
    expectation: 'read_fileツールが使用され、README.mdの内容が表示される'
  }
];

// 単一のテストケースを実行
async function runSingleTest() {
  // 有効なテストケース番号かチェック
  if (testCaseIndex < 0 || testCaseIndex >= testCases.length) {
    console.error(`無効なテストケース番号です。1から${testCases.length}の範囲で指定してください。`);
    process.exit(1);
  }
  
  const testCase = testCases[testCaseIndex];
  
  console.log('フォローアップ質問機能のテストを開始します。');
  console.log(`\n-------------------------------------`);
  console.log(`テストケース ${testCaseIndex + 1}: ${testCase.description}`);
  console.log(`入力: "${testCase.input}"`);
  console.log(`期待される動作: ${testCase.expectation}`);
  console.log(`-------------------------------------`);
  
  // チャット履歴
  let chatHistory = [];
  
  // ユーザー入力をチャット履歴に追加
  chatHistory.push({
    role: "user",
    parts: [{ text: testCase.input }]
  });
  
  try {
    // 会話を生成
    const result = await model.generateContent({
      contents: chatHistory,
      tools: tools,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY
        }
      }
    });
    
    const response = result.response;
    const functionCall = response.candidates[0]?.content?.parts?.find(
      part => part.functionCall
    )?.functionCall;
    
    if (functionCall) {
      // 関数が呼び出された場合
      const functionResponse = await handleFunctionCall(functionCall);
      
      // 関数の応答をチャット履歴に追加
      chatHistory.push({
        role: "model",
        parts: [{ functionCall }]
      });
      
      chatHistory.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: functionCall.name,
            response: { text: functionResponse }
          }
        }]
      });
      
      // 関数の結果に基づいて続きの応答を取得
      const followupResult = await model.generateContent({
        contents: chatHistory
      });
      
      const finalResponse = followupResult.response.text();
      
      console.log(`\n最終応答: ${finalResponse}`);
    } else {
      // 通常のテキスト応答の場合
      const textResponse = response.text();
      console.log(`\n最終応答: ${textResponse}`);
    }
    
    console.log('\nテストが完了しました。');
    
  } catch (error) {
    console.error(`エラーが発生しました: ${error.message}`);
  } finally {
    rl.close();
  }
}

// テストの実行
runSingleTest().catch(error => {
  console.error(`テスト実行中にエラーが発生しました: ${error.message}`);
  rl.close();
}); 