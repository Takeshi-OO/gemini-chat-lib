require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, FunctionCallingMode } = require('@google/generative-ai');
const { createTools } = require('./dist/index');

// APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;

// 一時テストディレクトリの作成
const TEST_DIR = path.join(__dirname, 'test-completion');

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

async function runCompletionToolTest() {
  await setup();
  const genAI = new GoogleGenerativeAI(API_KEY);
  
  // ツールを定義
  const tools = [
    {
      functionDeclarations: [
        {
          name: "attempt_completion",
          description: "タスク完了を示します。各ツールの使用後、ユーザーはそのツールの成功または失敗と失敗の理由を応答します。タスクが完了したことを確認できたら、このツールを使用してユーザーに作業結果を提示します。オプションで、作業結果をデモするためのCLIコマンドを提供することもできます。",
          parameters: {
            type: "OBJECT",
            properties: {
              result: {
                type: "STRING",
                description: "タスクの結果。この結果がユーザーからのさらなる入力を必要としない形式で表現してください。結果の最後に質問や更なる支援の申し出を含めないでください。"
              },
              command: {
                type: "STRING",
                description: "ユーザーに結果のライブデモを表示するためのCLIコマンド（オプション）。例えば、作成したHTMLウェブサイトを表示するには `open index.html` を使用するか、ローカルで実行している開発サーバーを表示するには `open localhost:3000` を使用します。ただし、`echo` や `cat` などの単にテキストを出力するコマンドは使用しないでください。"
              }
            },
            required: ["result"]
          }
        },
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
        },
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
    }
  ];

  // テスト1: 明確に完了可能なタスク
  try {
    console.log('\n===== テスト1: 明確に完了可能なタスク =====');
    
    // モデルを初期化 (ANY モード)
    const anyModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
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
    
    // 明確に完了可能なタスク
    const completionPrompt = `hello.txtというファイルに「こんにちは、世界！」というテキストを書き込んでください。`;
    
    console.log('プロンプト:', completionPrompt);
    
    // Gemini APIを呼び出し
    const initialResult = await anyModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: completionPrompt }] }]
    });
    
    const initialResponse = initialResult.response;
    
    // 関数呼び出しがあるか確認
    const initialFunctionCalls = initialResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (initialFunctionCalls.length > 0) {
      console.log('✅ 成功: 関数呼び出しが返されました');
      for (const functionCall of initialFunctionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
        console.log('引数:', JSON.stringify(functionCall.args, null, 2));
        
        // 関数を実行
        const result = await executeFunction(functionCall.name, functionCall.args);
        console.log('実行結果:', result);

        // ユーザーからの成功応答
        const userResponse = `ファイルの作成に成功しました。他に何かできることはありますか？`;
        console.log('ユーザー応答:', userResponse);

        // 次の応答を生成
        const nextResult = await anyModel.generateContent({
          contents: [
            { role: 'user', parts: [{ text: completionPrompt }] },
            { role: 'model', parts: initialResponse.candidates[0].content.parts },
            { role: 'user', parts: [{ text: userResponse }] }
          ]
        });

        const nextResponse = nextResult.response;
        const nextFunctionCalls = nextResponse.candidates[0].content.parts
          .filter(part => part.functionCall)
          .map(part => part.functionCall);

        if (nextFunctionCalls.length > 0) {
          const completionCall = nextFunctionCalls.find(call => call.name === 'attempt_completion');
          if (completionCall) {
            console.log('✅ 成功: タスク完了ツールが呼び出されました');
            console.log('タスク完了結果:', JSON.stringify(completionCall.args, null, 2));
          } else {
            console.log('❌ 失敗: タスク完了ツールの呼び出しが期待されていましたが、別のツールが呼び出されました');
            console.log('呼び出されたツール:', nextFunctionCalls[0].name);
          }
        } else {
          console.log('❌ 失敗: 関数呼び出しがありませんでした');
          console.log('応答:', nextResponse.text());
        }
      }
    } else {
      console.log('❌ 失敗: 関数呼び出しがありませんでした');
      console.log('応答:', initialResponse.text());
    }
    
  } catch (error) {
    console.error('テスト1でエラーが発生しました:', error);
  }

  // テスト2: まだ完了していないタスク
  try {
    console.log('\n===== テスト2: まだ完了していないタスク =====');
    
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
    
    // まだ完了していないタスク
    const incompletePrompt = `hello.txtとworld.txtという2つのファイルを作成してください。hello.txtには「こんにちは」、world.txtには「世界」と書き込んでください。`;
    
    console.log('プロンプト:', incompletePrompt);
    
    // Gemini APIを呼び出し
    const initialResult = await anyModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: incompletePrompt }] }]
    });
    
    const initialResponse = initialResult.response;
    
    // 関数呼び出しがあるか確認
    const initialFunctionCalls = initialResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (initialFunctionCalls.length > 0) {
      console.log('✅ 成功: 関数呼び出しが返されました');
      for (const functionCall of initialFunctionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
        console.log('引数:', JSON.stringify(functionCall.args, null, 2));
        
        // 関数を実行
        const result = await executeFunction(functionCall.name, functionCall.args);
        console.log('実行結果:', result);

        // ユーザーからの部分的成功応答
        const userResponse = `最初のファイルの作成には成功しましたが、まだ2つ目のファイルが必要です。`;
        console.log('ユーザー応答:', userResponse);

        // 次の応答を生成
        const nextResult = await anyModel.generateContent({
          contents: [
            { role: 'user', parts: [{ text: incompletePrompt }] },
            { role: 'model', parts: initialResponse.candidates[0].content.parts },
            { role: 'user', parts: [{ text: userResponse }] }
          ]
        });

        const nextResponse = nextResult.response;
        const nextFunctionCalls = nextResponse.candidates[0].content.parts
          .filter(part => part.functionCall)
          .map(part => part.functionCall);

        if (nextFunctionCalls.length > 0) {
          const completionCall = nextFunctionCalls.find(call => call.name === 'attempt_completion');
          if (completionCall) {
            console.log('❌ 失敗: タスク完了ツールが呼び出されましたが、タスクはまだ完了していません');
            console.log('タスク完了結果:', JSON.stringify(completionCall.args, null, 2));
          } else {
            console.log('✅ 成功: タスク完了ツールではなく、別のツールが呼び出されました');
            console.log('呼び出されたツール:', nextFunctionCalls[0].name);
            console.log('引数:', JSON.stringify(nextFunctionCalls[0].args, null, 2));
          }
        } else {
          console.log('❌ 失敗: 関数呼び出しがありませんでした');
          console.log('応答:', nextResponse.text());
        }
      }
    } else {
      console.log('❌ 失敗: 関数呼び出しがありませんでした');
      console.log('応答:', initialResponse.text());
    }
    
  } catch (error) {
    console.error('テスト2でエラーが発生しました:', error);
  }

  // テスト3: 情報が不足していて質問が必要なケース
  try {
    console.log('\n===== テスト3: 情報が不足していて質問が必要なケース =====');
    
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
      tools: [
        {
          functionDeclarations: [
            {
              name: "attempt_completion",
              description: "タスク完了を示します。各ツールの使用後、ユーザーはそのツールの成功または失敗と失敗の理由を応答します。タスクが完了したことを確認できたら、このツールを使用してユーザーに作業結果を提示します。オプションで、作業結果をデモするためのCLIコマンドを提供することもできます。",
              parameters: {
                type: "OBJECT",
                properties: {
                  result: {
                    type: "STRING",
                    description: "タスクの結果。この結果がユーザーからのさらなる入力を必要としない形式で表現してください。結果の最後に質問や更なる支援の申し出を含めないでください。"
                  },
                  command: {
                    type: "STRING",
                    description: "ユーザーに結果のライブデモを表示するためのCLIコマンド（オプション）。例えば、作成したHTMLウェブサイトを表示するには `open index.html` を使用するか、ローカルで実行している開発サーバーを表示するには `open localhost:3000` を使用します。ただし、`echo` や `cat` などの単にテキストを出力するコマンドは使用しないでください。"
                  }
                },
                required: ["result"]
              }
            },
            {
              name: "ask_followup_question",
              description: "ユーザーに追加情報や明確な説明を求める必要がある場合に使用します。",
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
            },
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
        }
      ]
    });
    
    // 情報が不足しているタスク
    const ambiguousPrompt = `必要なことをしてください。`;
    
    console.log('プロンプト:', ambiguousPrompt);
    
    // Gemini APIを呼び出し
    const initialResult = await anyModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: ambiguousPrompt }] }]
    });
    
    const initialResponse = initialResult.response;
    
    // 関数呼び出しがあるか確認
    const initialFunctionCalls = initialResponse.candidates[0].content.parts
      .filter(part => part.functionCall)
      .map(part => part.functionCall);
    
    if (initialFunctionCalls.length > 0) {
      console.log('✅ 成功: 関数呼び出しが返されました');
      for (const functionCall of initialFunctionCalls) {
        console.log(`関数呼び出し: ${functionCall.name}`);
        console.log('引数:', JSON.stringify(functionCall.args, null, 2));
        
        // 呼び出されたのは質問ツールか確認
        if (functionCall.name === 'ask_followup_question') {
          console.log('✅ 成功: 情報不足のため質問ツールが呼び出されました');
          
          // 関数を実行
          const result = await executeFunction(functionCall.name, functionCall.args);
          console.log('実行結果:', result);

          // ユーザーからの応答
          const userResponse = `example.txtというファイルに「これはテストです」と書き込んでください。`;
          console.log('ユーザー応答:', userResponse);

          // 次の応答を生成
          const nextResult = await anyModel.generateContent({
            contents: [
              { role: 'user', parts: [{ text: ambiguousPrompt }] },
              { role: 'model', parts: initialResponse.candidates[0].content.parts },
              { role: 'user', parts: [{ text: userResponse }] }
            ]
          });

          const nextResponse = nextResult.response;
          const nextFunctionCalls = nextResponse.candidates[0].content.parts
            .filter(part => part.functionCall)
            .map(part => part.functionCall);

          if (nextFunctionCalls.length > 0) {
            const completionCall = nextFunctionCalls.find(call => call.name === 'attempt_completion');
            const writeFileCall = nextFunctionCalls.find(call => call.name === 'write_to_file');
            
            if (completionCall) {
              console.log('❌ 失敗: 情報が得られたのにタスク完了ツールが呼び出されました。まだファイル作成が必要です。');
              console.log('タスク完了結果:', JSON.stringify(completionCall.args, null, 2));
            } else if (writeFileCall) {
              console.log('✅ 成功: 情報取得後、適切なツール（ファイル作成）が呼び出されました');
              console.log('ファイル作成引数:', JSON.stringify(writeFileCall.args, null, 2));
              
              // 関数を実行
              const writeResult = await executeFunction(writeFileCall.name, writeFileCall.args);
              console.log('実行結果:', writeResult);
              
              // タスク成功の応答
              const successResponse = `ファイルが正常に作成されました！ありがとうございます。`;
              console.log('ユーザー応答:', successResponse);
              
              // 最終応答を生成
              const finalResult = await anyModel.generateContent({
                contents: [
                  { role: 'user', parts: [{ text: ambiguousPrompt }] },
                  { role: 'model', parts: initialResponse.candidates[0].content.parts },
                  { role: 'user', parts: [{ text: userResponse }] },
                  { role: 'model', parts: nextResponse.candidates[0].content.parts },
                  { role: 'user', parts: [{ text: successResponse }] }
                ]
              });
              
              const finalResponse = finalResult.response;
              const finalFunctionCalls = finalResponse.candidates[0].content.parts
                .filter(part => part.functionCall)
                .map(part => part.functionCall);
              
              if (finalFunctionCalls.length > 0) {
                const finalCompletionCall = finalFunctionCalls.find(call => call.name === 'attempt_completion');
                if (finalCompletionCall) {
                  console.log('✅ 成功: タスク完了後、タスク完了ツールが呼び出されました');
                  console.log('タスク完了結果:', JSON.stringify(finalCompletionCall.args, null, 2));
                } else {
                  console.log('❌ 失敗: タスク完了ツールではなく別のツールが呼び出されました');
                  console.log('呼び出されたツール:', finalFunctionCalls[0].name);
                }
              } else {
                console.log('❌ 失敗: 関数呼び出しがありませんでした');
                console.log('応答:', finalResponse.text());
              }
            } else {
              console.log('❌ 失敗: 予期しないツールが呼び出されました');
              console.log('呼び出されたツール:', nextFunctionCalls[0].name);
            }
          } else {
            console.log('❌ 失敗: 関数呼び出しがありませんでした');
            console.log('応答:', nextResponse.text());
          }
        } else {
          console.log('❌ 失敗: 情報不足なのに質問ツール以外が呼び出されました');
          console.log('呼び出されたツール:', functionCall.name);
        }
      }
    } else {
      console.log('❌ 失敗: 関数呼び出しがありませんでした');
      console.log('応答:', initialResponse.text());
    }
    
  } catch (error) {
    console.error('テスト3でエラーが発生しました:', error);
  }

  await cleanup();
}

runCompletionToolTest(); 