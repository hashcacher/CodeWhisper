import path from 'node:path';
import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { extractIssueNumberFromBranch } from '../utils/branch-utils';
import { processFiles } from '../core/file-processor';
import { generateMarkdown } from '../core/markdown-generator';
import { GitHubAPI } from '../github/github-api';
import type {
  AiAssistedTaskOptions,
  Issue,
  AIParsedResponse,
  PRWorkflowContext,
} from '../types';
import { TaskCache } from '../utils/task-cache';
import { getTemplatePath } from '../utils/template-utils';
import { generateAIResponse } from './generate-ai-response';
import { getModelConfig } from './model-config';
import { parseAICodegenResponse } from './parse-ai-codegen-response';
import { selectFilesForIssue } from './select-files';
import { applyChanges } from './apply-changes';
import {
  applyCodeModifications,
  handleDryRun,
} from './task-workflow';
import {
  revertLastCommit,
} from '../utils/git-tools';

export async function runPullRequestWorkflow(options: AiAssistedTaskOptions) {
  const spinner = ora();
  try {
    const context = await initializeContext(options);
    const branchName = await context.taskCache.getCurrentBranch();
    const prInfo = await getOrCreatePullRequest(context, branchName, spinner);

    if (!prInfo) {
      spinner.info('No action needed for this pull request.');
      return;
    }

    await processIssue(
      context,
      { ...prInfo, pull_request: { url: prInfo.html_url } },
      spinner,
    );

    if (await needsRevert(prInfo, options)) {
      await handleRevert(context, prInfo);
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
      issueNumber,
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

async function processIssue(
  context: PRWorkflowContext,
  issue: Issue,
  spinner: ora.Ora,
) {
  const {owner, repo, basePath, githubAPI, taskCache, options} = context;

  let details: Issue;
  if (issue.pull_request) {
    details = await githubAPI.getPullRequestDetails(owner, repo, issue.number);
  } else {
    details = await githubAPI.getIssueDetails(owner, repo, issue.number);
  }

  if (!(await needsAction(details))) {
    return;
  }

  const selectedFiles = await selectFilesForIssue(
    JSON.stringify(details),
    {...options, respectGitignore: true, diff: true},
    basePath,
  );

  const aiResponse = await generateAIResponseForIssue(
    details,
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
  const branchName = await applyCodeModifications({...options, autoCommit: true}, basePath, parsedResponse, !!issue.pull_request);
  await githubAPI.pushChanges(owner, repo, branchName);

  if (issue.pull_request) {
    await githubAPI.addCommentToIssue(
      owner,
      repo,
      issue.number,
      selectedFiles,
      parsedResponse,
      issue.pull_request !== undefined,
    );
  } else {
    await githubAPI.createPullRequest(
      owner,
      repo,
      issue.number,
      branchName,
      issue.title,
      issue.body,
      parsedResponse,
    );
  }
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
        await processIssue(context, issue, spinner);
      }

      spinner.succeed(
        'Iteration completed. Waiting a minute before next iteration...',
      );
    } catch (error) {
      spinner.fail('Error in pull request revision iteration');
      console.error(chalk.red('Error:'), error);
    }

    await new Promise((resolve) => setTimeout(resolve, 60000));
    spinner.start('Starting next iteration...');
    await revisionLoop();
  }

  await revisionLoop();
}

async function handleRevert(
  context: PRWorkflowContext,
  pr: Issue,
) {
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
  let templatePath;
  const customData: Record<string, string> = {};
  if (issue.pull_request) {
    customData.var_pullRequest = JSON.stringify(issue);
    templatePath = getTemplatePath('pr-diff-prompt');
  } else {
    customData.var_issue = JSON.stringify(issue);
    templatePath = getTemplatePath('issue-implementation-prompt');
  }

  const templateContent = await getTemplatePath(templatePath);

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
