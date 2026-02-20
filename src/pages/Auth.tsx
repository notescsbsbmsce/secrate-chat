import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { generateKeyPair, exportPublicKey, storePrivateKey } from '@/lib/crypto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LockKeyhole, Shield, UserPlus, LogIn } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

export default function Auth() {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !username || !password) return;
    if (username.length < 3) { toast.error('Username must be at least 3 characters'); return; }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }

    setLoading(true);
    try {
      // Generate key pair
      const keyPair = await generateKeyPair();
      const publicKeyStr = await exportPublicKey(keyPair.publicKey);

      // Sign up
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) throw error;
      if (!data.user) throw new Error('Signup failed');

      // Store encrypted private key in IndexedDB
      await storePrivateKey(data.user.id, keyPair.privateKey, password);

      // Store public key in profile
      await supabase.from('profiles').update({ public_key: publicKeyStr }).eq('user_id', data.user.id);

      toast.success('Account created! Keys generated securely.');
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Password is needed to decrypt private key later - stored in memory only during session
      sessionStorage.setItem('_kp', password);
      toast.success('Welcome back!');
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-8"
      >
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">VaultChat</h1>
          <p className="text-sm text-muted-foreground">End-to-end encrypted messaging</p>
        </div>

        {/* Form */}
        <AnimatePresence mode="wait">
          <motion.form
            key={isSignup ? 'signup' : 'login'}
            initial={{ opacity: 0, x: isSignup ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isSignup ? -20 : 20 }}
            transition={{ duration: 0.2 }}
            onSubmit={isSignup ? handleSignup : handleLogin}
            className="space-y-4"
          >
            <div className="space-y-3">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-12 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                required
              />
              {isSignup && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                  <Input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className="h-12 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                    required
                    minLength={3}
                    maxLength={30}
                  />
                </motion.div>
              )}
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-12 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                required
                minLength={6}
              />
            </div>

            <Button type="submit" className="h-12 w-full text-base font-semibold" disabled={loading}>
              {loading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : isSignup ? (
                <>
                  <UserPlus className="mr-2 h-5 w-5" />
                  Create Account
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-5 w-5" />
                  Sign In
                </>
              )}
            </Button>

            {isSignup && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-xs text-primary">
                <LockKeyhole className="h-4 w-4 shrink-0" />
                <span>Your encryption keys are generated on-device and never leave your phone.</span>
              </div>
            )}
          </motion.form>
        </AnimatePresence>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setIsSignup(!isSignup)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
