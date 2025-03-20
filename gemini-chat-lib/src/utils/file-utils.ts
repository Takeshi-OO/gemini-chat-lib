import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * ファイルの内容に行番号を追加する
 * @param content ファイルの内容
 * @param startLine 開始行番号（デフォルト: 1）
 * @returns 行番号が追加されたテキスト
 */
export function addLineNumbers(content: string, startLine: number = 1): string {
  const lines = content.split('\n');
  const maxLineNumberWidth = String(startLine + lines.length - 1).length;
  return lines
    .map((line, index) => {
      const lineNumber = String(startLine + index).padStart(maxLineNumberWidth, ' ');
      return `${lineNumber} | ${line}`;
    })
    .join('\n');
}

/**
 * テキストファイルからテキストを抽出する
 * @param filePath ファイルパス
 * @returns 行番号付きのファイル内容
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(`ファイルが見つかりません: ${filePath}`);
  }
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return addLineNumbers(content);
  } catch (error) {
    throw new Error(`ファイルの読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 出力の長さを制限する
 * @param content テキスト内容
 * @param lineLimit 行数の上限（オプション）
 * @returns 切り詰められたテキスト
 */
export function truncateOutput(content: string, lineLimit?: number): string {
  if (!lineLimit) {
    return content;
  }

  // 合計行数を数える
  let totalLines = 0;
  let pos = -1;
  while ((pos = content.indexOf('\n', pos + 1)) !== -1) {
    totalLines++;
  }
  totalLines++; // 改行のない最後の行を考慮

  if (totalLines <= lineLimit) {
    return content;
  }

  const beforeLimit = Math.floor(lineLimit * 0.2); // 前の20%
  const afterLimit = lineLimit - beforeLimit; // 残りの80%

  // 開始部分の終了位置を見つける
  let startEndPos = -1;
  let lineCount = 0;
  pos = 0;
  while (lineCount < beforeLimit && (pos = content.indexOf('\n', pos)) !== -1) {
    startEndPos = pos;
    lineCount++;
    pos++;
  }

  // 終了部分の開始位置を見つける
  let endStartPos = content.length;
  lineCount = 0;
  pos = content.length;
  while (lineCount < afterLimit && (pos = content.lastIndexOf('\n', pos - 1)) !== -1) {
    endStartPos = pos + 1; // 改行後から開始
    lineCount++;
  }

  const omittedLines = totalLines - lineLimit;
  const startSection = content.slice(0, startEndPos + 1);
  const endSection = content.slice(endStartPos);
  return startSection + `\n[...${omittedLines} 行省略...]\n\n` + endSection;
}

/**
 * ファイルを読み込む関数
 * 
 * @param filePath ファイルパス
 * @param options オプション
 * @returns 行番号付きのファイル内容
 */
export async function readFile(
  filePath: string, 
  options?: { 
    lineLimit?: number,
    offset?: number,
    limit?: number
  }
): Promise<string> {
  try {
    const content = await extractTextFromFile(filePath);
    
    if (options?.offset !== undefined && options?.limit !== undefined) {
      // 開始行と終了行を指定した場合
      const lines = content.split('\n');
      const startLine = Math.max(0, options.offset);
      const endLine = Math.min(lines.length, startLine + options.limit);
      const selectedLines = lines.slice(startLine, endLine);
      return selectedLines.join('\n');
    }
    
    // 行数制限がある場合は出力を切り詰める
    if (options?.lineLimit) {
      return truncateOutput(content, options.lineLimit);
    }
    
    return content;
  } catch (error) {
    throw new Error(`ファイル読み込みエラー: ${error instanceof Error ? error.message : String(error)}`);
  }
} 