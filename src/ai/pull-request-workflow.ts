import { confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { GitHubAPI } from '../github/github-api';
import type { AiAssistedTaskOptions, PullRequestDetails } from '../types';
import { TaskCache } from '../utils/task-cache';
import { generateAIResponse } from './generate-ai-response';
import { getModelConfig } from './model-config';
import { parseAICodegenResponse } from './parse-ai-codegen-response';

export async function runPullRequestWorkflow(options: AiAssistedTaskOptions) {
  const spinner = ora();
  try {
    const githubAPI = new GitHubAPI();
    const taskCache = new TaskCache(options.path || process.cwd());

    // Fetch pull request details
    spinner.start('Fetching pull request details...');
    const prNumber = await input({ message: 'Enter the pull request number:' });
    const prDetails = await githubAPI.getPullRequestDetails(Number(prNumber));
    spinner.succeed('Pull request details fetched successfully');

    let iteration = 1;
    let continueIterating = true;

    while (continueIterating) {
      spinner.start(`Processing pull request iteration ${iteration}...`);

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
          await githubAPI.applyChangesToPR(prNumber, parsedResponse);
          console.log(chalk.green('Changes applied to the pull request'));
          break;
        case 'comment':
          // Add a comment to the pull request
          await githubAPI.addCommentToPR(prNumber, parsedResponse.summary);
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
  const prompt = `
Analyze the following pull request and provide suggestions for improvements:

Title: ${prDetails.title}
Description: ${prDetails.body}

Changes:
${prDetails.changedFiles.map((file) => `- ${file.filename}`).join('\n')}

Please provide a summary of suggested improvements, focusing on code quality, potential bugs, and adherence to best practices.
`;

  return generateAIResponse(
    prompt,
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
