/**
 * Which providers Roofscape knows how to talk to.
 *
 * Roofscape supplies no model. It supplies this list, and uses whichever
 * credentials the person running it already owns. Adding a vendor that speaks
 * the OpenAI shape is an entry here and nothing else.
 */

export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'openai-compatible'

export interface ProviderSpec {
  name: string
  label: string
  kind: ProviderKind
  /** Fixed for local providers; the default for hosted ones. */
  baseUrl?: string
  /** The environment variable checked when no credential is configured. */
  envVar?: string
  /** Local providers need no key at all. */
  needsKey: boolean
  /** Enough of a hint to choose without going to look it up. */
  note: string
  /** Models worth defaulting to, best first. Not exhaustive — any id is allowed. */
  suggested: readonly string[]
}

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    name: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    needsKey: true,
    note: 'Claude. Strong on long reasoning and on code review.',
    suggested: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  },
  {
    name: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    envVar: 'OPENAI_API_KEY',
    needsKey: true,
    note: 'GPT. Broad and dependable.',
    suggested: ['gpt-5', 'gpt-5-mini'],
  },
  {
    name: 'google',
    label: 'Google',
    kind: 'google',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    needsKey: true,
    note: 'Gemini. Very large contexts.',
    suggested: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    needsKey: true,
    note: 'One key, most models. The simplest way to try something unfamiliar.',
    suggested: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'deepseek/deepseek-chat'],
  },
  {
    name: 'xai',
    label: 'xAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    envVar: 'XAI_API_KEY',
    needsKey: true,
    note: 'Grok.',
    suggested: ['grok-4'],
  },
  {
    name: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
    needsKey: true,
    note: 'Very fast, open-weight models. Good for the bulk jobs.',
    suggested: ['llama-3.3-70b-versatile'],
  },
  {
    name: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
    needsKey: true,
    note: 'Inexpensive and strong at code.',
    suggested: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    name: 'ollama',
    label: 'Ollama (on this machine)',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    needsKey: false,
    note: 'Runs locally. Costs nothing, works offline, never leaves the machine.',
    suggested: ['qwen3:8b', 'qwen2.5-coder:3b', 'llama3.2:3b'],
  },
  {
    name: 'lmstudio',
    label: 'LM Studio (on this machine)',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    needsKey: false,
    note: 'Runs locally, like Ollama, if that is what you already use.',
    suggested: [],
  },
]

export const providerSpec = (name: string): ProviderSpec | undefined =>
  PROVIDERS.find((p) => p.name === name)

/** Local providers cost nothing, so they are safe defaults and safe for bulk work. */
export const isLocal = (name: string): boolean => providerSpec(name)?.needsKey === false
