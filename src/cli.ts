export interface ParsedArgs {
  topic?: string;
  mode?: 'edit' | 'planning';
  maxTurns?: number;
  first?: string;
  implModel?: string;
  reviewTurns?: number;
  noPr?: boolean;
  noFast?: boolean;
  noWorktree?: boolean;
  version?: boolean;
  help?: boolean;
  /** Comma-separated agent list (e.g., 'claude,codex' or 'claude,claude'). */
  agents?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--topic':
        result.topic = argv[++i];
        break;
      case '--mode':
        result.mode = argv[++i] as 'edit' | 'planning';
        break;
      case '--max-turns':
        result.maxTurns = parseInt(argv[++i], 10);
        break;
      case '--first':
        result.first = argv[++i];
        break;
      case '--impl-model':
        result.implModel = argv[++i];
        break;
      case '--review-turns':
        result.reviewTurns = parseInt(argv[++i], 10);
        break;
      case '--no-pr':
        result.noPr = true;
        break;
      case '--no-fast':
        result.noFast = true;
        break;
      case '--no-worktree':
        result.noWorktree = true;
        break;
      case '--version':
      case '-v':
        result.version = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--agents':
        result.agents = argv[++i];
        break;
      default:
        if (argv[i].startsWith('--')) {
          throw new Error(`Unknown flag '${argv[i]}'. Run 'def' with no arguments for usage.`);
        }
        positional.push(argv[i]);
        break;
    }
  }
  // Allow bare positional args as the topic: def add dark mode
  if (!result.topic && positional.length > 0) {
    result.topic = positional.join(' ');
  }
  return result;
}
