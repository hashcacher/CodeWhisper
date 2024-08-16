import path from 'node:path';
import { confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import { extractIssueNumberFromBranch } from '../utils/branch-utils';
import { processFiles } from '../core/file-processor';
import { generateMarkdown } from '../core/markdown-generator';
import { GitHubAPI } from '../github/github-api';
import type { AiAssistedTaskOptions, PullRequestDetails, LabeledItem, GitHubIssue } from '../types';
import { TaskCache } from '../utils/task-cache';
import { getTemplatePath } from '../utils/template-utils';
import { generateAIResponse } from './generate-ai-response';
import { getModelConfig } from './model-config';
import { parseAICodegenResponse } from './parse-ai-codegen-response';
import { selectFilesForPROrIssue } from './select-files';
import { applyChanges } from './apply-changes';
import {
  applyCodeModifications,
  handleDryRun,
  selectFiles,
} from './task-workflow';
import {checkoutBranch, commitAllChanges} from '../utils/git-tools';
import { generateKittenAsciiArt } from '../utils/ascii-art';
import { generateKittenAsciiArt } from '../utils/ascii-art';

export async function runPullRequestWorkflow(options: AiAssistedTaskOptions) {
  const spinner = ora();
  try {
    const basePath = path.resolve(options.path ?? '.');
    const githubAPI = new GitHubAPI();
    const taskCache = new TaskCache(options.path || process.cwd());

    // Get repository information
    const repoInfo = await taskCache.getRepoInfo();
    if (!repoInfo) {
      throw new Error('Unable to determine repository information');
    }
    const { owner, repo } = repoInfo;

    // Check for existing PR or create a new one
    const branchName = await taskCache.getCurrentBranch();
    let prInfo = await githubAPI.checkForExistingPR(owner, repo, branchName, options.prNumber);

    if (!prInfo) {
      spinner.text = 'Creating new pull request...';
      const title = await input({ message: 'Enter pull request title:' });
      let body = await input({ message: 'Enter pull request description:' });

      // Extract issue number from branch name and link it to the PR
      const issueNumber = extractIssueNumberFromBranch(branchName);
      if (issueNumber) {
        body = `Closes #${issueNumber}\n\n${body}`;
      }

      const kittenArt = generateKittenAsciiArt();
      body = `${kittenArt}\n\n${body}`;

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

    // Fetch PR details
    const prDetails = await githubAPI.getPullRequestDetails(
      owner,
      repo,
      prInfo.number,
    );
    console.log(prDetails);
    if (!needsAction(prDetails)) {
      return;
    }

    // Select relevant files using AI
    const selectedFiles = await selectFilesForPROrIssue(prDetails, options, basePath);

    // Generate AI response based on pull request details
    const aiResponse = await generateAIResponseForPR(
      prDetails,
      options,
      basePath,
      selectedFiles,
    );

    // Parse AI response
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

    // Apply changes to the pull request
    spinner.start('Applying changes to the pull request...');
    await githubAPI.applyChangesToPR(
      owner,
      repo,
      prInfo.number,
      parsedResponse,
    );
    spinner.succeed('Changes applied to the pull request');

    // Add a comment to the pull request
    spinner.start('Adding comment to the pull request...');
    await githubAPI.addCommentToPR(
      owner,
      repo,
      prInfo.number,
      selectedFiles,
      parsedResponse,
    );
    spinner.succeed('Comment added to the pull request');

    console.log(chalk.green('Pull request workflow completed'));
  } catch (error) {
    spinner.fail('Error in pull request workflow');
    console.error(chalk.red('Error:'), error);
  }
}

export async function revisePullRequests(options: AiAssistedTaskOptions) {
  const spinner = ora('Revising pull requests...').start();
  try {
    const githubAPI = new GitHubAPI();
    const taskCache = new TaskCache(options.path || process.cwd());

    // Get repository information
    const repoInfo = await taskCache.getRepoInfo();
    if (!repoInfo) {
      throw new Error('Unable to determine repository information');
    }
    const { owner, repo } = repoInfo;

    // Get CodeWhisper labeled items
    const labeledItems = await githubAPI.getCodeWhisperLabeledItems(owner, repo);

    for (const item of labeledItems) {
      spinner.text = `Processing ${item.pull_request ? 'PR' : 'issue'} #${item.number}`;

      try {
        const lastComment = await githubAPI.getLastComment(owner, repo, item.number);
        if (lastComment.includes('CodeWhisper commit information:')) {
          spinner.text = `Skipping ${item.pull_request ? 'PR' : 'issue'} #${item.number} - last interaction was by the bot`;
          continue;
        }

        if (item.pull_request) {
          await revisePullRequest(owner, repo, item, options, githubAPI);
        } else {
          await createPullRequestFromIssue(owner, repo, item, options, githubAPI);
        }
      } catch (itemError) {
        console.error(`Error processing ${item.pull_request ? 'PR' : 'issue'} #${item.number}:`, itemError);
        // Continue with the next item
      }
    }

    spinner.succeed('Pull request revision completed');
  } catch (error) {
    spinner.fail('Error in pull request revision');
    console.error(chalk.red('Error:'), error);
  }
}

async function revisePullRequest(
  owner: string,
  repo: string,
  pr: LabeledItem,
  options: AiAssistedTaskOptions,
  githubAPI: GitHubAPI
) {
  const basePath = path.resolve(options.path ?? '.');
  const prDetails = await githubAPI.getPullRequestDetails(owner, repo, pr.number);

  // Checkout the PR branch
  try {
    await checkoutBranch(basePath, prDetails.head.ref);
    console.log(chalk.green(`Checked out branch: ${prDetails.head.ref}`));
  } catch (error) {
    console.error(chalk.red(`Failed to checkout branch: ${prDetails.head.ref}`), error);
    throw error;
  }
  options.respectGitignore = true;
  options.autoCommit = true;
  const selectedFiles = await selectFilesForPROrIssue(prDetails, options, basePath);
  const aiResponse = await generateAIResponseForPR(prDetails, options, basePath, selectedFiles);
  const parsedResponse = parseAICodegenResponse(aiResponse, options.logAiInteractions, true);
  await applyChanges({ basePath, parsedResponse, dryRun: false });
  const commitMessage = `CodeWhisper: ${parsedResponse.gitCommitMessage}`
  await commitAllChanges(basePath, commitMessage);
  await githubAPI.createCommitOnPR(owner, repo, pr.number, 'CodeWhisper: Automated PR revision', parsedResponse);
  await githubAPI.addCommentToPR(owner, repo, pr.number, [], parsedResponse);
}

async function createPullRequestFromIssue(
  owner: string,
  repo: string,
  issue: GitHubIssue,
  options: AiAssistedTaskOptions,
  githubAPI: GitHubAPI
) {
  const branchName = `codewhisper/issue-${issue.number}`;
  const prTitle = `CodeWhisper: Implement ${issue.title}`;
  const kittenArt = generateKittenAsciiArt();
  const prBody = `${kittenArt}\n\nfix: #${issue.number}\nAutomated PR for issue #${issue.number}\n\n${issue.body}`;

  try {
    // Get the SHA of the default branch (assuming it's 'main')
    const defaultBranch = await githubAPI.getDefaultBranch(owner, repo);

    // Create a new branch
    await githubAPI.createBranch(owner, repo, branchName, defaultBranch);

    // Generate and apply changes
    const basePath = path.resolve(options.path ?? '.');
    options.respectGitignore = true;
    options.diff = true;
    const selectedFiles = await selectFilesForPROrIssue(JSON.stringify(issue), options, basePath);
    const aiResponse = await generateAIResponseForIssue(issue, selectedFiles, options, basePath);
    const parsedResponse = parseAICodegenResponse(aiResponse, options.logAiInteractions, true);
    await applyChanges({ basePath, parsedResponse, dryRun: false });
    const commitMessage = `CodeWhisper: ${parsedResponse.gitCommitMessage}`
    await commitAllChanges(basePath, commitMessage);

    // Create a commit with the changes
    await githubAPI.createCommitOnBranch(owner, repo, branchName, `CodeWhisper: Implement changes for issue #${issue.number}`, parsedResponse);

    // Create the pull request
    console.log(`Creating pull request for issue #${issue.number}...`)
    const prInfo = await githubAPI.createPullRequest(owner, repo, branchName, prTitle, prBody);
    await githubAPI.addCommentToPR(owner, repo, prInfo.number, selectedFiles, parsedResponse);
  } catch (error) {
    console.error(`Error creating pull request for issue #${issue.number}:`, error);
    throw error;
  }
}

async function generateAIResponseForIssue(
  issue: GitHubIssue,
  selectedFiles: string[],
  options: AiAssistedTaskOptions,
  basePath: string,
): Promise<string> {
  const modelConfig = getModelConfig(options.model);
  const templatePath = getTemplatePath('issue-implementation-prompt');
  const templateContent = await fs.readFile(templatePath, 'utf-8');

  const customData = {
    var_issue: JSON.stringify(issue),
  };

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

async function needsAction(prDetails: PullRequestDetails) {
  const lastComment = prDetails.comments[prDetails.comments.length - 1];
  return lastComment.body.includes('AI-generated changes have been applied');
}

async function generateAIResponseForPR(
  prDetails: PullRequestDetails,
  options: AiAssistedTaskOptions,
  basePath: string,
  selectedFiles: string[],
): Promise<string> {
  const modelConfig = getModelConfig(options.model);
  const templatePath = getTemplatePath('pr-diff-prompt');
  const templateContent = await fs.readFile(templatePath, 'utf-8');

  const customData = {
    var_pullRequest: JSON.stringify(prDetails),
  };
  const processedFiles = await processFiles(options, selectedFiles);

  const prReviewPrompt = await generateMarkdown(
    processedFiles,
    templateContent,
    {
      customData,
      noCodeblock: options.noCodeblock,
      lineNumbers: options.lineNumbers,
    },
  );

  console.log(chalk.cyan('\nPR Review Prompt:'));
  console.log(prReviewPrompt);
  return generateAIResponse(
    prReviewPrompt,
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
