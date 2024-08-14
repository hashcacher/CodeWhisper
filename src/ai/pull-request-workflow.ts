import path from 'node:path';
import { confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import { extractIssueNumberFromBranch } from '../utils/branch-utils';
import { processFiles } from '../core/file-processor';
import { generateMarkdown } from '../core/markdown-generator';
import { GitHubAPI } from '../github/github-api';
import type {
  AiAssistedTaskOptions,
  PullRequestDetails,
  LabeledItem,
  GitHubIssue,
  AIParsedResponse,
  SharedContext,
} from '../types';
import { TaskCache } from '../utils/task-cache';
import { getTemplatePath } from '../utils/template-utils';
import { generateAIResponse } from './generate-ai-response';
import { getModelConfig } from './model-config';
import { parseAICodegenResponse } from './parse-ai-codegen-response';
import { selectFilesForIssue as selectFilesForIssue } from './select-files';
import { applyChanges } from './apply-changes';
import {
  applyCodeModifications,
  handleDryRun,
  selectFiles,
} from './task-workflow';
import { checkoutBranch, commitAllChanges, revertLastCommit } from '../utils/git-tools';

export async function runPullRequestWorkflow(options: AiAssistedTaskOptions) {
  const spinner = ora();
  try {
    const context = await initializeSharedContext(options);
    const branchName = await context.taskCache.getCurrentBranch();
    const prInfo = await getOrCreatePullRequest(context, branchName, spinner);

    if (!prInfo) {
      spinner.info('No action needed for this pull request.');
      return;
    }

    await processItem(context, { ...prInfo, pull_request: { url: prInfo.html_url } }, spinner);

    console.log(chalk.green('Pull request workflow completed'));
  } catch (error) {
    spinner.fail('Error in pull request workflow');
    console.error(chalk.red('Error:'), error);
  }
}

async function initializeSharedContext(options: AiAssistedTaskOptions): Promise<SharedContext> {
  const basePath = path.resolve(options.path ?? '.');
  const githubAPI = new GitHubAPI();
  const taskCache = new TaskCache(options.path || process.cwd());

  const repoInfo = await taskCache.getRepoInfo();
  if (!repoInfo) {
    throw new Error('Unable to determine repository information');
  }

  return {
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    basePath,
    githubAPI,
    taskCache,
    options,
  };
}

async function getOrCreatePullRequest(
  context: SharedContext,
  branchName: string,
  spinner: ora.Ora
) {
  const { owner, repo, githubAPI, taskCache, options } = context;

  let prInfo = await githubAPI.checkForExistingPR(
    owner,
    repo,
    branchName,
    options.prNumber,
  );

  if (!prInfo) {
    spinner.text = 'Creating new pull request...';
    const title = await input({ message: 'Enter pull request title:' });
    let body = await input({ message: 'Enter pull request description:' });

    const issueNumber = extractIssueNumberFromBranch(branchName);
    if (issueNumber) {
      body = `Closes #${issueNumber}\n\n${body}`;
    }

    spinner.start('Creating new pull request...');
    prInfo = await githubAPI.createPullRequest(
      owner,
      repo,
      branchName,
      title,
      body,
    );
    await taskCache.setPRInfo(prInfo);
    spinner.succeed(`Created new pull request: ${prInfo.html_url}`);
  } else {
    spinner.succeed(`Using pull request: ${prInfo.html_url}`);
  }

  return prInfo;
}

async function processItem(
  context: SharedContext,
  issue: LabeledItem,
  spinner: ora.Ora
) {
  const { owner, repo, basePath, githubAPI, taskCache, options } = context;

  let details: PullRequestDetails | GitHubIssue;
  if (issue.pull_request) {
    details = await githubAPI.getPullRequestDetails(owner, repo, issue.number);
  } else {
    details = await githubAPI.getIssueDetails(owner, repo, issue.number);
  }

  if (!await needsAction(details)) {
    return;
  }

  const selectedFiles = await selectFilesForIssue(
    JSON.stringify(details),
    { ...options, respectGitignore: true, diff: true },
    basePath,
  );

  const aiResponse = await generateAIResponse(
    JSON.stringify(details),
    options,
    basePath,
    selectedFiles,
  );

  const parsedResponse = parseAICodegenResponse(
    aiResponse,
    options.logAiInteractions,
    true,
  );

  if (options.dryRun) {
    await handleDryRun(
      basePath,
      parsedResponse,
      taskCache.getLastTaskData(basePath)?.taskDescription || '',
    );
  } else {
    options.autoCommit = true;
    await applyCodeModifications(options, basePath, parsedResponse);
  }

  await applyChangesToItem(context, issue, parsedResponse, selectedFiles, spinner);
}

async function applyChangesToItem(
  context: SharedContext,
  item: LabeledItem,
  parsedResponse: AIParsedResponse,
  selectedFiles: string[],
  spinner: ora.Ora
) {
  const { owner, repo, githubAPI } = context;

  spinner.start(`Applying changes to the ${item.pull_request ? 'pull request' : 'issue'}...`);
  await githubAPI.applyChangesToItem(
    owner,
    repo,
    item.number,
    parsedResponse,
    item.pull_request !== undefined
  );
  spinner.succeed(`Changes applied to the ${item.pull_request ? 'pull request' : 'issue'}`);

  spinner.start(`Adding comment to the ${item.pull_request ? 'pull request' : 'issue'}...`);
  await githubAPI.addCommentToItem(
    owner,
    repo,
    item.number,
    selectedFiles,
    parsedResponse,
    item.pull_request !== undefined
  );
  spinner.succeed(`Comment added to the ${item.pull_request ? 'pull request' : 'issue'}`);
}

export async function revisePullRequests(options: AiAssistedTaskOptions) {
  const spinner = ora({text: 'Starting continuous PR revision process...', discardStdin: false}).start();
  const context = await initializeSharedContext(options);

  async function revisionLoop() {
    try {
      spinner.text = 'Fetching CodeWhisper labeled items...';
      const labeledItems = await context.githubAPI.getCodeWhisperLabeledItems(context.owner, context.repo);

      for (const item of labeledItems) {
        await processItem(context, item, spinner);
      }

      spinner.succeed('Iteration completed. Waiting a minute before next iteration...');
    } catch (error) {
      spinner.fail('Error in pull request revision iteration');
      console.error(chalk.red('Error:'), error);
    }

    await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
    spinner.start('Starting next iteration...');
    await revisionLoop();
  }

  await revisionLoop();
}

async function handleRevert(context: SharedContext, pr: LabeledItem, prDetails: PullRequestDetails) {
  const { owner, repo, basePath, githubAPI } = context;
  console.log(chalk.yellow('Reverting last commit as requested...'));
  try {
    await revertLastCommit(basePath);
    await githubAPI.pushChanges(owner, repo, prDetails.head.ref);
    await githubAPI.addCustomCommentToPR(
      owner,
      repo,
      pr.number,
      'Successfully reverted the last commit as requested. Please review the changes and let me know if you need any further modifications.'
    );
    console.log(chalk.green('Successfully reverted last commit.'));
  } catch (error) {
    console.error(chalk.red('Failed to revert last commit:'), error);
    await githubAPI.addCustomCommentToPR(
      owner,
      repo,
      pr.number,
      'An error occurred while attempting to revert the last commit. Please check the repository state and try again.'
    );
    throw error;
  }
}

async function needsAction(prDetails: PullRequestDetails) {
  if (!prDetails.comments || prDetails.comments.length === 0) {
    return true;
  }

  const lastComment = prDetails.comments[prDetails.comments?.length - 1];
  return !lastComment.body.startsWith('AI-generated changes have been applied');
}

async function needsRevert(prDetails: PullRequestDetails, options: AiAssistedTaskOptions): Promise<boolean> {
  const lastComment = prDetails.comments[prDetails.comments.length - 1];
  const aiPrompt = `
    Analyze the following comment and determine if the user is requesting to revert the last commit:
    "${lastComment.body}"
    Respond with 'true' if the user wants to revert, or 'false' otherwise.
  `;

   const generateOptions = {
      maxCostThreshold: options.maxCostThreshold,
      model: options.model,
      maxTokens: 10,
      logAiInteractions: options.logAiInteractions,
    }
  const aiResponse = await generateAIResponse(aiPrompt, generateOptions, 0.3,);
    
  return aiResponse.trim().toLowerCase() === 'true';
}
