import { readFile } from './file-utils';
import { ContextHelper } from './context-helper';
import * as path from 'path';

/**
 * ツールパラメータの型定義
 */
export interface ToolParams {
  [key: string]: any;
}

/**
 * ツール呼び出しの結果型
 */
export interface ToolResult {
  content: string;
  error?: string;
}

/**
 * プロパティの型定義
 */
export interface PropertyType {
  type: string;
  description: string;
  items?: {
    type: string;
  };
}

/**
 * ファイル読み込みツールの引数型
 */
export interface ReadFileParams extends ToolParams {
  path: string;
  offset?: number;
  limit?: number;
  should_read_entire_file?: boolean;
}

/**
 * タスク完了ツールのパラメータ型
 */
export interface AttemptCompletionParams extends ToolParams {
  result: string;
  command?: string;
}

/**
 * 関数ツールの型定義
 */
export interface FunctionTool {
  name: string;
  description: string;
  execute: (params: ToolParams) => Promise<ToolResult>;
  parameters: {
    properties: {
      [key: string]: PropertyType;
    };
    required: string[];
  };
}

/**
 * ファイル読み込みツール
 * @param workspaceRoot ワークスペースのルートパス
 * @returns ファイル読み込みツール定義
 */
export function createReadFileTool(workspaceRoot: string): FunctionTool {
  return {
    name: 'read_file',
    description: 'ファイルの内容を読み込みます。結果は1から始まる行番号と共に表示されます（例: "1 | const x = 1"）。',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: 'ファイルのパス（ワークスペースのルートからの相対パス）'
        },
        offset: {
          type: 'integer',
          description: '読み込みを開始する行番号。省略可能。'
        },
        limit: {
          type: 'integer',
          description: '読み込む行数。省略可能。'
        },
        should_read_entire_file: {
          type: 'boolean',
          description: 'ファイル全体を読むかどうか。trueの場合、offsetとlimitは無視されます。'
        }
      },
      required: ['path']
    },
    execute: async (params: ToolParams): Promise<ToolResult> => {
      try {
        const readFileParams = params as ReadFileParams;
        const filePath = path.resolve(workspaceRoot, readFileParams.path);
        const options = {
          offset: readFileParams.offset,
          limit: readFileParams.limit,
          lineLimit: readFileParams.should_read_entire_file ? undefined : 250
        };
        
        const content = await readFile(filePath, options);
        return { content };
      } catch (error) {
        return {
          content: '',
          error: `ファイル読み込みエラー: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  };
}

/**
 * コードベース検索ツールのパラメータ型
 */
export interface CodebaseSearchParams extends ToolParams {
  query: string;
  target_directories?: string[];
  explanation?: string;
}

/**
 * コードベース検索ツール
 * @param workspaceRoot ワークスペースのルートパス
 * @returns コードベース検索ツール定義
 */
export function createCodebaseSearchTool(workspaceRoot: string): FunctionTool {
  return {
    name: 'codebase_search',
    description: 'コードベースから検索クエリに最も関連するコードスニペットを検索します。これはセマンティック検索ツールです。',
    parameters: {
      properties: {
        query: {
          type: 'string',
          description: '関連するコードを見つけるための検索クエリ'
        },
        target_directories: {
          type: 'array',
          description: '検索対象のディレクトリを指定するグロブパターン',
          items: {
            type: 'string'
          }
        },
        explanation: {
          type: 'string',
          description: 'このツールを使用する理由と目標達成への貢献に関する短い説明'
        }
      },
      required: ['query']
    },
    execute: async (params: ToolParams): Promise<ToolResult> => {
      try {
        const searchParams = params as CodebaseSearchParams;
        // ファイル一覧を取得
        const fileList = await ContextHelper.listFiles(workspaceRoot, {
          maxFiles: 500,
          ignoreDirs: ['.git', 'node_modules', 'dist', 'build'],
        });
        
        // ユーザーのクエリに関連するファイルを推論
        const relevantFiles = ContextHelper.inferRelevantFiles(searchParams.query, workspaceRoot, fileList);
        
        let result = '';
        
        // 関連ファイルの内容を収集
        if (relevantFiles.length > 0) {
          for (const file of relevantFiles.slice(0, 3)) {
            try {
              const filePath = path.join(workspaceRoot, file);
              const content = await readFile(filePath, { lineLimit: 100 });
              
              result += `\`\`\`${path.extname(file).substring(1) || 'text'}:${file}\n${content}\n\`\`\`\n\n`;
            } catch (error) {
              // ファイル読み込みエラーは無視
            }
          }
        }
        
        if (!result) {
          return {
            content: '検索クエリに関連するファイルは見つかりませんでした。',
          };
        }
        
        return { content: result };
      } catch (error) {
        return {
          content: '',
          error: `検索エラー: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  };
}

/**
 * ディレクトリ一覧ツールのパラメータ型
 */
export interface ListDirParams extends ToolParams {
  relative_workspace_path: string;
  explanation?: string;
}

/**
 * フォローアップ質問ツールのパラメータ型
 */
export interface AskFollowupQuestionParams extends ToolParams {
  question: string;
}

/**
 * ディレクトリ一覧ツール
 * @param workspaceRoot ワークスペースのルートパス
 * @returns ディレクトリ一覧ツール定義
 */
export function createListDirTool(workspaceRoot: string): FunctionTool {
  return {
    name: 'list_dir',
    description: 'ディレクトリの内容を一覧表示します。特定のファイルを深く調べる前に、コードベースの構造を理解するための迅速なツールです。',
    parameters: {
      properties: {
        relative_workspace_path: {
          type: 'string',
          description: 'ワークスペースのルートからの相対パス'
        },
        explanation: {
          type: 'string',
          description: 'このツールを使用する理由と目標達成への貢献に関する短い説明'
        }
      },
      required: ['relative_workspace_path']
    },
    execute: async (params: ToolParams): Promise<ToolResult> => {
      try {
        const dirParams = params as ListDirParams;
        const dirPath = path.resolve(workspaceRoot, dirParams.relative_workspace_path);
        const entries = await ContextHelper.listFiles(dirPath, { maxFiles: 50 });
        
        if (entries.length === 0) {
          return {
            content: `ディレクトリ "${dirParams.relative_workspace_path}" は空であるか、アクセスできません。`,
          };
        }
        
        let result = `"${dirParams.relative_workspace_path}" の内容:\n\n`;
        
        for (const entry of entries) {
          result += `- ${entry}\n`;
        }
        
        return { content: result };
      } catch (error) {
        return {
          content: '',
          error: `ディレクトリ一覧取得エラー: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  };
}

/**
 * フォローアップ質問ツール
 * @returns フォローアップ質問ツール定義
 */
export function createAskFollowupQuestionTool(): FunctionTool {
  return {
    name: 'ask_followup_question',
    description: 'タスクを完了するために必要な追加情報を収集するためにユーザーに質問します。あいまいさがある場合や、明確化が必要な場合、または効果的に進めるためにより詳細な情報が必要な場合にこのツールを使用してください。',
    parameters: {
      properties: {
        question: {
          type: 'string',
          description: 'ユーザーに尋ねる質問。必要な情報を明確に特定する、具体的な質問である必要があります。'
        }
      },
      required: ['question']
    },
    execute: async (params: ToolParams): Promise<ToolResult> => {
      try {
        const askParams = params as AskFollowupQuestionParams;
        
        // ここでは質問を返すだけで、実際の応答処理はGeminiHandlerで行う
        return { 
          content: `<followup_question>${askParams.question}</followup_question>` 
        };
      } catch (error) {
        return {
          content: '',
          error: `質問エラー: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  };
}

/**
 * タスク完了ツール
 * @returns タスク完了ツール定義
 */
export function createAttemptCompletionTool(): FunctionTool {
  return {
    name: 'attempt_completion',
    description: 'タスク完了を示します。各ツールの使用後、ユーザーはそのツールの成功または失敗と失敗の理由を応答します。タスクが完了したことを確認できたら、このツールを使用してユーザーに作業結果を提示します。オプションで、作業結果をデモするためのCLIコマンドを提供することもできます。',
    parameters: {
      properties: {
        result: {
          type: 'string',
          description: 'タスクの結果。この結果がユーザーからのさらなる入力を必要としない形式で表現してください。結果の最後に質問や更なる支援の申し出を含めないでください。'
        },
        command: {
          type: 'string',
          description: 'ユーザーに結果のライブデモを表示するためのCLIコマンド（オプション）。例えば、作成したHTMLウェブサイトを表示するには `open index.html` を使用するか、ローカルで実行している開発サーバーを表示するには `open localhost:3000` を使用します。ただし、`echo` や `cat` などの単にテキストを出力するコマンドは使用しないでください。'
        }
      },
      required: ['result']
    },
    execute: async (params: ToolParams): Promise<ToolResult> => {
      try {
        const completionParams = params as AttemptCompletionParams;
        let responseContent = `<completion_result>${completionParams.result}</completion_result>`;
        
        if (completionParams.command) {
          responseContent += `\n<command>${completionParams.command}</command>`;
        }
        
        return { content: responseContent };
      } catch (error) {
        return {
          content: '',
          error: `タスク完了エラー: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  };
}

/**
 * ファイル編集ツールの引数型
 */
export interface EditFileParams extends ToolParams {
  target_file: string;
  instructions: string;
  code_edit: string;
}

/**
 * ファイル編集ツール
 * @param workspaceRoot ワークスペースのルートパス
 * @returns ファイル編集ツール定義
 */
export function createEditFileTool(workspaceRoot: string): FunctionTool {
  return {
    name: 'edit_file',
    description: '既存のファイルに編集を提案します。\n\nこれは、より単純なモデルによって素早く適用される編集です。どのような編集なのかを明確にしながら、変更されないコードは最小限にする必要があります。\n編集を書く際には、編集を順番に指定し、編集された行の間の変更されないコードを「// ... existing code ...」という特別なコメントで表現します。',
    parameters: {
      properties: {
        target_file: {
          type: 'string',
          description: '編集対象のファイルパス。常に最初の引数としてファイルパスを指定してください。ワークスペースのルートからの相対パスまたは絶対パスを使用できます。絶対パスが指定された場合、そのままの形で保持されます。'
        },
        instructions: {
          type: 'string',
          description: '編集の内容を説明する一文。これはより単純なモデルが編集を適用する際に役立ちます。何をしようとしているのかを一人称で説明してください。以前のメッセージで言ったことを繰り返さないでください。これを使って編集の不確実性を明確にします。'
        },
        code_edit: {
          type: 'string',
          description: '編集内容を明確に指定してください。変更したい部分については変更後の内容を記述し、変更されないコードは「// ... existing code ...」のようなコメントで表してください。JSONのフィールド値を変更する場合は、変更後の値を明示してください（例："key": "新しい値"）。行番号付きの形式（例: "3 | 変更後の内容"）を使用する場合は、変更後の内容を記述してください。'
        }
      },
      required: ['target_file', 'instructions', 'code_edit']
    },
    execute: async (params: ToolParams): Promise<ToolResult> => {
      try {
        const editParams = params as EditFileParams;
        
        // 必須パラメータの検証
        if (!editParams.target_file) {
          return {
            content: '',
            error: 'ファイル編集エラー: target_fileパラメータが指定されていません'
          };
        }
        
        if (!editParams.instructions) {
          return {
            content: '',
            error: 'ファイル編集エラー: instructionsパラメータが指定されていません'
          };
        }
        
        if (!editParams.code_edit) {
          return {
            content: '',
            error: 'ファイル編集エラー: code_editパラメータが指定されていません'
          };
        }
        
        const filePath = path.resolve(workspaceRoot, editParams.target_file);
        const instructions = editParams.instructions;
        const codeEdit = editParams.code_edit;
        
        // 既存のファイル内容を取得
        const fs = require('fs').promises;
        let existingContent = '';
        try {
          existingContent = await fs.readFile(filePath, 'utf8');
        } catch (error) {
          // ファイルが存在しない場合は新規作成
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          existingContent = '';
        }
        
        // コード編集を適用
        const updatedContent = applyCodeEdit(existingContent, codeEdit);
        
        // ファイルに書き込み
        await fs.writeFile(filePath, updatedContent, 'utf8');
        
        return { 
          content: `ファイル "${editParams.target_file}" を正常に編集しました。\n\n指示: ${instructions}`
        };
      } catch (error) {
        return {
          content: '',
          error: `ファイル編集エラー: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  };
}

/**
 * コード編集を既存のコードに適用する
 * @param existingContent 既存のファイル内容
 * @param codeEdit 適用する編集内容
 * @returns 更新されたファイル内容
 */
function applyCodeEdit(existingContent: string, codeEdit: string): string {
  // ファイルが空の場合は単純に編集内容を返す（新規作成ケース）
  if (!existingContent.trim()) {
    return codeEdit.replace(/\/\/ \.\.\. existing code \.\.\.\n/g, '');
  }

  // JSONファイルの編集ケースを特別に処理
  if (existingContent.trim().startsWith('{') && existingContent.trim().endsWith('}')) {
    try {
      // JSONの特定の行（例："version": "1.0.0"から"version": "2.0.0"）への変更を検出
      const jsonPattern = /"([^"]+)":\s*"([^"]+)"/g;
      const matches = [...codeEdit.matchAll(jsonPattern)];
      
      if (matches.length > 0) {
        const existingJson = JSON.parse(existingContent);
        let wasUpdated = false;
        
        // 全ての一致を処理
        for (const match of matches) {
          const key = match[1];
          const value = match[2];
          
          // キーが存在する場合、値を更新
          if (existingJson.hasOwnProperty(key)) {
            existingJson[key] = value;
            wasUpdated = true;
          }
        }
        
        if (wasUpdated) {
          return JSON.stringify(existingJson, null, 2);
        }
      }
      
      // 変更指定パターン（"key": "oldValue" → "key": "newValue"）を検出
      const changePattern = /"([^"]+)":\s*"([^"]+)"\s*(?:→|->)\s*"([^"]+)":\s*"([^"]+)"/;
      const changeMatch = codeEdit.match(changePattern);
      
      if (changeMatch) {
        const key = changeMatch[1];
        const newValue = changeMatch[4];
        const existingJson = JSON.parse(existingContent);
        
        // キーが存在する場合、値を更新
        if (existingJson.hasOwnProperty(key)) {
          existingJson[key] = newValue;
          return JSON.stringify(existingJson, null, 2);
        }
      }
    } catch (e) {
      // JSONパースエラーは無視して標準の方法で続行
      console.error('JSON処理エラー:', e);
    }
  }

  // 行番号付きの編集形式をチェック（例: "3 |   \"version\": \"2.0.0\",")
  const lineNumberMatch = codeEdit.match(/^(\d+)\s+\|\s+(.*)$/);
  if (lineNumberMatch) {
    const lineNum = parseInt(lineNumberMatch[1], 10) - 1; // 0ベースのインデックスに変換
    const content = lineNumberMatch[2];
    
    const existingLines = existingContent.split('\n');
    
    // 指定された行を置き換える（変更後の内容で）
    if (lineNum >= 0 && lineNum < existingLines.length) {
      existingLines[lineNum] = content;
      return existingLines.join('\n');
    }
    
    console.error('Invalid line number in edit:', lineNum, 'max:', existingLines.length - 1);
    return existingContent;
  }
  
  // 行番号範囲付きの編集形式をチェック（例: "3-5 | 新しい内容")
  const lineRangeMatch = codeEdit.match(/^(\d+)-(\d+)\s+\|\s+([\s\S]*)$/);
  if (lineRangeMatch) {
    const startLine = parseInt(lineRangeMatch[1], 10) - 1;
    const endLine = parseInt(lineRangeMatch[2], 10) - 1;
    const newContent = lineRangeMatch[3].split('\n');
    
    const existingLines = existingContent.split('\n');
    
    // 行範囲が有効かチェック
    if (startLine >= 0 && endLine < existingLines.length && startLine <= endLine) {
      // 範囲内の行を新しい内容で置き換え
      existingLines.splice(startLine, endLine - startLine + 1, ...newContent);
      return existingLines.join('\n');
    }
    
    console.error('Invalid line range in edit:', startLine, '-', endLine, 'max:', existingLines.length - 1);
    return existingContent;
  }
  
  const existingLines = existingContent.split('\n');
  const editLines = codeEdit.split('\n');
  
  let result: string[] = [];
  let existingIndex = 0;
  
  for (let i = 0; i < editLines.length; i++) {
    const line = editLines[i];
    
    // 行番号付きの編集形式をチェック（例: "3 |   \"version\": \"2.0.0\",")
    const lineMatch = line.match(/^(\d+)\s+\|\s+(.*)$/);
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1], 10) - 1;
      const content = lineMatch[2];
      
      // 指定された行が有効な範囲内であれば置き換える
      if (lineNum >= 0 && lineNum < existingLines.length) {
        // 現在位置からその行までを結果に追加
        if (lineNum > existingIndex) {
          result = result.concat(existingLines.slice(existingIndex, lineNum));
        }
        // 行を置き換えて追加
        result.push(content);
        existingIndex = lineNum + 1;
        continue;
      }
    }
    
    // 既存コードのプレースホルダーを処理
    if (line.trim() === '// ... existing code ...' || line.trim() === '/* ... existing code ... */') {
      // 次の編集行またはファイル終端までスキップ
      const nextEditLine = editLines[i + 1]?.trim();
      if (!nextEditLine) {
        // 残りの既存コードをすべて追加
        result = result.concat(existingLines.slice(existingIndex));
        break;
      }
      
      // 次の編集行に一致する既存コード行を探す
      let found = false;
      for (let j = existingIndex; j < existingLines.length; j++) {
        if (existingLines[j].trim() === nextEditLine) {
          // 既存コード行をそのまま追加
          result = result.concat(existingLines.slice(existingIndex, j));
          existingIndex = j;
          found = true;
          break;
        }
      }
      
      // 一致する行が見つからない場合、編集内容に問題があるため、元のコンテンツをそのまま返す
      if (!found && nextEditLine) {
        console.error('Failed to find matching line for edit:', nextEditLine);
        return existingContent;
      }
    } else {
      // 編集行を追加
      result.push(line);
      
      // 既存コードで同じ行を探して次の行にインデックスを進める
      if (existingLines[existingIndex]?.trim() === line.trim()) {
        existingIndex++;
      }
    }
  }
  
  return result.join('\n');
}

/**
 * ファイル書き込みツールの引数型
 */
export interface WriteToFileParams extends ToolParams {
  path: string;
  content: string;
  line_count: number;
}

/**
 * ファイル書き込みツール
 * @param workspaceRoot ワークスペースのルートパス
 * @returns ファイル書き込みツール定義
 */
export function createWriteToFileTool(workspaceRoot: string): FunctionTool {
  return {
    name: 'write_to_file',
    description: '新しいファイルを作成するか、既存のファイルを完全に上書きします。ファイルが存在しない場合は、必要なディレクトリも作成されます。',
    parameters: {
      properties: {
        path: {
          type: 'string',
          description: '書き込み先のファイルパス（ワークスペースのルートからの相対パス）'
        },
        content: {
          type: 'string',
          description: 'ファイルに書き込む内容'
        },
        line_count: {
          type: 'integer',
          description: '書き込む内容の行数。正確に計算してください。'
        }
      },
      required: ['path', 'content', 'line_count']
    },
    execute: async (params: ToolParams): Promise<ToolResult> => {
      try {
        const writeParams = params as WriteToFileParams;
        const filePath = path.resolve(workspaceRoot, writeParams.path);
        const content = writeParams.content;
        
        // ディレクトリを作成（必要な場合）
        const fs = require('fs').promises;
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        
        // ファイルに書き込み
        await fs.writeFile(filePath, content, 'utf8');
        
        return { 
          content: `ファイル "${writeParams.path}" に内容を正常に書き込みました。`
        };
      } catch (error) {
        return {
          content: '',
          error: `ファイル書き込みエラー: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  };
}

/**
 * ツールセットを作成する
 * @param workspaceRoot ワークスペースのルートパス
 * @returns ツールの配列
 */
export function createTools(workspaceRoot: string): FunctionTool[] {
  return [
    createReadFileTool(workspaceRoot),
    createCodebaseSearchTool(workspaceRoot),
    createListDirTool(workspaceRoot),
    createAskFollowupQuestionTool(),
    createAttemptCompletionTool(),
    createEditFileTool(workspaceRoot),
    createWriteToFileTool(workspaceRoot)
  ];
} 