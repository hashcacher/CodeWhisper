import { confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import { processFiles } from '../core/file-processor';
import { generateMarkdown } from '../core/markdown-generator';
import { GitHubAPI } from '../github/github-api';
import type { AiAssistedTaskOptions, PullRequestDetails } from '../types';
import { TaskCache } from '../utils/task-cache';
import { getTemplatePath } from '../utils/template-utils';
import { generateAIResponse } from './generate-ai-response';
import { getModelConfig } from './model-config';
import { parseAICodegenResponse } from './parse-ai-codegen-response';

export async function runPullRequestWorkflow(options: AiAssistedTaskOptions) {
  const spinner = ora();
  try {
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
    let prInfo = await githubAPI.checkForExistingPR(owner, repo, branchName);

    if (!prInfo) {
      spinner.text = 'Creating new pull request...';
      const title = await input({ message: 'Enter pull request title:' });
      const body = await input({ message: 'Enter pull request description:' });
      spinner.start('Checking for existing pull request...');
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
      spinner.succeed(`Found existing pull request: ${prInfo.html_url}`);
    }

    let iteration = 1;
    let continueIterating = true;

    while (continueIterating) {
      spinner.start(`Processing pull request iteration ${iteration}...`);

      // Fetch PR details
      const prDetails = await githubAPI.getPullRequestDetails(
        owner,
        repo,
        prInfo.number,
      );

      // Generate AI response based on pull request details
      const aiResponse = await generateAIResponseForPR(prDetails, options);

      // Parse AI response
      const parsedResponse = parseAICodegenResponse(
        aiResponse,
        options.logAiInteractions,
        options.diff,
      );

      spinner.succeed(`Iteration ${iteration} processed`);

      // Display AI suggestions
      console.log(chalk.cyan('\nAI Suggestions:'));
      console.log(parsedResponse.summary);

      // Prompt user for action
      const action = await input({
        message: 'Choose an action (apply/comment/skip/exit):',
        default: 'comment',
      });

      switch (action) {
        case 'apply':
          // Apply changes to the pull request
          await githubAPI.applyChangesToPR(
            owner,
            repo,
            prInfo.number,
            parsedResponse,
          );
          console.log(chalk.green('Changes applied to the pull request'));
          break;
        case 'comment':
          // Add a comment to the pull request
          await githubAPI.addCommentToPR(
            owner,
            repo,
            prInfo.number,
            parsedResponse.summary,
          );
          console.log(chalk.green('Comment added to the pull request'));
          break;
        case 'skip':
          console.log(chalk.yellow('Skipping this iteration'));
          break;
        case 'exit':
          continueIterating = false;
          break;
        default:
          console.log(chalk.red('Invalid action. Skipping this iteration'));
      }

      if (continueIterating) {
        continueIterating = await confirm({
          message: 'Do you want to continue iterating on this pull request?',
          default: true,
        });
      }

      iteration++;
    }

    console.log(chalk.green('Pull request workflow completed'));
  } catch (error) {
    spinner.fail('Error in pull request workflow');
    console.error(chalk.red('Error:'), error);
  }
}

async function generateAIResponseForPR(
  prDetails: PullRequestDetails,
  options: AiAssistedTaskOptions,
): Promise<string> {
  const modelConfig = getModelConfig(options.model);
  const templatePath = getTemplatePath('pr-review-prompt');
  const templateContent = await fs.readFile(templatePath, 'utf-8');

  const customData = {
    var_prTitle: prDetails.title,
    var_prDescription: prDetails.body,
    var_changedFiles: prDetails.changedFiles
      .map((file) => file.filename)
      .join('\n'),
  };

  const processedFiles = await processFiles({
    ...options,
    filter: prDetails.changedFiles.map((file) => file.filename),
  });

  const prReviewPrompt = await generateMarkdown(
    processedFiles,
    templateContent,
    {
      customData,
      noCodeblock: options.noCodeblock,
      lineNumbers: options.lineNumbers,
    },
  );

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
