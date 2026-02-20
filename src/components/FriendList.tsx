import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Shield, Search, UserPlus, Link2, LogOut, Check, X, MessageCircle, LockKeyhole, User, Copy } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface Profile {
  user_id: string;
  username: string;
  public_key: string | null;
}

interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  sender_profile?: Profile;
  receiver_profile?: Profile;
}

export default function FriendList() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<FriendRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!user) return;
    loadProfile();
    loadFriends();
  }, [user]);

  const loadProfile = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, public_key')
      .eq('user_id', user!.id)
      .single();
    if (data) setMyProfile(data);
  };

  const loadFriends = async () => {
    const { data: requests } = await supabase
      .from('friend_requests')
      .select('*')
      .or(`sender_id.eq.${user!.id},receiver_id.eq.${user!.id}`);

    if (!requests) return;

    // Get all user IDs we need profiles for
    const userIds = new Set<string>();
    requests.forEach(r => { userIds.add(r.sender_id); userIds.add(r.receiver_id); });

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, username, public_key')
      .in('user_id', Array.from(userIds));

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

    const enriched = requests.map(r => ({
      ...r,
      sender_profile: profileMap.get(r.sender_id),
      receiver_profile: profileMap.get(r.receiver_id),
    }));

    setFriends(enriched.filter(r => r.status === 'accepted'));
    setPendingRequests(enriched.filter(r => r.status === 'pending'));
  };

  const searchUsers = async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return;
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, public_key')
      .ilike('username', `%${searchQuery}%`)
      .neq('user_id', user!.id)
      .limit(10);
    setSearchResults(data || []);
  };

  const sendFriendRequest = async (receiverId: string) => {
    const { error } = await supabase.from('friend_requests').insert({
      sender_id: user!.id,
      receiver_id: receiverId,
    });
    if (error) {
      toast.error('Could not send request');
      return;
    }
    toast.success('Friend request sent!');
    setSearchResults(prev => prev.filter(p => p.user_id !== receiverId));
    loadFriends();
  };

  const handleRequest = async (requestId: string, status: 'accepted' | 'rejected') => {
    await supabase.from('friend_requests').update({ status }).eq('id', requestId);
    toast.success(status === 'accepted' ? 'Friend added!' : 'Request declined');
    loadFriends();
  };

  const createInviteLink = async () => {
    const { data, error } = await supabase.from('invite_tokens').insert({ created_by: user!.id }).select().single();
    if (error || !data) { toast.error('Could not create link'); return; }
    const link = `${window.location.origin}/invite/${data.token}`;
    await navigator.clipboard.writeText(link);
    toast.success('Invite link copied!');
  };

  const getFriendProfile = (fr: FriendRequest) => {
    return fr.sender_id === user!.id ? fr.receiver_profile : fr.sender_profile;
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="glass-surface sticky top-0 z-10 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">VaultChat</h1>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={() => {
              if (myProfile) {
                navigator.clipboard.writeText(myProfile.user_id);
                toast.success('Your UID copied!');
              }
            }}>
              <User className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowSearch(!showSearch)}>
              <Search className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={createInviteLink}>
              <Link2 className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Username display */}
        {myProfile && (
          <p className="mt-1 text-xs text-muted-foreground">@{myProfile.username}</p>
        )}

        {/* Search */}
        <AnimatePresence>
          {showSearch && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-3 overflow-hidden"
            >
              <div className="flex gap-2">
                <Input
                  placeholder="Search username..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchUsers()}
                  className="h-10 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                />
                <Button size="sm" onClick={searchUsers} className="h-10 px-4">
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mt-2 space-y-1">
                  {searchResults.map(p => (
                    <motion.div
                      key={p.user_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center justify-between rounded-lg bg-secondary p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
                          {p.username[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-foreground">@{p.username}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => sendFriendRequest(p.user_id)}>
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Pending requests */}
      {pendingRequests.filter(r => r.receiver_id === user!.id).length > 0 && (
        <div className="border-b border-border px-4 py-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Requests</p>
          {pendingRequests.filter(r => r.receiver_id === user!.id).map(req => (
            <div key={req.id} className="flex items-center justify-between rounded-lg bg-secondary/50 p-3 mb-1">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-sm font-semibold text-accent">
                  {req.sender_profile?.username?.[0]?.toUpperCase() || '?'}
                </div>
                <span className="text-sm text-foreground">@{req.sender_profile?.username}</span>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" onClick={() => handleRequest(req.id, 'accepted')}>
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleRequest(req.id, 'rejected')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends / Chat list */}
      <div className="flex-1 px-4 py-2">
        {friends.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageCircle className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No conversations yet</p>
            <p className="mt-1 text-xs text-muted-foreground/70">Search for a username or share an invite link</p>
          </div>
        ) : (
          <div className="space-y-1">
            {friends.map(fr => {
              const friend = getFriendProfile(fr);
              if (!friend) return null;
              return (
                <motion.button
                  key={fr.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => navigate(`/chat/${friend.user_id}`)}
                  className="flex w-full items-center gap-4 rounded-xl px-2 py-3 text-left transition-all hover:bg-secondary/50 active:bg-secondary border-b border-border/50 last:border-0"
                >
                  <div className="relative">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary ring-2 ring-background">
                      {friend.username[0]?.toUpperCase()}
                    </div>
                    <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-background bg-green-500"></div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-sm font-semibold text-foreground truncate">@{friend.username}</p>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">12:34 PM</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <LockKeyhole className="h-3 w-3 encryption-badge shrink-0" />
                        End-to-end encrypted
                      </p>
                      <div className="h-2 w-2 rounded-full bg-primary shrink-0"></div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* Encryption footer */}
      <div className="border-t border-border px-4 py-3 text-center">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
          <LockKeyhole className="h-3 w-3 encryption-badge" />
          Messages are end-to-end encrypted
        </p>
      </div>
    </div>
  );
}
