export interface Character {
  id: string;
  name: string;
  role: string;
  personality: string;
  habits: string[];
  emotions: string;
  nature: string;
  avatarSeed: string;
  avatarUrl?: string;
  avatarPrompt?: string;
  memory?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  imageUrl?: string;
  imageDescription?: string;
}

export interface ChatSession {
  characterId: string;
  messages: Message[];
}
