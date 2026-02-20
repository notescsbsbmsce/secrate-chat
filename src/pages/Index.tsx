import { useAuth } from '@/lib/auth-context';
import { Navigate } from 'react-router-dom';
import FriendList from '@/components/FriendList';

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return <FriendList />;
}
