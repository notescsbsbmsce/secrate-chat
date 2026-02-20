import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { Shield, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function Invite() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [inviterUsername, setInviterUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/auth?redirect=/invite/${token}`);
      return;
    }
    loadInvite();
  }, [user, authLoading, token]);

  const loadInvite = async () => {
    const { data: invite } = await supabase
      .from('invite_tokens')
      .select('*')
      .eq('token', token!)
      .is('used_at', null)
      .single();

    if (!invite) {
      setError('This invite link is invalid or has expired.');
      return;
    }

    if (invite.created_by === user!.id) {
      setError("You can't use your own invite link.");
      return;
    }

    // Check if expired
    if (new Date(invite.expires_at) < new Date()) {
      setError('This invite link has expired.');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('user_id', invite.created_by)
      .single();

    setInviterUsername(profile?.username || 'Unknown');
  };

  const acceptInvite = async () => {
    setLoading(true);
    try {
      // Get the invite
      const { data: invite } = await supabase
        .from('invite_tokens')
        .select('*')
        .eq('token', token!)
        .is('used_at', null)
        .single();

      if (!invite) throw new Error('Invalid invite');

      // Mark invite as used
      await supabase.from('invite_tokens').update({
        used_by: user!.id,
        used_at: new Date().toISOString(),
      }).eq('token', token!);

      // Send friend request
      await supabase.from('friend_requests').insert({
        sender_id: invite.created_by,
        receiver_id: user!.id,
        status: 'accepted', // Auto-accept since invite was shared
      });

      toast.success('Friend added!');
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept invite');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Shield className="h-8 w-8 text-primary" />
        </div>

        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={() => navigate('/')} variant="secondary" className="w-full">Go Home</Button>
          </>
        ) : inviterUsername ? (
          <>
            <div>
              <h2 className="text-xl font-bold text-foreground">Friend Invite</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="text-primary font-medium">@{inviterUsername}</span> invited you to connect on VaultChat
              </p>
            </div>
            <Button onClick={acceptInvite} disabled={loading} className="w-full h-12">
              <UserPlus className="mr-2 h-5 w-5" />
              {loading ? 'Connecting...' : 'Accept & Connect'}
            </Button>
          </>
        ) : (
          <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
      </div>
    </div>
  );
}
