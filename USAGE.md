# Detailed Usage Guide

This document provides comprehensive usage instructions and examples for CodeWhisper.

## Table of Contents

* [Command Overview](#command-overview)
* [Detailed Command Usage](#detailed-command-usage)
* [Usage Examples](#usage-examples)
* [Advanced Usage Scenarios](#advanced-usage-scenarios)
* [CI/CD Integration](#cicd-integration)
* [Troubleshooting](#troubleshooting)

## Command Overview

CodeWhisper offers the following main commands:

* `task`: Start an AI-assisted coding task
* `apply-task`: Apply an AI-generated task from a file
* `interactive`: Start an interactive session to select files and generate output
* `generate`: Generate a markdown file from your codebase
* `list-models`: List available AI models
* `list-templates`: List available templates
* `export-templates`: Export templates to the current or specified directory

## Detailed Command Usage

### `task` : AI-Assisted Coding Task

```bash
codewhisper task [options]
```

Options:
* `-p, --path <path>`: Path to the codebase (default: current directory)
* `-m, --model <modelId>`: Specify the AI model to use (default: claude-3-5-sonnet-20240620)
* `-g, --gitignore <path>`: Path to .gitignore file (default: .gitignore)
* `-f, --filter <patterns...>`: File patterns to include (use glob patterns, e.g., "src/**/*.js")
* `-e, --exclude <patterns...>`: File patterns to exclude (use glob patterns, e.g., "**/*.test.js")
* `-s, --suppress-comments`: Strip comments from the code
* `-l, --line-numbers`: Add line numbers to code blocks
* `--case-sensitive`: Use case-sensitive pattern matching
* `--custom-ignores <patterns...>`: Additional patterns to ignore
* `--cache-path <path>`: Custom path for the cache file
* `--respect-gitignore`: Respect entries in .gitignore (default: true)
* `--no-respect-gitignore`: Do not respect entries in .gitignore
* `--invert`: Selected files will be excluded
* `--dry-run`: Perform a dry run without making actual changes. Saves changes to a file so you can apply them after review using apply-task
* `-max, --max-cost-threshold <number>`: Set a maximum cost threshold for AI operations in USD (e.g., 0.5 for $0.50)
* `--auto-commit`: Automatically commit changes
* `-t, --task <task>`: Short task title
* `-d, --description <description>`: Detailed task description
* `-i, --instructions <instructions>`: Additional instructions for the task

### `apply-task` : Apply AI-Generated Task from a previous dry-run

```bash
codewhisper apply-task <file> [options]
```

Options:
* `--auto-commit`: Automatically commit changes (default: false)

### `interactive` : Interactive Mode

```bash
codewhisper interactive [options]
```

Options:
* `-p, --path <path>`: Path to the codebase (default: current directory)
* `-pr, --prompt <prompt>`: Custom prompt to append to the output
* `-t, --template <template>`: Template to use
* `-g, --gitignore <path>`: Path to .gitignore file (default: .gitignore)
* `-f, --filter <patterns...>`: File patterns to include (use glob patterns, e.g., "src/**/*.js")
* `-e, --exclude <patterns...>`: File patterns to exclude (use glob patterns, e.g., "**/*.test.js")
* `-E, --open-editor`: Open the result in your default editor
* `-s, --suppress-comments`: Strip comments from the code
* `-l, --line-numbers`: Add line numbers to code blocks
* `--case-sensitive`: Use case-sensitive pattern matching
* `--no-codeblock`: Disable wrapping code inside markdown code blocks
* `--custom-data <json>`: Custom data to pass to the template (JSON string)
* `--custom-template <path>`: Path to a custom Handlebars template
* `--custom-ignores <patterns...>`: Additional patterns to ignore
* `--cache-path <path>`: Custom path for the cache file
* `--respect-gitignore`: Respect entries in .gitignore (default: true)
* `--no-respect-gitignore`: Do not respect entries in .gitignore
* `--invert`: Selected files will be excluded

### `generate` : Generate Output

```bash
codewhisper generate [options]
```

Options:
* `-p, --path <path>`: Path to the codebase (default: current directory)
* `-pr, --prompt <prompt>`: Custom prompt to append to the output
* `-o, --output <output>`: Output file name
* `-E, --open-editor`: Open the result in your default editor
* `-t, --template <template>`: Template to use (default: "default")
* `-g, --gitignore <path>`: Path to .gitignore file (default: .gitignore)
* `-f, --filter <patterns...>`: File patterns to include (use glob patterns, e.g., "src/**/*.js")
* `-e, --exclude <patterns...>`: File patterns to exclude (use glob patterns, e.g., "**/*.test.js")
* `-s, --suppress-comments`: Strip comments from the code
* `-l, --line-numbers`: Add line numbers to code blocks
* `--case-sensitive`: Use case-sensitive pattern matching
* `--no-codeblock`: Disable wrapping code inside markdown code blocks
* `--custom-data <json>`: Custom data to pass to the template (JSON string)
* `--custom-template <path>`: Path to a custom Handlebars template
* `--custom-ignores <patterns...>`: Additional patterns to ignore
* `--cache-path <path>`: Custom path for the cache file
* `--respect-gitignore`: Respect entries in .gitignore (default: true)
* `--no-respect-gitignore`: Do not respect entries in .gitignore

### `list-templates` : List Available Templates

```bash
codewhisper list-templates
```

This command lists all available templates in the templates directory. It doesn't take any options.

### `export-templates` : Export Templates

```bash
codewhisper export-templates [options]
```

Options:
* `-d, --dir <directory>`: Target directory for exported templates (default: current directory)

## Usage Examples

01. Include only JavaScript and TypeScript files:

```bash
codewhisper generate -f "**/*.js" "**/*.ts"
```

02. Exclude test files and the `dist` directory:

```bash
codewhisper generate -e "**/*.test.js" "dist/**/*"
```

03. Combine include and exclude patterns:

```bash
codewhisper generate -f "src/**/*" -e "**/*.test.js" "**/*.spec.js"
```

04. Use custom data in a template:

```bash
codewhisper generate --custom-data '{"projectName": "MyApp", "version": "1.0.0"}' --custom-template my-template.hbs
```

05. Generate a diff-based summary:

```bash
codewhisper generate --filter $(git diff --name-only HEAD^)
```

06. Analyze a specific subdirectory:

```bash
codewhisper generate -p ./src/components -f "**/*.tsx"
```

07. Generate a summary with a custom prompt:

```bash
codewhisper generate -pr "Analyze this code for potential security vulnerabilities"
```

08. Use interactive mode with inverted (exclude all selected files) selection:

```bash
codewhisper interactive --invert
```

09. Generate output with line numbers in code blocks:

```bash
codewhisper generate -l
```

10. Review changes in a specific branch compared to main:

```bash
codewhisper generate --filter $(git diff --name-only main...feature-branch) --template deep-code-review
```

## Advanced Usage Scenarios

11. Generate documentation for a new release:

```bash
codewhisper generate --filter $(git diff --name-only v1.0.0...v1.1.0) --template generate-project-documentation
```

12. Perform a security audit on recent changes:

```bash
codewhisper generate --filter $(git diff --name-only HEAD~10) --template security-focused-review
```

13. Create a code overview for onboarding new team members:

```bash
codewhisper generate -f "src/**/*" --template codebase-summary -o onboarding-guide.md
```

14. Generate an optimized LLM prompt for code explanation:

```bash
codewhisper generate --template optimize-llm-prompt --editor --custom-data '{"prompt": "your prompt goes here"}'
```

15. Start an AI-assisted coding task with a dry run:

```bash
codewhisper task --dry-run -t "Implement user authentication" -d "Add user login and registration functionality using JWT"
```

16. Apply an AI-generated task with automatic commit:

```bash
codewhisper apply-task ./codewhisper-task-output.json --auto-commit
```

17. Analyze code changes between two specific commits:

```bash
codewhisper generate --filter $(git diff --name-only commit1..commit2) --template deep-code-review
```

18. Generate a code summary for a specific pull request:

```bash
codewhisper generate --filter $(git diff --name-only main...pull-request-branch) --template codebase-summary
```

19. Create a custom template for generating API documentation:

```bash
codewhisper export-templates
# Edit the exported template to focus on API documentation
codewhisper generate --custom-template ./my-templates/api-docs.hbs -f "src/api/**/*"
```

20. Use CodeWhisper with a different LLM provider:

```bash
# Assuming you've set up the necessary environment variables for the new LLM provider
codewhisper generate --model my-custom-llm -t "Refactor the authentication module"
```

## CI/CD Integration

CodeWhisper can be easily integrated into your CI/CD pipeline. Here's an example of how to use CodeWhisper in a GitHub Actions workflow:

```yaml
name: Code Analysis
on: [push]
jobs:
  analyze-code:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Set up Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    - name: Install dependencies
      run: |
        npm install -g codewhisper
        npm install @anthropic-ai/sdk
    - name: Analyze codebase
      run: |
        codewhisper generate --path . --output codebase_summary.md
        node -e '
          const fs = require("fs");
          const Anthropic = require("@anthropic-ai/sdk");

          const anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
          });

          async function analyzeCode() {
            const summary = fs.readFileSync("codebase_summary.md", "utf8");
            const msg = await anthropic.messages.create({
              model: "claude-3-5-sonnet-20240620",
              max_tokens: 8192,
              messages: [
                {
                  role: "user",
                  content: `Analyze this codebase summary and provide insights:

${summary}

Perform a comprehensive analysis of this codebase. Identify areas for improvement, potential bugs, and suggest optimizations.`
                }
              ],
            });
            fs.writeFileSync("analysis.md", msg.content[0].text);
          }

          analyzeCode();
        '
      env:
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    - name: Upload analysis
      uses: actions/upload-artifact@v3
      with:
        name: code-analysis
        path: analysis.md
```

This workflow generates a codebase summary using CodeWhisper and then uses Anthropic's AI to analyze the summary and provide insights.

## Troubleshooting

Here are some common issues and their solutions:

01. **Issue**: CodeWhisper is not recognizing my custom template.
   **Solution**: Ensure that your custom template file has a `.hbs` extension and is in the correct directory. Use the `--custom-template` option with the full path to your template file.

02. **Issue**: The generated output is empty or incomplete.
   **Solution**: Check your file filters and ensure they're not excluding important files. Try running the command with the `--no-respect-gitignore` option to see if `.gitignore` is causing the issue.

03. **Issue**: CodeWhisper is running slowly on large codebases.
   **Solution**: Use more specific file filters to reduce the number of files processed. You can also try increasing the cache size or using a faster storage medium for the cache file.

04. **Issue**: AI-assisted tasks are not producing the expected results.
   **Solution**: Provide more detailed task descriptions and instructions. You can also try using a different AI model or adjusting the prompt in your custom template.

05. **Issue**: Error "ANTHROPIC_API_KEY (or OPENAI_API_KEY or GROQ_API_KEY) not set" when running AI-assisted tasks.
   **Solution**: Ensure you've set the `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` or `GROQ_API_KEY` ) environment variable with your API key. You can do this by running `export ANTHROPIC_API_KEY=your_api_key` or `export OPENAI_API_KEY=your_api_key` or `export GROQ_API_KEY=your_api_key` before running CodeWhisper.

For more complex issues or if these solutions don't help, please open an issue on the [CodeWhisper GitHub repository](https://github.com/gmickel/CodeWhisper/issues).