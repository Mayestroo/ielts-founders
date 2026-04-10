'use client';

import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';
import { useAuth } from '@/contexts/AuthContext';
import {
  RegisterPayload,
  RegisterWithGooglePayload,
  SessionReferralSource,
} from '@/types';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const REFERRAL_OPTIONS: Array<{ value: SessionReferralSource; label: string }> = [
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'GOOGLE', label: 'Google' },
  { value: 'FRIENDS', label: 'Friends' },
  { value: 'OTHER', label: 'Other' },
];

export default function RegisterPage() {
  const [error, setError] = useState('');
  const [isRegisterLoading, setIsRegisterLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [registration, setRegistration] = useState<{
    email: string;
    password: string;
    referralSource: SessionReferralSource;
  }>({
    email: '',
    password: '',
    referralSource: 'TELEGRAM',
  });
  const {
    register,
    registerWithGoogle,
    isAuthenticated,
    isLoading: authLoading,
  } = useAuth();
  const router = useRouter();
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const formCardRef = useRef<HTMLElement | null>(null);
  const [mediaHeight, setMediaHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const formCard = formCardRef.current;

    if (!formCard) {
      return;
    }

    const updateHeight = () => {
      setMediaHeight(formCard.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(formCard);
    window.addEventListener('resize', updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  const buildSessionPayload = (): RegisterWithGooglePayload => {
    return {
      referralSource: registration.referralSource,
    };
  };

  const buildRegistrationPayload = (): RegisterPayload => {
    if (!registration.email.trim() || !registration.password) {
      throw new Error('Please fill all registration fields');
    }

    const normalizedEmail = registration.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Please enter a valid email address');
    }

    return {
      ...buildSessionPayload(),
      username: normalizedEmail,
      password: registration.password,
    };
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsRegisterLoading(true);

    try {
      const payload = buildRegistrationPayload();
      await register(payload);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsRegisterLoading(false);
    }
  };

  const handleGoogleRegister = async (idToken: string) => {
    setError('');
    setIsGoogleLoading(true);

    try {
      const payload = buildSessionPayload();
      await registerWithGoogle(idToken, payload);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google registration failed');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto grid min-h-screen w-full lg:grid-cols-[minmax(360px,1.15fr)_minmax(420px,0.85fr)] xl:grid-cols-[minmax(440px,1.15fr)_minmax(480px,0.85fr)]">
        <section className="hidden h-screen overflow-hidden bg-white lg:block">
          <div className="flex h-full items-center justify-center p-3 xl:p-4">
            <div
              className="relative h-[620px] w-full overflow-hidden rounded-[30px] xl:rounded-[36px]"
              style={mediaHeight ? { height: `${mediaHeight}px` } : undefined}
            >
              <video
                src="/videos/login.mp4"
                className="absolute inset-0 h-full w-full object-cover object-[78%_center]"
                autoPlay
                muted
                loop
                playsInline
              />
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-white px-4 py-8 sm:px-6 lg:px-8 xl:px-12">
          <section
            ref={formCardRef}
            className="w-full max-w-[500px] rounded-2xl border border-gray-200 bg-white p-5 shadow-lg shadow-gray-200/60 sm:p-8"
          >
            <div className="mb-7 text-center sm:mb-8">
              <div className="mb-6 inline-flex items-center justify-center">
                <Image
                  src="/logo.png"
                  alt="Logo"
                  width={260}
                  height={77}
                  className="h-auto w-[160px] sm:w-[210px]"
                  priority
                />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Create Student Account</h1>
              <p className="mt-2 text-sm text-gray-500 sm:text-base">Register to join your IELTS test session</p>
            </div>

            <form className="space-y-4 sm:space-y-5" onSubmit={handleRegister}>
              {error && (
                <div className="p-3 rounded-lg bg-black text-white text-sm border border-black/10 text-center">
                  {error}
                </div>
              )}

              <input
                type="email"
                placeholder="Email"
                value={registration.email}
                onChange={(e) =>
                  setRegistration((prev) => ({ ...prev, email: e.target.value }))
                }
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                disabled={isGoogleLoading || isRegisterLoading}
                autoComplete="email"
                required
              />

              <input
                type="password"
                placeholder="Password"
                value={registration.password}
                onChange={(e) =>
                  setRegistration((prev) => ({ ...prev, password: e.target.value }))
                }
                className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                disabled={isGoogleLoading || isRegisterLoading}
                required
              />

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Where did you hear about us?
                </label>
                <select
                  value={registration.referralSource}
                  onChange={(e) =>
                    setRegistration((prev) => ({
                      ...prev,
                      referralSource: e.target.value as SessionReferralSource,
                    }))
                  }
                  className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                  disabled={isGoogleLoading || isRegisterLoading}
                >
                  {REFERRAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={isGoogleLoading || isRegisterLoading}
                className="w-full py-3 rounded-lg bg-black text-white font-semibold hover:bg-gray-900 transition-all shadow-lg shadow-black/20 disabled:opacity-50"
              >
                {isRegisterLoading ? 'Continuing...' : 'Continue'}
              </button>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs uppercase tracking-wide text-gray-400">Or</span>
                </div>
              </div>

              <GoogleAuthButton
                clientId={googleClientId}
                text="signup_with"
                disabled={isGoogleLoading || isRegisterLoading}
                onCredential={handleGoogleRegister}
              />

              <p className="text-xs text-gray-500 text-center">
                Use the same Google account later on the login page.
              </p>

              <p className="text-center text-sm text-gray-500">
                Already registered?{' '}
                <Link href="/login" className="font-semibold text-gray-900 hover:underline">
                  Login
                </Link>
              </p>
            </form>
          </section>
        </section>
      </div>
    </div>
  );
}
