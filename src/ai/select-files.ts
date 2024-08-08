import fs from 'fs-extra';
import path from 'path';
import { generateAIResponse } from './generate-ai-response';
import type { PullRequestDetails } from '../types';
import {getFileList} from '../core/file-processor';

/**
 * Gathers a list of all files in the repository and filters them based on AI's selection relevant to the PR.
 * @param prDetails - Pull request details
 * @param basePath - Base path of the repository
 * @returns A list of selected files relevant to the PR
 */
export async function selectFilesForPR(
  prDetails: PullRequestDetails,
  options,
  basePath: string,
): Promise<string[]> {
  // Gather all files in the repository
  const allFiles = await getFileList(options);
  console.log('all files', allFiles)

  // Generate AI response to select relevant files
  const aiResponse = await generateAIResponseForFileSelection(prDetails, allFiles, options);
  console.log('ai response', aiResponse)

  // Filter the list of files to only those selected by the AI
  const selectedFiles = filterFilesBasedOnAIResponse(allFiles, aiResponse);

  return selectedFiles;
}

/**
 * Recursively gathers all files in the given directory.
 * @param dir - Directory to gather files from
 * @returns A list of all files in the directory
 */
async function gatherAllFiles(dir: string): Promise<string[]> {
  let results: string[] = [];
  const list = await fs.readdir(dir);
  for (const file of list) {
    const filePath = path.resolve(dir, file);
    const stat = await fs.stat(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(await gatherAllFiles(filePath));
    } else {
      results.push(filePath);
    }
  }
  return results;
}

/**
 * Generates an AI response to select relevant files based on the pull request details and the list of all files.
 * @param prDetails - Pull request details
 * @param allFiles - List of all files in the repository
 * @returns AI response containing the selected files
 */
async function generateAIResponseForFileSelection(
  prDetails: PullRequestDetails,
  allFiles: string[],
  options,
): Promise<string> {
  const prompt = `Given the following pull request details and list of files, select the files relevant to the pull request:\n\nPull Request Details:\n${JSON.stringify(
    prDetails,
  )}\n\nFiles:\n${allFiles.join('\n')}\n\nSelected Files:`;
  console.log('file filter prompt', prompt)
  return generateAIResponse(prompt, options);
}

/**
 * Filters the list of files based on the AI response.
 * @param allFiles - List of all files in the repository
 * @param aiResponse - AI response containing the selected files
 * @returns A list of selected files
 */
function filterFilesBasedOnAIResponse(
  allFiles: string[],
  aiResponse: string,
): string[] {
  const selectedFiles = aiResponse
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => allFiles.includes(file));
  return selectedFiles;
}
