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
 * ファイル読み込みツールの引数型
 */
export interface ReadFileParams extends ToolParams {
  path: string;
  offset?: number;
  limit?: number;
  should_read_entire_file?: boolean;
}

/**
 * function callingツールの基底インターフェース
 */
export interface FunctionTool {
  name: string;
  description: string;
  execute: (params: ToolParams) => Promise<ToolResult>;
  parameters: {
    properties: {
      [key: string]: {
        type: string;
        description: string;
      }
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
          description: '検索対象のディレクトリを指定するグロブパターン'
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
 * ツールセットを作成する
 * @param workspaceRoot ワークスペースのルートパス
 * @returns ツールの配列
 */
export function createTools(workspaceRoot: string): FunctionTool[] {
  return [
    createReadFileTool(workspaceRoot),
    createCodebaseSearchTool(workspaceRoot),
    createListDirTool(workspaceRoot)
  ];
} 