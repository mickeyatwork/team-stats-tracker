import { useState } from 'react';
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { USER_STATUS } from '../utils/authRoles';

export default function AuthView() {
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    const emailClean = authEmail.trim().toLowerCase();

    try {
      if (isLogin) {
        // First try standard login
        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email: emailClean,
          password: authPassword,
        });

        if (loginError) {
          // Check if user was pre-created with a temporary password but hasn't activated auth yet
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('email', emailClean)
            .maybeSingle();

          if (profile && profile.temp_password && profile.temp_password === authPassword) {
            // First-time activation with temporary password
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
              email: emailClean,
              password: authPassword,
            });

            if (signUpError) {
              throw new Error(`Activation error: ${signUpError.message}`);
            }

            if (signUpData?.user) {
              await supabase
                .from('user_profiles')
                .update({
                  auth_user_id: signUpData.user.id,
                  status: USER_STATUS.ACTIVE,
                  temp_password: null
                })
                .eq('id', profile.id);

              setAuthSuccess('Account activated successfully! Signing in...');
              return;
            }
          }

          throw loginError;
        }

        // Check if user profile is deactivated
        if (loginData?.user) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('status')
            .eq('email', emailClean)
            .maybeSingle();

          if (profile && profile.status === USER_STATUS.DEACTIVATED) {
            await supabase.auth.signOut();
            throw new Error('Your account has been deactivated. Please contact your club administrator.');
          }
        }
      } else {
        // SIGN UP FLOW: Enforce invite-only verification
        // Check if this email is pre-registered in user_profiles
        const { data: existingProfiles } = await supabase
          .from('user_profiles')
          .select('id, email, status')
          .limit(1);

        // If there are existing profiles, whitelist enforcement is active
        if (existingProfiles && existingProfiles.length > 0) {
          const { data: invitedProfile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('email', emailClean)
            .maybeSingle();

          if (!invitedProfile) {
            throw new Error(
              'Registration is invite-only. Please contact your club or team administrator to receive an invite.'
            );
          }

          if (invitedProfile.status === USER_STATUS.DEACTIVATED) {
            throw new Error('This account has been deactivated. Please contact your club administrator.');
          }
        }

        // Proceed with signup
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: emailClean,
          password: authPassword,
        });

        if (signUpError) throw signUpError;

        // Link auth user ID to user profile
        if (signUpData?.user) {
          await supabase
            .from('user_profiles')
            .update({
              auth_user_id: signUpData.user.id,
              status: USER_STATUS.ACTIVE,
              temp_password: null
            })
            .eq('email', emailClean);
        }

        setAuthSuccess('Signup successful! You can now log in.');
        setIsLogin(true);
      }
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ justifyContent: 'center' }}>
      <div className="view-container">
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <h1 className="title-lg text-gradient" style={{ margin: 0 }}>
              Youth Football Manager
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
              Match Tracker, Stats &amp; Squad Management
            </p>
          </div>

          <div className="tab-switch">
            <button
              onClick={() => {
                setIsLogin(true);
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`tab-switch-btn ${isLogin ? 'active' : ''}`}
            >
              Login
            </button>
            <button
              onClick={() => {
                setIsLogin(false);
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`tab-switch-btn ${!isLogin ? 'active' : ''}`}
            >
              Sign Up (Invite Only)
            </button>
          </div>

          <form onSubmit={handleAuth}>
            <div className="input-group">
              <label className="label">Email Address</label>
              <input
                type="email"
                required
                className="input"
                placeholder="name@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label className="label">{isLogin ? 'Password / Temporary Password' : 'Choose Password'}</label>
              <input
                type="password"
                required
                className="input"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>

            {authError && (
              <div className="alert alert-danger flex-row gap-2" style={{ alignItems: 'flex-start' }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{authError}</span>
              </div>
            )}

            {authSuccess && (
              <div className="alert alert-success flex-row gap-2" style={{ alignItems: 'flex-start' }}>
                <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{authSuccess}</span>
              </div>
            )}

            <button type="submit" disabled={authLoading} className="btn btn-primary mt-4">
              {authLoading ? 'Processing...' : isLogin ? 'Login' : 'Create Account'}
            </button>

            {!isLogin && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: '1rem' }}>
                Account registration is restricted to invited coaches and staff.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
