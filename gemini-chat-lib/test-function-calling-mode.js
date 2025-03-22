require('dotenv').config({ path: './.env.local' });
const { GeminiHandler } = require('./dist/gemini/gemini-handler');

/**
 * FunctionCallingMode.ANYのテスト用スクリプト
 * FunctionCallingMode.ANYを設定することで、常に関数呼び出しが行われることを確認します
 */
async function testFunctionCallingMode() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('環境変数GEMINI_API_KEYが設定されていません。');
    return;
  }

  const handler = new GeminiHandler({
    apiKey: process.env.GEMINI_API_KEY,
    modelId: 'gemini-1.5-pro-002', // FunctionCallingMode.ANYをサポートするモデル
  });

  const testFunctions = [
    {
      name: 'getCurrentWeather',
      description: '特定の場所の現在の天気を取得します',
      parameters: {
        location: {
          type: 'string',
          description: '都市名、例：東京'
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: '温度の単位'
        }
      }
    },
    {
      name: 'searchDatabase',
      description: 'データベースから情報を検索します',
      parameters: {
        query: {
          type: 'string',
          description: '検索クエリ'
        },
        limit: {
          type: 'integer',
          description: '結果の最大数'
        }
      }
    }
  ];

  try {
    // テスト1: 通常なら関数呼び出しを必要としないプロンプトでも関数呼び出しが行われることを確認
    console.log('テスト1: 一般的な質問でも関数呼び出しが強制されるか確認');
    const messages1 = [
      {
        role: 'user',
        content: 'こんにちは、元気ですか？',
        ts: Date.now()
      }
    ];

    const response1 = await handler.sendMessageWithFunctions(messages1, testFunctions);
    console.log('応答:', response1);
    
    if (response1.content && typeof response1.content === 'object' && response1.content[0]?.type === 'function_call') {
      console.log('✅ 成功: 関数呼び出しが返されました');
      console.log('関数名:', response1.content[0].function_call.name);
      console.log('引数:', JSON.stringify(response1.content[0].function_call.arguments, null, 2));
    } else {
      console.log('❌ 失敗: 関数呼び出しが返されませんでした');
    }

    // テスト2: 明らかに関数呼び出しが必要なプロンプト
    console.log('\nテスト2: 明らかに関数呼び出しが必要なプロンプト');
    const messages2 = [
      {
        role: 'user',
        content: '東京の天気を教えてください',
        ts: Date.now()
      }
    ];

    const response2 = await handler.sendMessageWithFunctions(messages2, testFunctions);
    console.log('応答:', response2);
    
    if (response2.content && typeof response2.content === 'object' && response2.content[0]?.type === 'function_call') {
      console.log('✅ 成功: 関数呼び出しが返されました');
      console.log('関数名:', response2.content[0].function_call.name);
      console.log('引数:', JSON.stringify(response2.content[0].function_call.arguments, null, 2));
    } else {
      console.log('❌ 失敗: 関数呼び出しが返されませんでした');
    }

    // テスト3: 特定の関数のみを許可するケース
    console.log('\nテスト3: 特定の関数のみを許可するケース - searchDatabaseのみ');
    const messages3 = [
      {
        role: 'user',
        content: 'データベースから最新の情報を5件検索してください',
        ts: Date.now()
      }
    ];

    // 特定の関数のみを許可する場合、対応するfunctionsも絞る必要がある
    const searchDatabaseFunction = testFunctions.filter(fn => fn.name === 'searchDatabase');
    const allowedFunctions = ['searchDatabase'];
    const response3 = await handler.sendMessageWithFunctions(messages3, searchDatabaseFunction, allowedFunctions);
    console.log('応答:', response3);
    
    if (response3.content && typeof response3.content === 'object' && response3.content[0]?.type === 'function_call') {
      console.log('✅ 成功: 関数呼び出しが返されました');
      console.log('関数名:', response3.content[0].function_call.name);
      console.log('引数:', JSON.stringify(response3.content[0].function_call.arguments, null, 2));
      
      // 許可された関数のみが呼び出されることを確認
      if (allowedFunctions.includes(response3.content[0].function_call.name)) {
        console.log('✅ 成功: 許可された関数のみが呼び出されました');
      } else {
        console.log('❌ 失敗: 許可されていない関数が呼び出されました');
      }
    } else {
      console.log('❌ 失敗: 関数呼び出しが返されませんでした');
    }

    // テスト4: 天気に関する質問でもsearchDatabaseのみを渡す
    console.log('\nテスト4: 天気に関する質問でもsearchDatabaseのみを渡す');
    const messages4 = [
      {
        role: 'user',
        content: '東京の天気を教えてください',
        ts: Date.now()
      }
    ];

    // searchDatabaseのみを渡す
    const response4 = await handler.sendMessageWithFunctions(messages4, searchDatabaseFunction);
    console.log('応答:', response4);
    
    if (response4.content && typeof response4.content === 'object' && response4.content[0]?.type === 'function_call') {
      console.log('✅ 成功: 関数呼び出しが返されました');
      console.log('関数名:', response4.content[0].function_call.name);
      console.log('引数:', JSON.stringify(response4.content[0].function_call.arguments, null, 2));
      
      // searchDatabaseが使われることを確認
      if (response4.content[0].function_call.name === 'searchDatabase') {
        console.log('✅ 成功: searchDatabase関数が呼び出されました');
      } else {
        console.log('❌ 失敗: searchDatabase以外の関数が呼び出されました');
      }
    } else {
      console.log('❌ 失敗: 関数呼び出しが返されませんでした');
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

testFunctionCallingMode(); 