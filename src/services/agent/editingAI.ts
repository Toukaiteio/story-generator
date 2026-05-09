import { DetailerExpert } from './detailer'
import type { AgentType } from '@/types/agent'

export class EditingAIExpert extends DetailerExpert {
  type: AgentType = 'editingAI'
  name = 'Editing AI'
}
