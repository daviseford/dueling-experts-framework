export interface ParsedArgs {
  topic?: string;
  mode?: string;
  maxTurns?: number;
  first?: string;
  implModel?: string;
  reviewTurns?: number;
  noPr?: boolean;
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
        result.mode = argv[++i];
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
      default:
        if (!argv[i].startsWith('--')) {
          positional.push(argv[i]);
        }
        break;
    }
  }
  // Allow bare positional args as the topic: def add dark mode
  if (!result.topic && positional.length > 0) {
    result.topic = positional.join(' ');
  }
  return result;
}
