import path from 'node:path';
import { confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import { processFiles } from '../core/file-processor';
import { generateMarkdown } from '../core/markdown-generator';
import { GitHubAPI } from '../github/github-api';
import type {
  AIParsedResponse,
  AiAssistedTaskOptions,
  Issue,
  PRWorkflowContext,
} from '../types';
import { RevisionAttempt } from '../types';
import { extractIssueNumberFromBranch } from '../utils/branch-utils';
import {
  checkoutBranch,
  commitAllChanges,
  revertLastCommit,
} from '../utils/git-tools';
import { TaskCache } from '../utils/task-cache';
import { getTemplatePath } from '../utils/template-utils';
import { applyChanges } from './apply-changes';
import { generateAIResponse } from './generate-ai-response';
import { getModelConfig } from './model-config';
import { parseAICodegenResponse } from './parse-ai-codegen-response';
import { selectFilesForIssue } from './select-files';
import {
  applyCodeModifications,
  handleDryRun,
  selectFiles,
} from './task-workflow';

export async function runPullRequestWorkflow(options: AiAssistedTaskOptions) {
  const spinner = ora();
  try {
    const context = await initializeContext(options);
    const branchName = await context.taskCache.getCurrentBranch();
    const pr = await getOrCreatePullRequest(context, branchName, spinner);

    if (!pr) {
      spinner.info('No action needed for this pull request.');
      return;
    }

    await processIssue(context, pr.number, !!pr.html_url, spinner);

    if (await needsRevert(pr, options)) {
      await handleRevert(context, pr);
    }

    console.log(chalk.green('Pull request workflow completed'));
  } catch (error) {
    spinner.fail('Error in pull request workflow');
    console.error(chalk.red('Error:'), error);
  }
}

async function initializeContext(
  options: AiAssistedTaskOptions,
): Promise<PRWorkflowContext> {
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
  context: PRWorkflowContext,
  branchName: string,
  spinner: ora.Ora,
) {
  const { owner, repo, githubAPI, taskCache, options } = context;

  const pr = await githubAPI.checkForExistingPR(
    owner,
    repo,
    branchName,
    options.prNumber,
  );

  if (!pr) {
    spinner.text = 'Creating new pull request...';
    const title = await input({ message: 'Enter pull request title:' });
    let body = await input({ message: 'Enter pull request description:' });

    const issueNumber = extractIssueNumberFromBranch(branchName);
    if (issueNumber) {
      body = `Closes #${issueNumber}\n\n${body}`;
    }

    await processIssue(context, issueNumber, !!pr.pull_request, spinner);
    // await taskCache.setPRInfo(pr);
    spinner.succeed(`Created new pull request: ${pr.html_url}`);
  } else {
    spinner.succeed(`Using pull request: ${pr.html_url}`);
  }

  return pr;
}

async function processIssue(
  context: PRWorkflowContext,
  number: number,
  pullRequest: boolean,
  spinner: ora.Ora,
) {
  const { owner, repo, basePath, githubAPI, taskCache, options } = context;

  let issue: Issue;
  if (pullRequest) {
    issue = await githubAPI.getPullRequestDetails(owner, repo, number);
  } else {
    issue = await githubAPI.getIssueDetails(owner, repo, number);
  }

  if (!(await needsAction(issue))) {
    return;
  }

  const attemptKey = `${owner}/${repo}/${number}`;
  const attempts = await taskCache.getRevisionAttempts(attemptKey);

  const maxRetries = 5;
  if (
    attempts.length >= maxRetries &&
    Date.now() - attempts[attempts.length - maxRetries].timestamp < 3600000
  ) {
    spinner.info(
      `Skipping issue/PR #${number}: Rate limit exceeded (3 attempts per hour)`,
    );
    return;
  }

  await taskCache.addRevisionAttempt(attemptKey, { timestamp: Date.now() });

  // Check out and pull the branch to ensure we have the latest changes
  if (pullRequest) {
    console.log('Checking out pull request branch:', issue.head.ref);
    await checkoutBranch(basePath, issue.head.ref);
  }

  const selectedFiles = await selectFilesForIssue(
    JSON.stringify(issue),
    { ...options, respectGitignore: true, diff: true },
    basePath,
  );

  const aiResponse = await generateAIResponseForIssue(
    issue,
    selectedFiles,
    options,
    basePath,
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

    return;
  }
  const branchName = await applyCodeModifications(
    { ...options, autoCommit: true },
    basePath,
    parsedResponse,
    pullRequest ? issue.head.ref : undefined,
  );
  await githubAPI.pushChanges(owner, repo, branchName);

  if (!pullRequest) {
    issue.number = await githubAPI.createPullRequest(
      owner,
      repo,
      number,
      branchName,
      issue.title,
      issue.body,
      parsedResponse,
    ).number;
  }
  await githubAPI.addCommentToIssue(
    owner,
    repo,
    issue.number,
    selectedFiles,
    parsedResponse,
    pullRequest,
  );
}

export async function revisePullRequests(options: AiAssistedTaskOptions) {
  const spinner = ora({
    text: 'Starting continuous PR revision process...',
    discardStdin: false,
  }).start();
  const context = await initializeContext(options);

  async function revisionLoop() {
    try {
      spinner.text = 'Fetching CodeWhisper labeled issues...';
      const labeledIssues = await context.githubAPI.getCodeWhisperLabeledItems(
        context.owner,
        context.repo,
      );

      for (const issue of labeledIssues) {
        await processIssue(
          context,
          issue.number,
          !!issue.pull_request,
          spinner,
        );
      }

      spinner.succeed(
        'Iteration completed. Waiting a minute before next iteration...',
      );
    } catch (error) {
      spinner.fail('Error in pull request revision iteration');
      console.error(chalk.red('Error:'), error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
    spinner.start('Starting next iteration...');
    await revisionLoop();
  }

  await revisionLoop();
}

async function handleRevert(context: PRWorkflowContext, pr: Issue) {
  const { owner, repo, basePath, githubAPI } = context;
  console.log(chalk.yellow('Reverting last commit as requested...'));
  try {
    await revertLastCommit(basePath);
    await githubAPI.pushChanges(owner, repo, pr.head.ref);
    await githubAPI.addCustomCommentToPR(
      owner,
      repo,
      pr.number,
      'Successfully reverted the last commit as requested. Please review the changes and let me know if you need any further modifications.',
    );
    console.log(chalk.green('Successfully reverted last commit.'));
  } catch (error) {
    console.error(chalk.red('Failed to revert last commit:'), error);
    await githubAPI.addCustomCommentToPR(
      owner,
      repo,
      pr.number,
      'An error occurred while attempting to revert the last commit. Please check the repository state and try again.',
    );
    throw error;
  }
}

async function needsAction(pr: Issue) {
  if (!pr.comments || pr.comments.length === 0) {
    return true;
  }

  const lastComment = pr.comments[pr.comments?.length - 1];
  return !lastComment.body.startsWith('AI-generated');
}

async function generateAIResponseForIssue(
  issue: Issue,
  selectedFiles: string[],
  options: AiAssistedTaskOptions,
  basePath: string,
): Promise<string> {
  const modelConfig = getModelConfig(options.model);
  let templatePath = {};
  const customData = {};
  if (issue.pull_request) {
    customData.var_pullRequest = JSON.stringify(issue);
    templatePath = getTemplatePath('pr-diff-prompt');
  } else {
    customData.var_issue = JSON.stringify(issue);
    templatePath = getTemplatePath('issue-implementation-prompt');
  }

  const templateContent = await fs.readFile(templatePath, 'utf-8');

  const processedFiles = await processFiles(options, selectedFiles);

  const issueImplementationPrompt = await generateMarkdown(
    processedFiles,
    templateContent,
    {
      customData,
      noCodeblock: options.noCodeblock,
      lineNumbers: options.lineNumbers,
    },
  );

  console.log(chalk.cyan('Generating AI response for issue implementation:'));
  return generateAIResponse(
    issueImplementationPrompt,
    {
      maxCostThreshold: options.maxCostThreshold,
      model: options.model,
      contextWindow: options.contextWindow,
      maxTokens: options.maxTokens,
      logAiInteractions: options.logAiInteractions,
    },
    modelConfig.temperature?.planningTemperature,
  );
}

async function needsRevert(
  pr: Issue,
  options: AiAssistedTaskOptions,
): Promise<boolean> {
  if (!pr.comments || pr.comments.length === 0) {
    return false;
  }
  const lastComment = pr.comments[pr.comments.length - 1];
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
  };
  const aiResponse = await generateAIResponse(aiPrompt, generateOptions, 0.3);

  return aiResponse.trim().toLowerCase() === 'true';
}
