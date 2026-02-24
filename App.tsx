import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Settings2, 
  User, 
  Send, 
  Trash2, 
  ChevronLeft, 
  Sparkles,
  Smile,
  Zap,
  Heart,
  Ghost,
  Image as ImageIcon,
  Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Character, Message, ChatSession } from './types';
import { getGeminiResponse, generateAvatar, summarizeConversation, generateSceneImage } from './services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_CHARACTERS: Character[] = [
  {
    id: '1',
    name: 'Eara',
    role: 'Mysterious Librarian',
    personality: 'Quiet, observant, and deeply knowledgeable about ancient myths.',
    habits: ['Adjusts glasses frequently', 'Speaks in riddles', 'Always carries a leather-bound journal'],
    emotions: 'Calm but curious',
    nature: 'Introverted and wise',
    avatarSeed: 'eara'
  },
  {
    id: '2',
    name: 'Jax',
    role: 'Cyberpunk Mechanic',
    personality: 'Rough around the edges, sarcastic, but fiercely loyal.',
    habits: ['Chews on a toothpick', 'Wipes grease off hands', 'Taps feet when impatient'],
    emotions: 'Slightly annoyed but helpful',
    nature: 'Practical and street-smart',
    avatarSeed: 'jax'
  }
];

export default function App() {
  const [userId] = useState(() => {
    const saved = localStorage.getItem('userId');
    if (saved) return saved;
    const newId = Math.random().toString(36).substr(2, 9);
    localStorage.setItem('userId', newId);
    return newId;
  });

  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, ChatSession>>({});
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Partial<Character> | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [isGeneratingScene, setIsGeneratingScene] = useState(false);
  const [viewingAvatarUrl, setViewingAvatarUrl] = useState<string | null>(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [userAvatarPrompt, setUserAvatarPrompt] = useState('');
  const [isGeneratingUserAvatar, setIsGeneratingUserAvatar] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  const apiFetch = async (url: string, options: RequestInit = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'x-user-id': userId,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const text = await res.text();
      let errorMessage = `Server returned ${res.status}`;
      try {
        const json = JSON.parse(text);
        if (json.error) errorMessage = json.error;
      } catch {
        // Not JSON, use the status text or a snippet of the body
        if (text.includes('<!DOCTYPE html>')) {
          errorMessage = "Server returned HTML instead of JSON. This usually means the API route was not found or the server crashed.";
        } else {
          errorMessage = text.substring(0, 100);
        }
      }
      throw new Error(errorMessage);
    }

    return res;
  };

  // Initial Data Fetch
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch User Profile
        const userRes = await apiFetch('/api/user/profile');
        const userData = await userRes.json();
        setUserAvatarUrl(userData.avatarUrl);

        const res = await apiFetch('/api/characters');
        const data = await res.json();
        setCharacters(data);
        
        // If no characters, add defaults to DB
        if (data.length === 0) {
          for (const char of DEFAULT_CHARACTERS) {
            await apiFetch('/api/characters', {
              method: 'POST',
              body: JSON.stringify(char)
            });
          }
          setCharacters(DEFAULT_CHARACTERS);
        }
      } catch (err) {
        console.error("Failed to fetch characters", err);
      } finally {
        setIsInitialLoading(false);
      }
    };
    fetchData();
  }, [userId]);

  // Fetch messages when active character changes
  useEffect(() => {
    if (!activeCharacterId) return;
    
    const fetchMessages = async () => {
      try {
        const res = await apiFetch(`/api/messages/${activeCharacterId}`);
        const messages = await res.json();
        setSessions(prev => ({
          ...prev,
          [activeCharacterId]: { characterId: activeCharacterId, messages }
        }));
      } catch (err) {
        console.error("Failed to fetch messages", err);
      }
    };
    fetchMessages();
  }, [activeCharacterId, userId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeCharacterId]);

  const activeCharacter = characters.find(c => c.id === activeCharacterId);
  const currentSession = activeCharacterId ? sessions[activeCharacterId] || { characterId: activeCharacterId, messages: [] } : null;

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !activeCharacter || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    // Save user message to DB
    await apiFetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ ...userMessage, characterId: activeCharacter.id })
    });

    const updatedMessages = [...(currentSession?.messages || []), userMessage];
    setSessions(prev => ({
      ...prev,
      [activeCharacter.id]: { characterId: activeCharacter.id, messages: updatedMessages }
    }));
    setInput('');

    // Auto-trigger scene generation if user asks for a pic
    const lowerInput = input.toLowerCase();
    const isAskingForPic = lowerInput.includes('picture') || lowerInput.includes('photo') || lowerInput.includes('image') || lowerInput.includes('pic');
    
    if (isAskingForPic) {
      handleGenerateScene(updatedMessages);
    }

    setIsLoading(true);

    try {
      const response = await getGeminiResponse(activeCharacter, currentSession?.messages || [], input);
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: response || "I'm not sure what to say...",
        timestamp: Date.now()
      };

      // Save AI message to DB
      await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ ...aiMessage, characterId: activeCharacter.id })
      });

      setSessions(prev => ({
        ...prev,
        [activeCharacter.id]: { 
          characterId: activeCharacter.id, 
          messages: [...updatedMessages, aiMessage] 
        }
      }));

      // Periodically update memory (e.g., every 5 messages)
      if (updatedMessages.length % 5 === 0) {
        updateMemory(activeCharacter, [...updatedMessages, aiMessage]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateScene = async (overrideHistory?: Message[]) => {
    if (!activeCharacter || isGeneratingScene || isLoading) return;
    
    setIsGeneratingScene(true);
    try {
      const historyToUse = overrideHistory || currentSession?.messages || [];
      const { url, description } = await generateSceneImage(activeCharacter, historyToUse);
      
      const aiMessage: Message = {
        id: Date.now().toString(),
        role: 'model',
        content: `*Visualizing the scene...*`,
        timestamp: Date.now(),
        imageUrl: url,
        imageDescription: description
      };

      // Save AI message to DB
      await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ ...aiMessage, characterId: activeCharacter.id })
      });

      setSessions(prev => {
        const currentMsgs = prev[activeCharacter.id]?.messages || [];
        return {
          ...prev,
          [activeCharacter.id]: { 
            characterId: activeCharacter.id, 
            messages: [...currentMsgs, aiMessage] 
          }
        };
      });
    } catch (error) {
      console.error("Scene generation failed:", error);
      alert("Failed to generate scene image.");
    } finally {
      setIsGeneratingScene(false);
    }
  };

  const updateMemory = async (char: Character, history: Message[]) => {
    try {
      const newMemory = await summarizeConversation(char, history);
      if (newMemory) {
        const updatedChar = { ...char, memory: newMemory };
        await apiFetch('/api/characters', {
          method: 'POST',
          body: JSON.stringify(updatedChar)
        });
        setCharacters(prev => prev.map(c => c.id === char.id ? updatedChar : c));
      }
    } catch (err) {
      console.error("Failed to update memory", err);
    }
  };

  const startEditing = (char?: Character) => {
    if (char) {
      setEditingCharacter(char);
    } else {
      setEditingCharacter({
        id: Math.random().toString(36).substr(2, 9),
        name: '',
        role: '',
        personality: '',
        habits: [],
        emotions: 'Neutral',
        nature: '',
        avatarSeed: Math.random().toString(36).substr(2, 5),
        avatarUrl: '',
        avatarPrompt: ''
      });
    }
    setIsEditing(true);
  };

  const handleGenerateAvatar = async () => {
    if (!editingCharacter?.avatarPrompt || isGeneratingAvatar) return;
    
    setIsGeneratingAvatar(true);
    try {
      const imageUrl = await generateAvatar(editingCharacter.avatarPrompt);
      setEditingCharacter(prev => ({ ...prev!, avatarUrl: imageUrl }));
    } catch (error) {
      console.error("Avatar generation failed:", error);
      alert("Failed to generate avatar. Please try again.");
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const handleGenerateUserAvatar = async () => {
    if (!userAvatarPrompt || isGeneratingUserAvatar) return;
    
    setIsGeneratingUserAvatar(true);
    try {
      const imageUrl = await generateAvatar(userAvatarPrompt);
      setUserAvatarUrl(imageUrl);
      await apiFetch('/api/user/profile', {
        method: 'POST',
        body: JSON.stringify({ avatarUrl: imageUrl })
      });
      setIsEditingUser(false);
    } catch (error) {
      console.error("User avatar generation failed:", error);
      alert("Failed to generate avatar. Please try again.");
    } finally {
      setIsGeneratingUserAvatar(false);
    }
  };

  const saveCharacter = async () => {
    if (!editingCharacter?.name) return;
    
    const char = editingCharacter as Character;
    
    try {
      await apiFetch('/api/characters', {
        method: 'POST',
        body: JSON.stringify(char)
      });

      setCharacters(prev => {
        const exists = prev.find(c => c.id === char.id);
        if (exists) {
          return prev.map(c => c.id === char.id ? char : c);
        }
        return [...prev, char];
      });
      setIsEditing(false);
      setEditingCharacter(null);
    } catch (err) {
      console.error("Failed to save character", err);
    }
  };

  const deleteCharacter = async (id: string) => {
    try {
      await apiFetch(`/api/characters/${id}`, { method: 'DELETE' });
      setCharacters(prev => prev.filter(c => c.id !== id));
      if (activeCharacterId === id) setActiveCharacterId(null);
      const newSessions = { ...sessions };
      delete newSessions[id];
      setSessions(newSessions);
    } catch (err) {
      console.error("Failed to delete character", err);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="h-screen bg-[#0a0502] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#ff4e00]/30 border-t-[#ff4e00] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0a0502] text-[#e0d8d0] font-sans selection:bg-[#ff4e00]/30">
      {/* Sidebar */}
      <aside className="w-80 border-r border-white/10 flex flex-col bg-[#0f0a08]">
        <div className="p-6 border-bottom border-white/10">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#ff4e00] to-[#3a1510] flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">PersonaPlay</h1>
          </div>
          
          <button 
            onClick={() => startEditing()}
            className="w-full py-3 px-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center justify-center gap-2 text-sm font-medium group"
          >
            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
            Create Character
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 custom-scrollbar">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold px-2 mb-2">Your Personas</p>
          {characters.map(char => (
            <div 
              key={char.id}
              onClick={() => {
                setActiveCharacterId(char.id);
                setIsEditing(false);
              }}
              className={cn(
                "group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border border-transparent",
                activeCharacterId === char.id ? "bg-[#ff4e00]/10 border-[#ff4e00]/30" : "hover:bg-white/5"
              )}
            >
              <img 
                src={char.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${char.avatarSeed}`} 
                alt={char.name}
                className="w-12 h-12 rounded-xl bg-white/5 object-cover"
              />
              <div className="flex-1 min-w-0">
                <h3 className={cn("font-medium truncate", activeCharacterId === char.id ? "text-[#ff4e00]" : "text-white")}>
                  {char.name}
                </h3>
                <p className="text-xs text-white/40 truncate">{char.role}</p>
              </div>
              <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                <button 
                  onClick={(e) => { e.stopPropagation(); startEditing(char); }}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white"
                >
                  <Settings2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); deleteCharacter(char.id); }}
                  className="p-1.5 hover:bg-red-500/20 rounded-lg text-white/60 hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-white/10 bg-black/20">
          <div 
            className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl cursor-pointer transition-colors group"
            onClick={() => setIsEditingUser(true)}
          >
            <div className="relative w-8 h-8 rounded-full bg-white/10 flex items-center justify-center overflow-hidden border border-white/10">
              {userAvatarUrl ? (
                <img src={userAvatarUrl} alt="User" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-white/60" />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Settings2 className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="text-xs">
              <p className="text-white/80 font-medium">Guest User</p>
              <p className="text-white/40">Customize Profile</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-[radial-gradient(circle_at_50%_30%,#1a0d0a_0%,transparent_70%)]">
        <AnimatePresence mode="wait">
          {!activeCharacterId && !isEditing ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col items-center justify-center p-12 text-center"
            >
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#ff4e00] to-[#3a1510] flex items-center justify-center mb-8 shadow-2xl shadow-[#ff4e00]/20">
                <MessageSquare className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-4xl font-light tracking-tight text-white mb-4">Welcome to PersonaPlay</h2>
              <p className="text-white/60 max-w-md leading-relaxed">
                Select a character from the sidebar or create a new one to begin your immersive roleplay journey.
              </p>
            </motion.div>
          ) : isEditing ? (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 overflow-y-auto p-8 md:p-12"
            >
              <div className="max-w-2xl mx-auto">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-2 text-sm text-white/40 hover:text-white mb-8 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" /> Back to Chat
                </button>

                <h2 className="text-3xl font-light text-white mb-8">
                  {editingCharacter?.name ? `Edit ${editingCharacter.name}` : 'Create New Persona'}
                </h2>

                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Name</label>
                      <input 
                        value={editingCharacter?.name || ''}
                        onChange={e => setEditingCharacter(prev => ({ ...prev!, name: e.target.value }))}
                        placeholder="e.g. Luna"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Role</label>
                      <input 
                        value={editingCharacter?.role || ''}
                        onChange={e => setEditingCharacter(prev => ({ ...prev!, role: e.target.value }))}
                        placeholder="e.g. Forest Guardian"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                        <Sparkles className="w-3 h-3" /> Realistic Avatar Prompt
                      </label>
                      <div className="flex gap-2">
                        <input 
                          value={editingCharacter?.avatarPrompt || ''}
                          onChange={e => setEditingCharacter(prev => ({ ...prev!, avatarPrompt: e.target.value }))}
                          placeholder="e.g. A futuristic cyborg with glowing blue eyes and silver hair"
                          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                        />
                        <button 
                          type="button"
                          onClick={handleGenerateAvatar}
                          disabled={!editingCharacter?.avatarPrompt || isGeneratingAvatar}
                          className="px-4 py-2 rounded-xl bg-[#ff4e00] text-white font-medium hover:bg-[#ff6a26] disabled:opacity-50 transition-all flex items-center gap-2"
                        >
                          {isGeneratingAvatar ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <Zap className="w-4 h-4" />
                          )}
                          Generate
                        </button>
                      </div>
                      <p className="text-[10px] text-white/30 italic">Uses AI to create a unique, high-quality portrait.</p>
                    </div>

                    {editingCharacter?.avatarUrl && (
                      <div className="flex items-center gap-4 p-2 bg-black/20 rounded-xl">
                        <img 
                          src={editingCharacter.avatarUrl} 
                          alt="Preview" 
                          className="w-16 h-16 rounded-lg object-cover border border-white/10"
                        />
                        <div className="flex-1">
                          <p className="text-xs font-medium text-white/80">Avatar Preview</p>
                          <p className="text-[10px] text-white/40">Realistic AI-generated portrait</p>
                        </div>
                        <button 
                          onClick={() => setEditingCharacter(prev => ({ ...prev!, avatarUrl: '' }))}
                          className="p-2 hover:bg-white/10 rounded-lg text-white/40 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Avatar URL (Optional)</label>
                    <input 
                      value={editingCharacter?.avatarUrl || ''}
                      onChange={e => setEditingCharacter(prev => ({ ...prev!, avatarUrl: e.target.value }))}
                      placeholder="https://example.com/avatar.png"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Personality</label>
                    <textarea 
                      value={editingCharacter?.personality || ''}
                      onChange={e => setEditingCharacter(prev => ({ ...prev!, personality: e.target.value }))}
                      placeholder="Describe how they behave, speak, and think..."
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                        <Heart className="w-3 h-3" /> Nature
                      </label>
                      <input 
                        value={editingCharacter?.nature || ''}
                        onChange={e => setEditingCharacter(prev => ({ ...prev!, nature: e.target.value }))}
                        placeholder="e.g. Stoic, Playful, Cynical"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                        <Smile className="w-3 h-3" /> Emotional State
                      </label>
                      <input 
                        value={editingCharacter?.emotions || ''}
                        onChange={e => setEditingCharacter(prev => ({ ...prev!, emotions: e.target.value }))}
                        placeholder="e.g. Melancholic, Excited"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <Zap className="w-3 h-3" /> Habits (Comma separated)
                    </label>
                    <input 
                      value={editingCharacter?.habits?.join(', ') || ''}
                      onChange={e => setEditingCharacter(prev => ({ ...prev!, habits: e.target.value.split(',').map(s => s.trim()) }))}
                      placeholder="e.g. Bites nails, Humming, Checking watch"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <MessageSquare className="w-3 h-3" /> Long-term Memory
                    </label>
                    <textarea 
                      value={editingCharacter?.memory || ''}
                      onChange={e => setEditingCharacter(prev => ({ ...prev!, memory: e.target.value }))}
                      placeholder="Key details the character remembers about your interactions..."
                      rows={4}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all resize-none text-sm"
                    />
                    <p className="text-[10px] text-white/30 italic">This is automatically updated as you chat, but you can edit it manually.</p>
                  </div>

                  <div className="pt-4">
                    <button 
                      onClick={saveCharacter}
                      className="w-full py-4 rounded-xl bg-[#ff4e00] text-white font-semibold hover:bg-[#ff6a26] transition-all shadow-lg shadow-[#ff4e00]/20"
                    >
                      Save Persona
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key={activeCharacterId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col h-full"
            >
              {/* Chat Header */}
              <header className="p-6 border-b border-white/10 flex items-center justify-between bg-black/20 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-4">
                  <div 
                    className="relative group/avatar cursor-zoom-in"
                    onClick={() => setViewingAvatarUrl(activeCharacter?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCharacter?.avatarSeed}`)}
                  >
                    <img 
                      src={activeCharacter?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCharacter?.avatarSeed}`} 
                      alt={activeCharacter?.name}
                      className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 object-cover group-hover/avatar:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 rounded-2xl flex items-center justify-center transition-opacity">
                      <ImageIcon className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-xl font-medium text-white">{activeCharacter?.name}</h2>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <p className="text-xs text-white/40">{activeCharacter?.role}</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="hidden md:flex flex-col items-end mr-4">
                    <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Nature</span>
                    <span className="text-xs text-white/60 italic">{activeCharacter?.nature}</span>
                  </div>
                  <button 
                    onClick={() => startEditing(activeCharacter!)}
                    className="p-2 hover:bg-white/10 rounded-xl text-white/60 transition-colors"
                  >
                    <Settings2 className="w-5 h-5" />
                  </button>
                </div>
              </header>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {currentSession?.messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                    <Ghost className="w-12 h-12 mb-4" />
                    <p className="text-sm italic">The air is still. Say something to {activeCharacter?.name}...</p>
                  </div>
                )}
                {currentSession?.messages.map((msg, idx) => (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex gap-4 max-w-3xl",
                      msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden",
                      msg.role === 'user' ? "bg-white/10 border border-white/10" : "bg-[#ff4e00]/20"
                    )}>
                      {msg.role === 'user' ? (
                        userAvatarUrl ? <img src={userAvatarUrl} alt="User" className="w-full h-full object-cover" /> : <User className="w-4 h-4" />
                      ) : (
                        <Sparkles className="w-4 h-4 text-[#ff4e00]" />
                      )}
                    </div>
                    <div className={cn(
                      "space-y-1",
                      msg.role === 'user' ? "text-right" : "text-left"
                    )}>
                      <div className={cn(
                        "px-5 py-3 rounded-2xl leading-relaxed text-[15px]",
                        msg.role === 'user' 
                          ? "bg-white/10 text-white rounded-tr-none" 
                          : "bg-white/5 border border-white/5 text-[#e0d8d0] rounded-tl-none"
                      )}>
                        {msg.imageUrl && (
                          <div className="mb-3 overflow-hidden rounded-xl border border-white/10">
                            <img 
                              src={msg.imageUrl} 
                              alt={msg.imageDescription || "Scene"} 
                              className="w-full aspect-video object-cover hover:scale-105 transition-transform duration-500 cursor-zoom-in"
                              onClick={() => window.open(msg.imageUrl, '_blank')}
                            />
                          </div>
                        )}
                        <div className="markdown-body">
                          <Markdown>{msg.content}</Markdown>
                        </div>
                      </div>
                      <p className="text-[10px] text-white/20 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </motion.div>
                ))}
                {isLoading && (
                  <div className="flex gap-4 mr-auto animate-pulse">
                    <div className="w-8 h-8 rounded-lg bg-[#ff4e00]/10 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-[#ff4e00]/40" />
                    </div>
                    <div className="bg-white/5 border border-white/5 rounded-2xl rounded-tl-none px-5 py-3">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" />
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce [animation-delay:0.2s]" />
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-6 bg-gradient-to-t from-[#0a0502] to-transparent">
                <div className="max-w-4xl mx-auto flex gap-2 mb-4">
                  <button 
                    type="button"
                    onClick={() => handleGenerateScene()}
                    disabled={isLoading || isGeneratingScene}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
                  >
                    {isGeneratingScene ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                    Generate Scene Pic
                  </button>
                </div>
                <form 
                  onSubmit={handleSendMessage}
                  className="max-w-4xl mx-auto relative group"
                >
                  <input 
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={`Message ${activeCharacter?.name}...`}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 pr-16 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all placeholder:text-white/20"
                  />
                  <button 
                    disabled={!input.trim() || isLoading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-[#ff4e00] text-white hover:bg-[#ff6a26] disabled:opacity-50 disabled:hover:bg-[#ff4e00] transition-all shadow-lg shadow-[#ff4e00]/20"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
                <p className="text-[10px] text-center text-white/20 mt-4 uppercase tracking-[0.2em]">
                  Roleplaying with {activeCharacter?.name} • AI may generate unexpected content
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* User Profile Modal */}
      <AnimatePresence>
        {isEditingUser && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#0f0a08] border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-light text-white">Your Profile</h2>
                <button onClick={() => setIsEditingUser(false)} className="text-white/40 hover:text-white">
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex flex-col items-center gap-4 mb-8">
                  <div className="w-24 h-24 rounded-3xl bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center">
                    {userAvatarUrl ? (
                      <img src={userAvatarUrl} alt="User" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-10 h-10 text-white/20" />
                    )}
                  </div>
                  <p className="text-xs text-white/40">Your current avatar</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Sparkles className="w-3 h-3" /> Avatar Prompt
                  </label>
                  <div className="flex gap-2">
                    <input 
                      value={userAvatarPrompt}
                      onChange={e => setUserAvatarPrompt(e.target.value)}
                      placeholder="Describe yourself..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#ff4e00]/50 focus:ring-1 focus:ring-[#ff4e00]/50 outline-none transition-all"
                    />
                    <button 
                      onClick={handleGenerateUserAvatar}
                      disabled={!userAvatarPrompt || isGeneratingUserAvatar}
                      className="px-4 py-2 rounded-xl bg-[#ff4e00] text-white font-medium hover:bg-[#ff6a26] disabled:opacity-50 transition-all flex items-center gap-2"
                    >
                      {isGeneratingUserAvatar ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-white/30 italic">AI will generate a realistic portrait based on your description.</p>
                </div>

                <button 
                  onClick={() => setIsEditingUser(false)}
                  className="w-full py-4 rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-all mt-4"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Avatar Viewer Modal */}
      <AnimatePresence>
        {viewingAvatarUrl && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setViewingAvatarUrl(null)}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 cursor-zoom-out"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-2xl w-full aspect-square rounded-3xl overflow-hidden border border-white/10 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <img 
                src={viewingAvatarUrl} 
                alt="Avatar" 
                className="w-full h-full object-cover"
              />
              <button 
                onClick={() => setViewingAvatarUrl(null)}
                className="absolute top-4 right-4 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white/60 hover:text-white transition-all backdrop-blur-md"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .markdown-body p {
          margin-bottom: 0.5rem;
        }
        .markdown-body p:last-child {
          margin-bottom: 0;
        }
        .markdown-body em {
          color: rgba(255, 255, 255, 0.5);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
