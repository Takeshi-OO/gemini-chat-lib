import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * コンテキスト情報を収集するヘルパークラス
 */
export class ContextHelper {
  /**
   * ワークスペースの基本情報を収集する
   * @param workspacePath ワークスペースパス
   * @returns ワークスペース情報
   */
  public static async getWorkspaceInfo(workspacePath: string): Promise<string> {
    let details = '';
    
    // OSの情報
    details += `# システム情報\n`;
    details += `OS: ${os.platform()} ${os.release()}\n`;
    details += `アーキテクチャ: ${os.arch()}\n`;
    
    // 現在の時刻情報
    const now = new Date();
    const formatter = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true,
    });
    const timeZone = formatter.resolvedOptions().timeZone;
    const timeZoneOffset = -now.getTimezoneOffset() / 60;
    const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? '+' : ''}${timeZoneOffset}:00`;
    details += `\n# 現在時刻\n${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})\n`;
    
    return details;
  }
  
  /**
   * ディレクトリ内のファイル一覧を取得する
   * @param dirPath 対象ディレクトリパス
   * @param options オプション
   * @returns ファイル一覧情報
   */
  public static async listFiles(
    dirPath: string, 
    options?: { 
      maxFiles?: number, 
      ignoreDirs?: string[], 
      ignorePatterns?: RegExp[] 
    }
  ): Promise<string[]> {
    const maxFiles = options?.maxFiles ?? 200;
    const ignorePatterns = options?.ignorePatterns ?? [/node_modules/, /\.git/];
    const ignoreDirs = options?.ignoreDirs ?? ['.git', 'node_modules', 'dist', 'build'];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files: string[] = [];
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(dirPath, fullPath);
        
        // 無視するディレクトリをスキップ
        if (entry.isDirectory()) {
          if (ignoreDirs.includes(entry.name)) {
            continue;
          }
          
          if (ignorePatterns.some(pattern => pattern.test(relativePath))) {
            continue;
          }
          
          // 再帰的にサブディレクトリを探索
          if (files.length < maxFiles) {
            const subFiles = await this.listFiles(fullPath, {
              maxFiles: maxFiles - files.length,
              ignoreDirs,
              ignorePatterns
            });
            files.push(...subFiles.map(f => path.join(relativePath, f)));
          }
        } else if (entry.isFile()) {
          if (ignorePatterns.some(pattern => pattern.test(relativePath))) {
            continue;
          }
          
          files.push(relativePath);
          
          if (files.length >= maxFiles) {
            break;
          }
        }
      }
      
      return files;
    } catch (error) {
      console.error(`ディレクトリ一覧取得エラー: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * ユーザーの質問やコードから関連するファイルを推測する
   * @param userQuery ユーザーの質問
   * @param workspacePath ワークスペースパス
   * @param fileList ファイル一覧
   * @returns 関連性が高いと推測されるファイルパスの配列
   */
  public static inferRelevantFiles(
    userQuery: string, 
    workspacePath: string, 
    fileList: string[]
  ): string[] {
    // 簡易的なスコアリング
    const fileScores = fileList.map(file => {
      let score = 0;
      const fileExtension = path.extname(file).toLowerCase();
      const fileName = path.basename(file).toLowerCase();
      const filePath = file.toLowerCase();
      const query = userQuery.toLowerCase();
      
      // ファイル名やパスがクエリに含まれていればスコアアップ
      if (query.includes(fileName) || query.includes(filePath)) {
        score += 10;
      }
      
      // クエリにファイル拡張子が含まれていればスコアアップ
      if (fileExtension && query.includes(fileExtension.substring(1))) {
        score += 5;
      }
      
      // クエリに特定の言語やフレームワークが含まれていれば関連ファイルのスコアアップ
      const langFrameworks = [
        { keywords: ['javascript', 'js', 'nodejs'], extensions: ['.js', '.jsx', '.ts', '.tsx'] },
        { keywords: ['typescript', 'ts'], extensions: ['.ts', '.tsx'] },
        { keywords: ['react'], extensions: ['.jsx', '.tsx', '.js'] },
        { keywords: ['vue'], extensions: ['.vue'] },
        { keywords: ['python'], extensions: ['.py'] },
        { keywords: ['java'], extensions: ['.java'] },
        { keywords: ['c#', 'csharp'], extensions: ['.cs'] },
        { keywords: ['html'], extensions: ['.html', '.htm'] },
        { keywords: ['css'], extensions: ['.css', '.scss', '.sass'] },
      ];
      
      for (const { keywords, extensions } of langFrameworks) {
        if (keywords.some(keyword => query.includes(keyword)) && 
            extensions.some(ext => fileExtension === ext)) {
          score += 3;
        }
      }
      
      // 一般的に重要なファイルへのボーナス
      const importantFiles = [
        'package.json', 'tsconfig.json', 'webpack.config.js', 'vite.config.js',
        '.eslintrc', '.prettierrc', 'readme.md', 'index.js', 'app.js', 'main.js'
      ];
      
      if (importantFiles.includes(fileName)) {
        score += 2;
      }
      
      return { file, score };
    });
    
    // スコアでソートして上位のファイルを返す
    return fileScores
      .sort((a, b) => b.score - a.score)
      .filter(item => item.score > 0)
      .slice(0, 5)
      .map(item => item.file);
  }
  
  /**
   * ユーザーの質問に応じた最適なコンテキストを生成する
   * @param userQuery ユーザーの質問
   * @param workspacePath ワークスペースパス
   * @param options オプション
   * @returns 最適化されたコンテキスト情報
   */
  public static async getOptimizedContext(
    userQuery: string,
    workspacePath: string,
    options?: {
      maxFiles?: number,
      maxTokens?: number,
      includeFileContents?: boolean
    }
  ): Promise<string> {
    const maxFiles = options?.maxFiles ?? 5;
    const includeFileContents = options?.includeFileContents ?? false;
    
    let context = await this.getWorkspaceInfo(workspacePath);
    
    // ファイル一覧を取得
    const fileList = await this.listFiles(workspacePath);
    
    // 関連性が高いファイルを推測
    const relevantFiles = this.inferRelevantFiles(userQuery, workspacePath, fileList);
    
    if (relevantFiles.length > 0) {
      context += '\n# 関連ファイル\n';
      context += relevantFiles.slice(0, maxFiles).join('\n');
      
      // ファイル内容も含める場合
      if (includeFileContents) {
        for (const file of relevantFiles.slice(0, maxFiles)) {
          try {
            const filePath = path.join(workspacePath, file);
            const content = await fs.readFile(filePath, 'utf8');
            
            // 内容が大きすぎる場合は要約
            const contentLines = content.split('\n');
            const summarizedContent = contentLines.length > 50 
              ? [...contentLines.slice(0, 20), '...', ...contentLines.slice(-20)].join('\n')
              : content;
            
            context += `\n\n# ファイル内容: ${file}\n\`\`\`\n${summarizedContent}\n\`\`\``;
          } catch (error) {
            // ファイル読み込みエラーは無視
          }
        }
      }
    }
    
    return context;
  }
} 