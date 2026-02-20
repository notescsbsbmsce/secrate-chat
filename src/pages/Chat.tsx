import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { encryptMessage, decryptMessage, importPublicKey, retrievePrivateKey } from '@/lib/crypto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, LockKeyhole, Send, Check, CheckCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

interface DecryptedMessage {
  id: string;
  sender_id: string;
  text: string;
  created_at: string;
  read_at: string | null;
}

export default function Chat() {
  const { friendId } = useParams<{ friendId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [friendProfile, setFriendProfile] = useState<{ username: string; public_key: string | null } | null>(null);
  const [myProfile, setMyProfile] = useState<{ public_key: string | null } | null>(null);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !friendId) return;
    init();
  }, [user, friendId]);

  // Subscribe to new messages
  useEffect(() => {
    if (!user || !friendId || !privateKey) return;

    // Create a stable channel name based on both user IDs (sorted alphabetically)
    const roomId = [user.id, friendId].sort().join('-');
    const channel = supabase
      .channel(`chat:${roomId}`) 
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, async (payload) => {
        const msg = payload.new as any;
        
        // Match messages for this specific conversation
        const isFromFriend = msg.sender_id === friendId && msg.receiver_id === user.id;
        const isFromMe = msg.sender_id === user.id && msg.receiver_id === friendId;
        
        if (!isFromFriend && !isFromMe) return;

        try {
          const text = await decryptMessage(msg.ciphertext, msg.encrypted_key, msg.iv, privateKey, user.id);
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, { id: msg.id, sender_id: msg.sender_id, text, created_at: msg.created_at, read_at: msg.read_at }];
          });
          if (msg.sender_id === friendId) markAsRead([msg.id]);
        } catch (e) {
          console.error("Encryption mismatch or error:", e);
          // Only show 'Encrypted' if it's NOT already in our list (sender already has the plaintext)
          setMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, { id: msg.id, sender_id: msg.sender_id, text: '🔒 Encrypted message', created_at: msg.created_at, read_at: msg.read_at }];
          });
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const updatedMsg = payload.new as any;
        setMessages(prev => prev.map(m => m.id === updatedMsg.id ? { ...m, read_at: updatedMsg.read_at } : m));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, friendId, privateKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const init = async () => {
    setLoading(true);
    // Load profiles
    const [{ data: fProfile }, { data: mProfile }] = await Promise.all([
      supabase.from('profiles').select('username, public_key').eq('user_id', friendId!).single(),
      supabase.from('profiles').select('public_key').eq('user_id', user!.id).single()
    ]);

    setFriendProfile(fProfile);
    setMyProfile(mProfile);

    // Retrieve private key
    const password = sessionStorage.getItem('_kp');
    if (password) {
      try {
        const pk = await retrievePrivateKey(user!.id, password);
        setPrivateKey(pk);
        if (pk) await loadMessages(pk);
      } catch {
        toast.error('Could not decrypt your keys. Please log in again.');
      }
    } else {
      toast.error('Session expired. Please log in again.');
    }
    setLoading(false);
    markAsRead();
  };

  const markAsRead = async (messageIds?: string[]) => {
    if (!user || !friendId) return;
    
    let query = supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('receiver_id', user.id)
      .eq('sender_id', friendId)
      .is('read_at', null);
      
    if (messageIds) {
      query = query.in('id', messageIds);
    }
    
    await query;
  };

  const loadMessages = async (pk: CryptoKey) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${user!.id},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${user!.id})`)
      .order('created_at', { ascending: true });

    if (!data) return;

    const decrypted: DecryptedMessage[] = [];
    for (const msg of data) {
      try {
        const text = await decryptMessage(msg.ciphertext, msg.encrypted_key, msg.iv, pk, user!.id);
        decrypted.push({ id: msg.id, sender_id: msg.sender_id, text, created_at: msg.created_at, read_at: msg.read_at });
      } catch {
        decrypted.push({ 
          id: msg.id, 
          sender_id: msg.sender_id, 
          text: '🔒 Unable to decrypt', 
          created_at: msg.created_at, 
          read_at: msg.read_at 
        });
      }
    }
    setMessages(decrypted);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    
    if (!friendProfile?.public_key) {
      toast.error("This user hasn't set up encryption yet.");
      return;
    }

    setSending(true);
    try {
      const pubKeys: { [id: string]: CryptoKey } = {};
      const rKey = await importPublicKey(friendProfile.public_key);
      pubKeys[friendId!] = rKey;
      
      if (myProfile?.public_key) {
        const sKey = await importPublicKey(myProfile.public_key);
        pubKeys[user!.id] = sKey;
      }

      const encrypted = await encryptMessage(newMessage.trim(), pubKeys);

      const { data, error } = await supabase.from('messages').insert({
        sender_id: user!.id,
        receiver_id: friendId!,
        ciphertext: encrypted.ciphertext,
        encrypted_key: JSON.stringify(encrypted.encryptedKeys),
        iv: encrypted.iv,
      }).select().single();

      if (error) throw error;

      // Add to local messages if not already added by subscription
      setMessages(prev => {
        if (prev.find(m => m.id === data.id)) return prev;
        return [...prev, {
          id: data.id,
          sender_id: user!.id,
          text: newMessage.trim(),
          created_at: data.created_at,
          read_at: null,
        }];
      });
      setNewMessage('');
    } catch (err: any) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="glass-surface sticky top-0 z-10 border-b border-border px-2 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {friendProfile?.username?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">@{friendProfile?.username}</p>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <LockKeyhole className="h-2.5 w-2.5 encryption-badge" />
              End-to-end encrypted
            </p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {/* Encryption notice */}
        <div className="mb-4 flex justify-center">
          <div className="rounded-lg bg-primary/5 px-3 py-2 text-center">
            <p className="text-[11px] text-primary flex items-center gap-1 justify-center">
              <LockKeyhole className="h-3 w-3" />
              Messages are end-to-end encrypted. No one outside this chat can read them.
            </p>
          </div>
        </div>

        {messages.map((msg, i) => {
          const isMine = msg.sender_id === user!.id;
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.005 }}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                  isMine
                    ? 'chat-bubble-sent rounded-br-md'
                    : 'chat-bubble-received rounded-bl-md'
                }`}
              >
                <p className="text-sm leading-relaxed break-words">{msg.text}</p>
                <div className="mt-0.5 flex items-center justify-end gap-1">
                  <p className={`text-[10px] ${isMine ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                    {formatTime(msg.created_at)}
                  </p>
                  {isMine && (
                    <div className={msg.read_at ? "text-blue-400" : "text-primary-foreground/40"}>
                      {msg.read_at ? (
                        <CheckCheck className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="glass-surface sticky bottom-0 border-t border-border p-3">
        <form onSubmit={sendMessage} className="flex gap-2">
          <Input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Message"
            className="h-11 flex-1 bg-secondary border-border text-foreground placeholder:text-muted-foreground rounded-full px-4"
            maxLength={5000}
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 rounded-full"
            disabled={!newMessage.trim() || sending}
          >
            <Send className="h-5 w-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
