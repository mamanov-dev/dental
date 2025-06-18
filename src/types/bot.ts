export interface FlowStep {
  id: string;
  message: string;
  type: 'input' | 'selection' | 'confirmation' | 'info';
  validation?: ValidationRule[];
  options?: ResponseOption[];
  nextStep?: string | ((context: ConversationContext) => string);
}

export interface ValidationRule {
  type: 'required' | 'phone' | 'date' | 'time' | 'custom';
  message: string;
  validator?: (value: string) => boolean;
}

export interface ConversationFlow {
  id: string;
  name: string;
  steps: FlowStep[];
  fallbackStep?: string;
}

export interface BotCommand {
  command: string;
  description: string;
  handler: (session: ChatSession, args: string[]) => Promise<BotResponse>;
}