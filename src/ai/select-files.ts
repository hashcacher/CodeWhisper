import path from 'path';
import fs from 'fs-extra';
import Handlebars from 'handlebars';
import { getFileList } from '../core/file-processor';
import type { AiAssistedTaskOptions, PullRequestDetails } from '../types';
import { getTemplatePath } from '../utils/template-utils';
import { generateAIResponse } from './generate-ai-response';

/**
 * Gathers a list of all files in the repository and filters them based on AI's selection relevant to the PR.
 * @param prOrIssue - Pull request details
 * @param basePath - Base path of the repository
 * @returns A list of selected files relevant to the PR
 */
export async function selectFilesForPROrIssue(
  prOrIssue: string,
  options: AiAssistedTaskOptions,
  basePath: string,
): Promise<string[]> {
  // Gather all files in the repository
  const allFiles = await getFileList(options);
  console.log('all files', allFiles);

  // Generate AI response to select relevant files
  const aiResponse = await generateAIResponseForFileSelection(
    prOrIssue,
    allFiles,
    options,
  );
  console.log('ai response', aiResponse);

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
  prDetails: string,
  allFiles: string[],
  options: AiAssistedTaskOptions,
): Promise<string> {
  const templatePath = getTemplatePath('files-relevant-to-pr');
  const templateContent = await fs.readFile(templatePath, 'utf-8');
  const template = Handlebars.compile(templateContent, {
    noEscape: true,
  });

  const prompt = template({
    pullRequestDetails: prDetails,
    files: allFiles,
  });

  console.log('file filter prompt', prompt);
  // TODO use a cheaper model for this
  return generateAIResponse(prompt, {
    ...options,
    model: options.model || 'gpt-3.5-turbo', // Ensure a default model is set
  });
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
  const aiSelectedFiles = aiResponse
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => file.length > 0);

  // endsWith so we can match list markup like - file1.js, and 1. file1.js
  return allFiles.filter((file) =>
    aiSelectedFiles.some((selectedFile) => selectedFile.endsWith(file)),
  );
}
