export function extractIssueNumberFromBranch(branchName: string): string | null {
  const match = branchName.match(/issue-(\d+)/);
  return match ? match[1] : null;
}